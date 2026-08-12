import { getStagesByLevel } from './config/curriculumConfig'; // 경로가 다르면 맞게 수정해주세요
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import magicMainIllustration from './assets/magic-main-illustration.png'
import sonGokuImg from './assets/son-goku.png'
import shaoImg from './assets/shao.png'
import samjangImg from './assets/samjang.png'
import okdongjaImg from './assets/okdongja.png'
import { normalizeClassCode } from './classCode'
import {
  getCharacterDisplayName,
  getCharacterNameForTier,
  LEVEL_PROBLEM_SETS,
  resolveCanonicalDiagnosticTier,
} from './levelConfig'
import {
  fetchStudentLearningProgress,
  postGenerateAiFeedback,
  updateSupplement,
} from './sheets'
import { findMatchingTrainingRowIndex, normalizeTrainingKind } from './training/trainingRowSelect'
import {
  choiceAnswerTextMatch,
  parseChoiceOptionsFromQuestion,
} from './training/trainingChoiceUtils'
import {
  findTrainingHintForStep,
  isTrainingHintAvailableForStep,
  isUsableTrainingHintBody,
} from './training/trainingHintUtils'
import {
  applySheetProblemOutcomeLists,
  isProblemCardComplete,
  isProblemProgressSuccess,
  mergeTrainingProblemProgressMaps,
  mergeTrainingProgressAfterSave,
  resolveCardChallengeHintPhase,
} from './training/trainingProblemProgress'
import { normalizeProblemCodeList, resolveTrainingSaveStatus } from './training/trainingStatus'
import {
  FRACTION_TOKEN_REGEX,
  latexToPlain,
  plainToDisplayLatex,
  preprocessFractionDisplayText,
} from './training/mathTextDisplay'
import {
  readStoredTrainingProblemProgress,
  writeStoredTrainingProblemProgress,
} from './studentPersist'
import {
  buildActiveStepSheetPayload,
} from './training/trainingSheetSteps'
import {
  formatStudentXValueAnswer,
  getActiveTrainingStageIndices,
  getFirstActiveTrainingStageIndex,
  getNextActiveTrainingStageIndex,
  getTrainingStage,
  getTrainingStageDisplayLabel,
  getStageChoiceGradeAnswer,
  getStageGradeAnswer,
  getStageQuestionText,
  isLastActiveTrainingStageIndex,
  isSecondToLastActiveTrainingStageIndex,
  isXValueNumericAnswer,
  TRAINING_STAGE_COUNT,
  TRAINING_STEP_MEANINGS,
} from './training/trainingStageConfig'
import { matchesScaffoldExpected } from './training/scaffoldUtils'
import { matchesStep2VariableAnswer } from './training/step2VariableGrading'
import {
  getMathCardsArray,
  getMathCardsByProblem,
  loadGroupedTrainingData,
  loadMathCardsCsvRows,
  loadTrainingCsvRows,
} from './utils/dataLoader'
import { applyTrainingMathVirtualKeyboard } from './training/trainingMathVirtualKeyboard'
import ScratchPadModal from './components/ScratchPadModal'
import StepFocusedLearningModal from './components/StepFocusedLearningModal'
import EquationScaffoldingModal from './components/EquationScaffoldingModal'
import {
  buildFailedStepDetailsFromCompletedSteps,
  generateStudentFeedback,
  getStudentFeedbackDisplayText,
} from './training/studentAiFeedback'
import { collectStepTrainingConceptBundles } from './training/stepTrainingContent'
import {
  getScaffoldingStepsForRow,
} from './training/scaffoldingTestData'

const DEFAULT_CSV_PATH = '/data/training_problems_question_final_0810.csv'
const DEFAULT_HINTS_CSV_PATH = '/data/hints_structured_step1-6_final_0810.csv'

/** 키워드 카드 `duration-300` 뒤집기 후 문제 코드 면을 보여 주는 시간(ms), 이후 수련 본문으로 전환 */
const KEYWORD_CARD_FLIP_ANIM_MS = 300
const KEYWORD_CARD_CODE_FACE_HOLD_MS = 900
const KEYWORD_CARD_PICK_TO_SESSION_MS = KEYWORD_CARD_FLIP_ANIM_MS + KEYWORD_CARD_CODE_FACE_HOLD_MS

function emptyStepFlags() {
  return Array(TRAINING_STAGE_COUNT).fill(false)
}

function emptyStepCounts() {
  return Array(TRAINING_STAGE_COUNT).fill(0)
}

/** 2단계(stepIdx===1)만 x 정하기 전용 채점, 3~6단계는 기존 경로 유지 */
function gradeTrainingTextAnswer(student, expected, { stepIdx, allowSwappedEquationSides, allowUnorderedPair }) {
  if (stepIdx === 1) {
    return matchesStep2VariableAnswer(student, expected)
  }
  return matchesScaffoldExpected(student, expected, {
    allowSwappedEquationSides,
    allowUnorderedPair,
  })
}

/** 결과 화면 고정 — 저장 후 trainingPlan 갱신으로 problemIdx가 바뀌어도 방금 푼 문항 유지 */
function buildTrainingResultSessionSnapshot({
  row,
  completedSteps,
  activeStepCount,
  hintUsageCount,
  problemCode,
  trainingType,
  successCount,
  failCount,
  awardedCard,
}) {
  const kind = normalizeTrainingKind(trainingType) || '본문제'
  const code = String(problemCode || '').trim().toUpperCase()
  const steps = (completedSteps || []).map((s) => ({ ...s }))
  const success =
    Number.isFinite(Number(successCount)) ?
      Math.max(0, Math.round(Number(successCount)))
    : steps.filter((s) => Number(s.processResult) > 0).length
  const fail =
    Number.isFinite(Number(failCount)) ?
      Math.max(0, Math.round(Number(failCount)))
    : steps.filter((s) => Number(s.processResult) === 0).length
  const card = awardedCard
    ? {
        name: String(awardedCard.name || '매쓰카드').trim(),
        image: String(awardedCard.image || '').trim(),
        code: String(awardedCard.code ?? awardedCard.problem ?? '').trim(),
      }
    : null
  return {
    problemCode: code,
    trainingType: kind,
    problemText: String(row?.['문제 텍스트'] ?? ''),
    summary: `현재 수련 문제: ${code} / ${kind}`,
    completedSteps: steps,
    activeStepCount: Number(activeStepCount) || 0,
    hintUsageCount: Number(hintUsageCount) || 0,
    successCount: success,
    failCount: fail,
    status: resolveTrainingSaveStatus(kind, fail),
    awardedCard: card,
  }
}

const RETRY_CHALLENGE_MESSAGES = {
  retry_similar1: '아직 MATH-CARD를 얻지 못했어요. 비슷한 문제로 다시 한번 도전해볼까요?',
}

const TRAINING_COMPLETION_MESSAGES = [
  '포기하지 않고 끝까지 해낸 당신이 정말 자랑스럽습니다.',
  '꾸준한 노력으로 큰 성장을 이루었습니다.',
  '이제 어떤 방정식도 해결할 수 있습니다!',
  '당신은 스스로 해낸 경험을 얻었습니다.',
]

const MATH_CARD_COLLECTION_KEY = 'mm_math_card_earned_v1'
/** 예전 키 — 잘못 채워진 목록이 많아 더 이상 읽지 않고, 최초 로드 시 제거합니다 */
const LEGACY_MATH_CARD_COLLECTION_KEY = 'mathCardCollection'

/** 한 세트(5문항 코드 배열)가 Sheets·로컬 progressMap 기준 모두 completed인지 */
function isTrainingProblemSetFullyComplete(setCodes, problemProgressByCode) {
  const codes = (setCodes || [])
    .map((c) => String(c || '').trim().toUpperCase())
    .filter(Boolean)
  if (!codes.length) return false
  for (const code of codes) {
    const p = problemProgressByCode[code]
    if (!isProblemProgressSuccess(p)) return false
  }
  return true
}

/** 1세트는 항상 표시. s세트를 전부 완료하면 s+1세트까지 표시(최대 전체 단계 수). */
function countVisibleTrainingSets(tierProblemSets, problemProgressByCode) {
  const sets = tierProblemSets || []
  if (!sets.length) return 0
  let visibleCount = 1
  for (let s = 0; s < sets.length; s += 1) {
    if (!isTrainingProblemSetFullyComplete(sets[s], problemProgressByCode)) {
      visibleCount = s + 1
      break
    }
    visibleCount = s + 2
  }
  return Math.min(Math.max(visibleCount, 1), sets.length)
}

/**
 * 키워드 카드 화면 — 진행 순서상 첫 미완료 카드(재도전·일반 구분 없음).
 * @returns {{ code: string, keyword: string } | null}
 */
function resolveRecommendedKeywordCard(
  visibleKeywordTrainingSets,
  problemProgressByCode,
  sheetCompletedProblemSet,
) {
  for (const { cards } of visibleKeywordTrainingSets || []) {
    for (const card of cards || []) {
      const cardProgress = problemProgressByCode[card.code] || {
        isComplete: false,
        nextKind: '본문제',
        latestByType: {},
        status: 'not_started',
      }
      const isCardLocked = isProblemCardComplete(
        cardProgress,
        card.code,
        sheetCompletedProblemSet,
      )
      if (isCardLocked) continue
      return {
        code: card.code,
        keyword: String(card.keyword ?? '').trim(),
      }
    }
  }
  return null
}

function getRowProblemCode(row) {
  const stage = String(row?.__poolStage ?? row?.['단계'] ?? '').trim()
  const typeLetter = String(row?.['유형'] ?? '').trim().toUpperCase()
  if (!stage || !typeLetter) return ''
  return `${stage}-${typeLetter}`
}

/** 로컬 보관·UI 획득 판정용: `1-a` → `1-A`, 형식 불가면 빈 문자열 */
function normalizeMathCardStorageCode(raw) {
  const s = String(raw ?? '').trim().toUpperCase()
  const m = s.match(/^(\d+)-([A-Z])$/)
  return m ? `${m[1]}-${m[2]}` : ''
}

function readStoredMathCardCollection() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MATH_CARD_COLLECTION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      try {
        localStorage.removeItem(LEGACY_MATH_CARD_COLLECTION_KEY)
      } catch (_) {
        // ignore
      }
      return [...new Set(parsed.map((v) => normalizeMathCardStorageCode(v)).filter(Boolean))]
    }
    // 신규 키가 없을 때만: 구 키는 오염·테스트 데이터가 많아 읽지 않고 삭제
    try {
      localStorage.removeItem(LEGACY_MATH_CARD_COLLECTION_KEY)
    } catch (_) {
      // ignore
    }
    return []
  } catch (_) {
    return []
  }
}

function writeStoredMathCardCollection(codes) {
  if (typeof window === 'undefined') return
  try {
    const unique = [
      ...new Set((codes || []).map((v) => normalizeMathCardStorageCode(v)).filter(Boolean)),
    ]
    window.localStorage.setItem(MATH_CARD_COLLECTION_KEY, JSON.stringify(unique))
    try {
      localStorage.removeItem(LEGACY_MATH_CARD_COLLECTION_KEY)
    } catch (_) {
      // ignore
    }
  } catch (_) {
    // ignore localStorage error
  }
}

export function shouldAwardMathCard(type, failCount) {
  const normalizedType = normalizeTrainingKind(type)
  const fc = Number(failCount)
  if (normalizedType === '유사문제1') return true
  if (normalizedType === '본문제') return Number.isFinite(fc) && fc < 2
  return false
}


function mathCardVaultSlotClassName({ opened, isNew, compact = false }) {
  return [
    'math-card-vault-slot flex overflow-hidden rounded-xl border-2',
    compact
      ? 'aspect-[150/213] h-auto w-full min-w-0 max-h-[11.25rem]'
      : 'h-[213px] w-[150px] shrink-0',
    opened
      ? 'math-card-vault-slot--unlocked math-card-vault-slot--interactive border-indigo-900 bg-indigo-900 p-1.5'
      : 'math-card-vault-slot--locked border-indigo-900/35 bg-slate-100/90 opacity-55',
    isNew ? 'math-card-vault-slot--new' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** 카드 보관함 슬롯 UI — 열림은 progressMap 기준 completed, 이미지는 math_cards 매칭 */
function MathCardSlotGrid({
  slots,
  unlockedSet,
  recentlyAcquiredCode = null,
  compact = false,
  scaled75 = false,
}) {
  const openLookup =
    unlockedSet instanceof Set
      ? unlockedSet
      : new Set(
          Array.isArray(unlockedSet)
            ? unlockedSet.map((v) => normalizeMathCardStorageCode(v)).filter(Boolean)
            : []
        )
  const acquiredNorm = normalizeMathCardStorageCode(recentlyAcquiredCode)

  const grid = (
    <div
      className={
        compact
          ? 'grid w-full grid-cols-5 gap-x-1.5 gap-y-1.5 sm:gap-x-2 sm:gap-y-2'
          : 'grid grid-cols-5 gap-x-3 gap-y-2'
      }
    >
      {(slots || []).map((card, idx) => {
        const code = normalizeMathCardStorageCode(card?.code ?? card?.problem)
        const opened = Boolean(code && openLookup.has(code))
        const isNew = Boolean(opened && acquiredNorm && code === acquiredNorm)
        const imgSrc = String(card?.image || '').trim()
        const description = String(card?.description ?? '').trim()
        const cardTitle = description
          ? `의미: ${description}`
          : String(card?.name ?? '').trim() || undefined
        if (opened) {
          if (imgSrc) {
            return (
              <div
                key={`card-slot-${code}-${idx}`}
                className={mathCardVaultSlotClassName({ opened: true, isNew, compact })}
                title={cardTitle}
              >
                <div className="mx-auto flex h-full w-full items-center justify-center overflow-hidden rounded-lg border-2 border-indigo-800 bg-white">
                  <img
                    src={imgSrc}
                    alt={String(card?.name || '매쓰카드')}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </div>
            )
          }
          return (
            <div
              key={`card-slot-open-nopic-${code}-${idx}`}
              className={[
                mathCardVaultSlotClassName({ opened: true, isNew, compact }),
                'flex-col items-center justify-center gap-1 bg-indigo-50 px-2 text-center',
              ].join(' ')}
              title={cardTitle}
            >
              <p className="text-sm font-black text-indigo-900">{code}</p>
              {description ? (
                <p className="text-xs font-semibold leading-relaxed text-indigo-800 line-clamp-3">
                  {description}
                </p>
              ) : (
                <p className="text-xs font-semibold leading-relaxed text-indigo-700">획득</p>
              )}
            </div>
          )
        }
        return (
          <div
            key={`card-slot-locked-${idx}`}
            className={[
              mathCardVaultSlotClassName({ opened: false, isNew: false, compact }),
              'items-center justify-center',
            ].join(' ')}
          >
            <p className="text-2xl leading-none opacity-75" aria-hidden>
              🔒
            </p>
          </div>
        )
      })}
    </div>
  )

  if (scaled75) {
    return (
      <div className="math-card-vault-scaled75-wrap">
        <div className="math-card-vault-scaled75-inner">{grid}</div>
      </div>
    )
  }

  return grid
}

function hintColumnsFromFlags(flags) {
  /** @type {Record<string, 'Y' | 'N'>} */
  const o = {}
  for (let i = 0; i < TRAINING_STAGE_COUNT; i += 1) {
    o[`비계단계_${i + 1}_힌트여부`] = flags[i] ? 'Y' : 'N'
  }
  return o
}

function showSimpleNoticeDialog(title, message) {
  if (typeof document === 'undefined') return
  const existing = document.getElementById('mm-notice-dialog-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'mm-notice-dialog-overlay'
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;'

  const card = document.createElement('div')
  card.style.cssText =
    'width:min(560px,95vw);background:#fff;border-radius:16px;box-shadow:0 20px 40px rgba(2,6,23,0.22);padding:18px 18px 14px;'

  const titleEl = document.createElement('div')
  titleEl.textContent = title || '안내'
  titleEl.style.cssText = 'font-weight:800;color:#0f172a;font-size:18px;margin-bottom:10px;'

  const body = document.createElement('div')
  body.style.cssText = 'color:#334155;line-height:1.7;font-size:15px;white-space:pre-wrap;'
  body.textContent = String(message || '')

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;'

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = '확인'
  closeBtn.style.cssText =
    'border:none;border-radius:10px;background:#111827;color:#fff;font-weight:700;padding:8px 14px;cursor:pointer;'
  closeBtn.addEventListener('click', () => overlay.remove())

  footer.appendChild(closeBtn)
  card.appendChild(titleEl)
  card.appendChild(body)
  card.appendChild(footer)
  overlay.appendChild(card)
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove()
  })
  document.body.appendChild(overlay)
}

/**
 * @typedef {{
 *   nickname?: string,
 *   classCode?: string,
 *   diagnosticTier?: string,
 *   characterName?: string,
 *   stages?: number[],
 *   source?: string,
 *   launchedAt?: string,
 *   resultHeadline?: string,
 *   diagnosticTotalScore?: number,
 *   diagnosticMaxScore?: number,
 * }} TrainingPlan
 */

export default function TrainingMode({
  nickname,
  classCode,
  onExit,
  trainingPlan = null,
  onTrainingProgressChange,
  /** 관리자·미리보기 등에서만 true. 학생 기본 경로에서는 false 유지. */
  allowTrainingProblemPicker = false,
}) {
  const [rows, setRows] = useState([])
  const [hintsData, setHintsData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [problemIdx, setProblemIdx] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  /** @type {[boolean[], function]} */
  const [hintFlags, setHintFlags] = useState(() => emptyStepFlags())
  const [selectedChoice, setSelectedChoice] = useState('')
  const [selectedChoiceToken, setSelectedChoiceToken] = useState('')
  /** 진단·수련 세션 동안 힌트 버튼을 누른 횟수 */
  const [hintUsageCount, setHintUsageCount] = useState(0)
  /** 괄호 빈칸 값: 키 `${stepIdx}-${blankIdx}` */
  const [blankValues, setBlankValues] = useState({})
  const [textAnswer, setTextAnswer] = useState('')
  const [answerCheckState, setAnswerCheckState] = useState('')
  const [wrongAttemptStreak, setWrongAttemptStreak] = useState(0)
  const [stepWrongCounts, setStepWrongCounts] = useState(() => emptyStepCounts())
  const [stepHintUsed, setStepHintUsed] = useState(() => emptyStepFlags())
  const [completedSteps, setCompletedSteps] = useState([])
  const [isResultView, setIsResultView] = useState(false)
  const [isResultReady, setIsResultReady] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [activeBlankKey, setActiveBlankKey] = useState('')
  const [isMathLiveReady, setIsMathLiveReady] = useState(false)
  const [isMathVkOpen, setIsMathVkOpen] = useState(false)
  const [isScratchPadOpen, setIsScratchPadOpen] = useState(false)
  const [isStepFocusedLearningOpen, setIsStepFocusedLearningOpen] = useState(false)
  const [trainingAllComplete, setTrainingAllComplete] = useState(false)
  /** 마지막(6/6) 결과보기 클릭 전, 저장 대기 중 페이로드 */
  const [pendingSavePayload, setPendingSavePayload] = useState(null)
  /** Apps Script에서 받은 수련 AI 피드백 (결과 화면 표시 + 시트 ai 열) */
  const [trainingAiFeedback, setTrainingAiFeedback] = useState('')
  /** 결과·피드백 화면에 표시할 방금 완료한 문항 스냅샷 */
  const [resultSessionSnapshot, setResultSessionSnapshot] = useState(null)
  const [isAwaitingTrainingAi, setIsAwaitingTrainingAi] = useState(false)
  const [completionEncouragement, setCompletionEncouragement] = useState('')
  const [awardedMathCardPopup, setAwardedMathCardPopup] = useState(null)
  const [recentlyAcquiredCardCode, setRecentlyAcquiredCardCode] = useState(null)
  const [isMathCardCollectionOpen, setIsMathCardCollectionOpen] = useState(false)
  const [mathCardCatalog, setMathCardCatalog] = useState([])
  const [mathCardCollection, setMathCardCollection] = useState(() => readStoredMathCardCollection())
  const learnerClassCode = normalizeClassCode(classCode ?? trainingPlan?.classCode)
  const learnerNickname = (nickname || '').trim()

  /** 시트·localStorage·방금 저장분 누적 — 카드 비활성·다음 유형 분기 */
  const [problemProgressByCode, setProblemProgressByCode] = useState(() =>
    mergeTrainingProblemProgressMaps(
      readStoredTrainingProblemProgress(learnerNickname, learnerClassCode),
      trainingPlan?.trainingProblemProgressByCode || {},
    ),
  )
  /** doGet failedProblems — 카드 재도전 표시(마지막 행만 X) */
  const [sheetFailedProblems, setSheetFailedProblems] = useState(() =>
    normalizeProblemCodeList(trainingPlan?.failedProblems),
  )
  const [sheetCompletedProblems, setSheetCompletedProblems] = useState(() =>
    normalizeProblemCodeList(trainingPlan?.completedProblems),
  )
  const sheetFailedProblemSet = useMemo(
    () => new Set(sheetFailedProblems),
    [sheetFailedProblems],
  )
  const sheetCompletedProblemSet = useMemo(
    () => new Set(sheetCompletedProblems),
    [sheetCompletedProblems],
  )

  const onTrainingProgressChangeRef = useRef(onTrainingProgressChange)
  onTrainingProgressChangeRef.current = onTrainingProgressChange

  const syncProgressToParent = useCallback((map) => {
    queueMicrotask(() => {
      onTrainingProgressChangeRef.current?.(map)
    })
  }, [])

  const persistProblemProgressMap = useCallback(
    (map) => {
      if (learnerNickname && learnerClassCode) {
        writeStoredTrainingProblemProgress(learnerNickname, learnerClassCode, map)
      }
      syncProgressToParent(map)
    },
    [learnerNickname, learnerClassCode, syncProgressToParent],
  )

  const applyProblemProgressMap = useCallback(
    (updater) => {
      setProblemProgressByCode((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (learnerNickname && learnerClassCode) {
          writeStoredTrainingProblemProgress(learnerNickname, learnerClassCode, next)
        }
        syncProgressToParent(next)
        return next
      })
    },
    [learnerNickname, learnerClassCode, syncProgressToParent],
  )
  /** 본문·6단계 풀이 UI 표시: 카드 확정 후 true, 결과 확인 후 카드로 돌아가면 false */
  const [trainingSessionActive, setTrainingSessionActive] = useState(false)
  /** 키워드 → 문제 번호 뒤집기 애니메이션 중인 카드 코드 */
  const [flippingProblemCode, setFlippingProblemCode] = useState(null)
  /** 유사1·유사2 진입 전 재도전/마지막 도전 확인 팝업 */
  const [retryChallengeDialog, setRetryChallengeDialog] = useState(null)
  /** 옥동자 5단계 1회 오답 — 다시 도전 / 스캐폴딩 선택 */
  const [scaffoldingChoiceDialog, setScaffoldingChoiceDialog] = useState(null)
  /** 방정식 풀이 스캐폴딩 세션 (stepIndex는 0부터, isFinished는 마지막 완료) */
  const [scaffoldingSession, setScaffoldingSession] = useState(null)
  /** 스캐폴딩 오답 → 개념학습 Modal용 concept_key */
  const [scaffoldingConceptKey, setScaffoldingConceptKey] = useState(null)
  const keywordFlipTimerRef = useRef(null)
  const blankLogTimer = useRef(null)
  const textInputRef = useRef(null)
  const mathFieldHostRef = useRef(null)
  const mathFieldRef = useRef(null)
  const stepHistoryScrollRef = useRef(null)
  const activeStepPanelRef = useRef(null)
  const answerScrollAnchorRef = useRef(null)
  const answerScrollGuardActiveRef = useRef(false)
  const suspendScrollAnchorForVkRef = useRef(false)
  const userStepScrollRef = useRef(false)
  const blankInputRefs = useRef({})
  const startedProblemKeySetRef = useRef(new Set())
  const stepWrongCountsRef = useRef(emptyStepCounts())
  const stepHintUsedRef = useRef(emptyStepFlags())
  const savedTrainingKeysRef = useRef(new Set())
  /** saveKey → generateStudentFeedback 최종 문자열 (화면·시트 동일) */
  const savedAiFeedbackByKeyRef = useRef({})
  const revealedStudentAnswerByStepRef = useRef({})
  const trainingSessionActiveRef = useRef(false)
  const isResultViewRef = useRef(false)
  const persistProblemProgressMapRef = useRef(() => {})

  useEffect(() => {
    trainingSessionActiveRef.current = trainingSessionActive
  }, [trainingSessionActive])

  useEffect(() => {
    isResultViewRef.current = isResultView
  }, [isResultView])

  useEffect(() => {
    persistProblemProgressMapRef.current = persistProblemProgressMap
  }, [persistProblemProgressMap])

  const trainingDataLoadKey = useMemo(() => {
    const stages = trainingPlan?.stages
    const filters = trainingPlan?.stageTypeFilters
    return JSON.stringify({
      launchedAt: trainingPlan?.launchedAt ?? '',
      stages: Array.isArray(stages) ? stages : [],
      stageTypeFilters: filters && typeof filters === 'object' ? filters : {},
      tier: trainingPlan?.diagnosticTier ?? '',
    })
  }, [
    trainingPlan?.launchedAt,
    trainingPlan?.stages,
    trainingPlan?.stageTypeFilters,
    trainingPlan?.diagnosticTier,
  ])

  useEffect(() => {
    setHintUsageCount(0)
    setHintFlags(emptyStepFlags())
    setSelectedChoice('')
    setSelectedChoiceToken('')
    setProblemIdx(0)
    setStepIdx(0)
    setBlankValues({})
    setTextAnswer('')
    setAnswerCheckState('')
    setWrongAttemptStreak(0)
    setStepWrongCounts(emptyStepCounts())
    setStepHintUsed(emptyStepFlags())
    stepWrongCountsRef.current = emptyStepCounts()
    stepHintUsedRef.current = emptyStepFlags()
    setCompletedSteps([])
    setIsResultView(false)
    setIsResultReady(false)
    setIsSaved(false)
    setActiveBlankKey('')
    setIsScratchPadOpen(false)
    blankInputRefs.current = {}
    startedProblemKeySetRef.current = new Set()
    setTrainingAllComplete(Boolean(trainingPlan?.openTrainingCompleteScreen))
    setCompletionEncouragement('')
    setPendingSavePayload(null)
    setTrainingAiFeedback('')
    setIsAwaitingTrainingAi(false)
    setAwardedMathCardPopup(null)
    setIsMathCardCollectionOpen(false)
    savedTrainingKeysRef.current = new Set()
    savedAiFeedbackByKeyRef.current = {}
    revealedStudentAnswerByStepRef.current = {}
    setTrainingSessionActive(false)
    setFlippingProblemCode(null)
    setRetryChallengeDialog(null)
    setResultSessionSnapshot(null)
    const sessionProgress = applySheetProblemOutcomeLists(
      mergeTrainingProblemProgressMaps(
        readStoredTrainingProblemProgress(learnerNickname, learnerClassCode),
        trainingPlan?.trainingProblemProgressByCode || {},
      ),
      trainingPlan?.completedProblems,
      trainingPlan?.failedProblems,
    )
    setSheetFailedProblems(normalizeProblemCodeList(trainingPlan?.failedProblems))
    setSheetCompletedProblems(normalizeProblemCodeList(trainingPlan?.completedProblems))
    setProblemProgressByCode(sessionProgress)
    persistProblemProgressMapRef.current(sessionProgress)
    if (keywordFlipTimerRef.current) {
      window.clearTimeout(keywordFlipTimerRef.current)
      keywordFlipTimerRef.current = null
    }
  }, [
    trainingPlan?.launchedAt,
    trainingPlan?.failedProblems,
    trainingPlan?.completedProblems,
    trainingPlan?.openTrainingCompleteScreen,
    learnerNickname,
    learnerClassCode,
  ])

  useEffect(() => {
    return () => {
      if (keywordFlipTimerRef.current) {
        window.clearTimeout(keywordFlipTimerRef.current)
        keywordFlipTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cards = await loadMathCardsCsvRows()
        if (cancelled) return
        setMathCardCatalog(Array.isArray(cards) ? cards : [])
      } catch (error) {
        console.warn('[math card] catalog load failed:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Google Sheets 병합 progressMap 기준 문항 완료 → 보관함에서 열린 카드 */
  const mathCardVaultCompletedByProgressSet = useMemo(() => {
    const next = new Set()
    for (const [rawKey, meta] of Object.entries(problemProgressByCode || {})) {
      const k = normalizeMathCardStorageCode(rawKey)
      if (!k) continue
      if (isProblemProgressSuccess(meta)) next.add(k)
    }
    return next
  }, [problemProgressByCode])

  /** 진단 티어의 LEVEL_PROBLEM_SETS 15칸 + math_cards.csv(problem/code) 매칭 */
  const mathCardCollectionSlots = useMemo(() => {
    const tier = resolveCanonicalDiagnosticTier(
      trainingPlan?.diagnosticTier ||
        trainingPlan?.diagnosticRecord?.level ||
        trainingPlan?.characterName ||
        '하'
    )
    const sets = LEVEL_PROBLEM_SETS[tier] || LEVEL_PROBLEM_SETS.하
    const catalog = mathCardCatalog || []
    const byProblem = new Map()
    for (const c of catalog) {
      const pk = String(c?.problem ?? '').trim().toUpperCase()
      if (!pk) continue
      if (!byProblem.has(pk)) {
        const code = normalizeMathCardStorageCode(c?.code ?? c?.problem)
        byProblem.set(pk, { ...c, ...(code ? { code } : {}) })
      }
    }
    const slots = []
    for (const setRow of sets) {
      for (const raw of setRow || []) {
        const problemKey = normalizeMathCardStorageCode(raw)
        if (!problemKey) continue
        const hit = byProblem.get(problemKey)
        slots.push(
          hit || {
            code: problemKey,
            problem: problemKey,
            name: problemKey,
            term: '',
            description: '',
            rarity: '',
            image: '',
          }
        )
      }
    }
    while (slots.length < 15) slots.push(null)
    return slots.slice(0, 15)
  }, [
    mathCardCatalog,
    trainingPlan?.diagnosticTier,
    trainingPlan?.diagnosticRecord?.level,
    trainingPlan?.characterName,
  ])

  const acquiredMathCardCount = useMemo(
    () =>
      (mathCardCollectionSlots || []).filter((card) => {
        const k = normalizeMathCardStorageCode(card?.code ?? card?.problem)
        return Boolean(card && k && mathCardVaultCompletedByProgressSet.has(k))
      }).length,
    [mathCardCollectionSlots, mathCardVaultCompletedByProgressSet]
  )

  useEffect(() => {
    if (!recentlyAcquiredCardCode) return undefined
    const timer = window.setTimeout(() => setRecentlyAcquiredCardCode(null), 3000)
    return () => window.clearTimeout(timer)
  }, [recentlyAcquiredCardCode])

  useEffect(() => {
    if (!Array.isArray(mathCardCatalog) || mathCardCatalog.length === 0) return
    const valid = new Set()
    for (const c of mathCardCatalog) {
      const k = normalizeMathCardStorageCode(c?.code ?? c?.problem)
      if (k) valid.add(k)
    }
    const cleaned = [
      ...new Set((mathCardCollection || []).map((v) => normalizeMathCardStorageCode(v)).filter(Boolean)),
    ]
      .filter((k) => valid.has(k))
      .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
    if (JSON.stringify(mathCardCollection || []) !== JSON.stringify(cleaned)) {
      setMathCardCollection(cleaned)
      writeStoredMathCardCollection(cleaned)
    }
  }, [mathCardCatalog, mathCardCollection])

  const addMathCardToCollection = useCallback((card) => {
    const code = normalizeMathCardStorageCode(card?.code ?? card?.problem)
    if (!code) return
    setMathCardCollection((prev) => {
      const next = [
        ...new Set([...(prev || []).map((v) => normalizeMathCardStorageCode(v)).filter(Boolean), code]),
      ].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
      writeStoredMathCardCollection(next)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setIsLoading(true)
      setRows([])
      setHintsData([])
      setLoadError('')
      try {
        const [grouped, hintRows] = await Promise.race([
          Promise.all([
            loadGroupedTrainingData(DEFAULT_CSV_PATH),
            loadTrainingCsvRows(DEFAULT_HINTS_CSV_PATH),
          ]),
          new Promise((_, reject) =>
            window.setTimeout(() => reject(new Error('수련 데이터 로드 시간이 초과되었습니다.')), 10000)
          ),
        ])
        if (cancelled) return

        const targetLevels = trainingPlan?.stages?.length
  ? trainingPlan.stages.map((n) => String(n))
  : Object.keys(grouped).sort((a, b) => Number(a) - Number(b))

        const rawStageTypeFilters = trainingPlan?.stageTypeFilters || {}
        const normalizedStageTypeFilters = Object.fromEntries(
          Object.entries(rawStageTypeFilters).map(([stage, types]) => [
            String(stage),
            new Set(
              (Array.isArray(types) ? types : [])
                .map((type) => String(type || '').trim().toUpperCase())
                .filter(Boolean)
            ),
          ])
        )

        const merged = targetLevels.flatMap((level) => {
          const allowedTypes = normalizedStageTypeFilters[level]
          const levelRows = grouped[level] || []
          const filteredRows =
            allowedTypes && allowedTypes.size
              ? levelRows.filter((row) =>
                  allowedTypes.has(String(row?.['유형'] || '').trim().toUpperCase())
                )
              : levelRows

          return filteredRows.map((row) => ({
            ...row,
            __poolStage: Number(level),
          }))
        })

        const normalizedHints = (hintRows || [])
          .map((hintRow) => ({
            단계: String(hintRow?.['단계'] ?? '').trim(),
            유형: String(hintRow?.['유형'] ?? '').trim().toUpperCase(),
            type: normalizeTrainingKind(hintRow?.type),
            단계_순서: String(hintRow?.['단계_순서'] ?? '').trim(),
            힌트내용: String(hintRow?.['힌트내용'] ?? '').trim(),
          }))
          .filter((hint) => hint.단계 && hint.유형 && hint.type && hint.단계_순서 && hint.힌트내용)

        setRows(merged)
        setHintsData(normalizedHints)
        const inActiveSession =
          trainingSessionActiveRef.current || isResultViewRef.current
        if (!inActiveSession) {
          setProblemIdx(0)
          setStepIdx(0)
          setCompletedSteps([])
        }
        if (!merged.length) {
          setLoadError('수련문제 데이터를 찾지 못했습니다.')
        }
        console.log('[TrainingMode] loaded rows', merged)
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'CSV를 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [trainingDataLoadKey])

  const row = rows[problemIdx] || null
  const currentTier = resolveCanonicalDiagnosticTier(
    trainingPlan?.diagnosticTier ||
      trainingPlan?.diagnosticRecord?.level ||
      trainingPlan?.characterName ||
      '하'
  )
  const tierProblemSets = LEVEL_PROBLEM_SETS[currentTier] || LEVEL_PROBLEM_SETS.하
  const currentProblemCode = row ? getRowProblemCode(row) : ''
  const activeProblemSetIndex = useMemo(() => {
    if (!tierProblemSets.length) return 0
    if (!currentProblemCode) return 0
    const found = tierProblemSets.findIndex((setCodes) => setCodes.includes(currentProblemCode))
    return found >= 0 ? found : 0
  }, [tierProblemSets, currentProblemCode])

  const visibleTrainingSetCount = useMemo(
    () => countVisibleTrainingSets(tierProblemSets, problemProgressByCode),
    [tierProblemSets, problemProgressByCode],
  )

  const visibleKeywordTrainingSets = useMemo(() => {
    const sets = tierProblemSets || []
    const n = visibleTrainingSetCount
    if (!sets.length || n <= 0) return []

    const buildCardsForSet = (setIndex) => {
      const setCodes = (sets[setIndex] || []).slice(0, 5)
      return setCodes
        .map((problemCode) => {
          const code = String(problemCode || '').trim().toUpperCase()
          const m = code.match(/^(\d+)-([A-Z])$/)
          if (!m) return null
          const idx = findMatchingTrainingRowIndex(rows, Number(m[1]), m[2], '본문제')
          if (idx < 0) return null
          const baseRow = rows[idx] || null
          const keyword = String(baseRow?.keyword ?? '').trim()
          return {
            code,
            rowIndex: idx,
            keyword: keyword || code,
          }
        })
        .filter(Boolean)
    }

    return Array.from({ length: n }, (_, i) => ({
      setIndex: i,
      heading: `${i + 1}단계 수련 카드`,
      cards: buildCardsForSet(i),
    }))
  }, [tierProblemSets, rows, visibleTrainingSetCount])

  const recommendedKeywordCard = useMemo(
    () =>
      resolveRecommendedKeywordCard(
        visibleKeywordTrainingSets,
        problemProgressByCode,
        sheetCompletedProblemSet,
      ),
    [visibleKeywordTrainingSets, problemProgressByCode, sheetCompletedProblemSet],
  )

  /** 티어 기준 15문항(5×3) 전부 문항 완료일 때만 — 중간 묶음 후 전체 축하 화면 방지 */
  const allFifteenTrainingCodesComplete = useMemo(() => {
    const sets = tierProblemSets || []
    const codes = new Set()
    for (const set of sets) {
      for (const raw of set || []) {
        const code = String(raw || '').trim().toUpperCase()
        if (code) codes.add(code)
      }
    }
    if (codes.size === 0) return false
    for (const code of codes) {
      const p = problemProgressByCode[code]
      if (!isProblemProgressSuccess(p)) return false
    }
    return true
  }, [tierProblemSets, problemProgressByCode])

  useEffect(() => {
    setFlippingProblemCode(null)
  }, [activeProblemSetIndex, currentTier, rows.length])

  const currentTrainingProblemSummary = useMemo(() => {
    if (!row) return ''
    const stageRaw =
      row.__poolStage != null && Number.isFinite(Number(row.__poolStage))
        ? String(row.__poolStage)
        : String(row['단계'] ?? '').trim()
    const typeLetter = String(row['유형'] ?? '').trim().toUpperCase()
    const kind = normalizeTrainingKind(row?.type) || '본문제'
    const code =
      stageRaw && typeLetter ? `${stageRaw}-${typeLetter}` : stageRaw || typeLetter || '—'
    return `현재 수련 문제: ${code} / ${kind}`
  }, [row])

  const activeStageIndices = useMemo(
    () => (row ? getActiveTrainingStageIndices(row) : []),
    [row]
  )
  const activeStepCount = activeStageIndices.length
  const activeFlowPosition = Math.max(0, activeStageIndices.indexOf(stepIdx))

  const resultDisplay = useMemo(() => {
    if (isResultView && resultSessionSnapshot) {
      return {
        summary: resultSessionSnapshot.summary,
        problemText: resultSessionSnapshot.problemText,
        completedSteps: resultSessionSnapshot.completedSteps,
        activeStepCount: resultSessionSnapshot.activeStepCount,
        hintUsageCount: resultSessionSnapshot.hintUsageCount,
        problemCode: resultSessionSnapshot.problemCode,
        successCount: resultSessionSnapshot.successCount,
        failCount: resultSessionSnapshot.failCount,
        status: resultSessionSnapshot.status,
        awardedCard: resultSessionSnapshot.awardedCard,
      }
    }
    const steps = completedSteps || []
    return {
      summary: currentTrainingProblemSummary,
      problemText: String(row?.['문제 텍스트'] ?? ''),
      completedSteps: steps,
      activeStepCount,
      hintUsageCount,
      problemCode: '',
      successCount: steps.filter((s) => Number(s.processResult) > 0).length,
      failCount: steps.filter((s) => Number(s.processResult) === 0).length,
      status: '',
      awardedCard: null,
    }
  }, [
    isResultView,
    resultSessionSnapshot,
    currentTrainingProblemSummary,
    row,
    completedSteps,
    activeStepCount,
    hintUsageCount,
  ])

  useEffect(() => {
    if (!row || !activeStageIndices.length) return
    if (!activeStageIndices.includes(stepIdx)) {
      setStepIdx(activeStageIndices[0])
    }
  }, [row, activeStageIndices, stepIdx])

  const isFinalStepLocked =
    isLastActiveTrainingStageIndex(row, stepIdx) &&
    (answerCheckState === 'correct' || answerCheckState === 'revealed')
  const isAwaitingResultSave =
    !isResultView &&
    isResultReady &&
    isLastActiveTrainingStageIndex(row, stepIdx) &&
    completedSteps.length >= activeStepCount

  const showTrainingProblemBody = trainingSessionActive || isResultView
  /** 풀이 중: 문제 상단 고정 + 단계만 스크롤 / 결과 화면: 전체 세로 스크롤 */
  const useFixedTrainingLayout = showTrainingProblemBody && !isResultView

  const isLastActiveStep = useMemo(
    () => Boolean(row && isLastActiveTrainingStageIndex(row, stepIdx)),
    [row, stepIdx]
  )

  const currentStage = getTrainingStage(stepIdx)
  const isChoiceStep = Boolean(currentStage?.isChoice)
  const questionText = row && currentStage ? getStageQuestionText(row, currentStage) : ''
  const expectedAnswer = row && currentStage ? getStageGradeAnswer(row, currentStage) : ''
  const expectedChoiceToken =
    row && currentStage ? getStageChoiceGradeAnswer(row, currentStage) : ''
  const isStepJudged =
    answerCheckState === 'correct' || answerCheckState === 'revealed'

  const choiceOptionsParsed = useMemo(() => {
    if (!isChoiceStep || !questionText) return { prompt: '', options: [] }
    return parseChoiceOptionsFromQuestion(questionText)
  }, [isChoiceStep, questionText])

  const currentStepHintAvailable = useMemo(
    () => isTrainingHintAvailableForStep(row, stepIdx, hintsData),
    [row, stepIdx, hintsData]
  )

  const showStepFocusedLearningButton = false

  const diagnosticTier = useMemo(
    () =>
      resolveCanonicalDiagnosticTier(
        trainingPlan?.diagnosticTier ||
          trainingPlan?.diagnosticRecord?.level ||
          trainingPlan?.characterName ||
          '하',
      ),
    [trainingPlan],
  )
  const isOkdongjaTier = diagnosticTier === '하'

  const stepFocusedConceptBundles = useMemo(() => {
    if (!scaffoldingConceptKey) return []
    return collectStepTrainingConceptBundles(scaffoldingConceptKey)
  }, [scaffoldingConceptKey])

  const closeScaffoldingSession = useCallback(() => {
    setScaffoldingSession(null)
    setScaffoldingChoiceDialog(null)
    setScaffoldingConceptKey(null)
    setIsStepFocusedLearningOpen(false)
  }, [])

  const startScaffoldingSession = useCallback(() => {
    if (!row) return
    const steps = getScaffoldingStepsForRow(row)
    if (!steps.length) return
    setScaffoldingChoiceDialog(null)
    setScaffoldingConceptKey(null)
    setIsStepFocusedLearningOpen(false)
    setScaffoldingSession({
      steps,
      stepIndex: 0,
      showRemember: false,
      wrongPickCount: 0,
      isFinished: false,
    })
  }, [row])

  useEffect(() => {
    setIsStepFocusedLearningOpen(false)
    setScaffoldingConceptKey(null)
    setScaffoldingSession(null)
    setScaffoldingChoiceDialog(null)
  }, [stepIdx, problemIdx])

  const resetOuterScrollPosition = useCallback(() => {
    const mainEl = document.querySelector('main')
    if (mainEl && mainEl.scrollTop !== 0) mainEl.scrollTop = 0
    if (window.scrollY !== 0) window.scrollTo(0, 0)
  }, [])

  const clearAnswerScrollGuard = useCallback(() => {
    answerScrollGuardActiveRef.current = false
    answerScrollAnchorRef.current = null
    userStepScrollRef.current = false
  }, [])

  const scrollToCurrentStepPanel = useCallback(() => {
    resetOuterScrollPosition()
    const scrollEl = stepHistoryScrollRef.current

    const apply = () => {
      resetOuterScrollPosition()
      if (!scrollEl) return

      if (isLastActiveStep) {
        scrollEl.scrollTop = scrollEl.scrollHeight
        return
      }

      const panelEl = activeStepPanelRef.current
      if (!panelEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight
        return
      }

      const containerRect = scrollEl.getBoundingClientRect()
      const panelRect = panelEl.getBoundingClientRect()
      if (panelRect.bottom > containerRect.bottom + 1) {
        scrollEl.scrollTop += panelRect.bottom - containerRect.bottom
      } else if (panelRect.top < containerRect.top - 1) {
        scrollEl.scrollTop -= containerRect.top - panelRect.top
      } else if (panelRect.bottom <= containerRect.top) {
        scrollEl.scrollTop = scrollEl.scrollHeight
      }
    }

    apply()
    window.requestAnimationFrame(() => {
      apply()
      window.requestAnimationFrame(apply)
    })
  }, [resetOuterScrollPosition, isLastActiveStep])

  useEffect(() => {
    clearAnswerScrollGuard()
    scrollToCurrentStepPanel()
  }, [stepIdx, completedSteps.length, clearAnswerScrollGuard, scrollToCurrentStepPanel])

  const captureAnswerScrollAnchor = useCallback(() => {
    const scrollEl = stepHistoryScrollRef.current
    answerScrollAnchorRef.current = {
      scrollTop: scrollEl?.scrollTop ?? 0,
    }
  }, [])

  const restoreAnswerScrollAnchor = useCallback(() => {
    resetOuterScrollPosition()
    if (isLastActiveStep || suspendScrollAnchorForVkRef.current) return
    const anchor = answerScrollAnchorRef.current
    if (!anchor || !answerScrollGuardActiveRef.current) return
    const scrollEl = stepHistoryScrollRef.current
    if (scrollEl && Math.abs(scrollEl.scrollTop - anchor.scrollTop) > 1) {
      scrollEl.scrollTop = anchor.scrollTop
    }
  }, [resetOuterScrollPosition, isLastActiveStep])

  const scrollPanelAboveMathKeyboard = useCallback(() => {
    if (isLastActiveStep || !useFixedTrainingLayout) return
    resetOuterScrollPosition()
    const scrollEl = stepHistoryScrollRef.current
    const panelEl = activeStepPanelRef.current
    if (!scrollEl || !panelEl) return

    const vk = window.mathVirtualKeyboard
    let visibleBottom = window.innerHeight
    if (vk?.visible && vk.boundingRect?.top > 0) {
      visibleBottom = vk.boundingRect.top - 8
    } else if (window.visualViewport) {
      visibleBottom = window.visualViewport.offsetTop + window.visualViewport.height - 8
    }

    const panelRect = panelEl.getBoundingClientRect()
    if (panelRect.bottom > visibleBottom) {
      scrollEl.scrollTop += panelRect.bottom - visibleBottom
    }
    if (panelRect.top < 8) {
      scrollEl.scrollTop += panelRect.top - 8
    }
  }, [isLastActiveStep, useFixedTrainingLayout, resetOuterScrollPosition])

  const handleCloseMathVirtualKeyboard = useCallback(() => {
    if (typeof window.mathVirtualKeyboard?.hide === 'function') {
      window.mathVirtualKeyboard.hide()
    }
  }, [])

  const beginAnswerScrollGuard = useCallback(() => {
    resetOuterScrollPosition()
    if (isLastActiveStep) {
      answerScrollGuardActiveRef.current = true
      window.requestAnimationFrame(resetOuterScrollPosition)
      window.requestAnimationFrame(() => window.requestAnimationFrame(resetOuterScrollPosition))
      return
    }
    if (suspendScrollAnchorForVkRef.current) {
      scrollPanelAboveMathKeyboard()
      return
    }
    captureAnswerScrollAnchor()
    answerScrollGuardActiveRef.current = true
    restoreAnswerScrollAnchor()
    window.requestAnimationFrame(restoreAnswerScrollAnchor)
    window.requestAnimationFrame(() => window.requestAnimationFrame(restoreAnswerScrollAnchor))
  }, [
    captureAnswerScrollAnchor,
    restoreAnswerScrollAnchor,
    resetOuterScrollPosition,
    scrollPanelAboveMathKeyboard,
    isLastActiveStep,
  ])

  const endAnswerScrollGuard = useCallback(() => {
    if (!isLastActiveStep) return
    answerScrollGuardActiveRef.current = false
    answerScrollAnchorRef.current = null
  }, [isLastActiveStep])

  const handleAnswerFieldInput = useCallback(() => {
    resetOuterScrollPosition()
    if (isLastActiveStep) {
      window.requestAnimationFrame(resetOuterScrollPosition)
      return
    }
    if (suspendScrollAnchorForVkRef.current) {
      scrollPanelAboveMathKeyboard()
      window.requestAnimationFrame(scrollPanelAboveMathKeyboard)
      return
    }
    if (userStepScrollRef.current) {
      captureAnswerScrollAnchor()
      userStepScrollRef.current = false
      return
    }
    restoreAnswerScrollAnchor()
    window.requestAnimationFrame(restoreAnswerScrollAnchor)
  }, [
    captureAnswerScrollAnchor,
    restoreAnswerScrollAnchor,
    resetOuterScrollPosition,
    scrollPanelAboveMathKeyboard,
    isLastActiveStep,
  ])

  /** 마지막 단계(입력칸 하단 고정): 클릭 시 바깥 스크롤만 방지 */
  const handleLastStepAnswerMouseDown = useCallback(
    (event) => {
      if (!isLastActiveStep) return
      if (event.target.closest('button') && !event.target.closest('math-field')) return
      if (
        !event.target.closest('input') &&
        !event.target.closest('math-field') &&
        !event.target.closest('.training-math-field-host')
      ) {
        return
      }
      event.preventDefault()
      answerScrollGuardActiveRef.current = true
      const focusTarget =
        event.target.closest('input') ??
        event.target.closest('math-field') ??
        textInputRef.current ??
        mathFieldRef.current
      if (typeof focusTarget?.focus === 'function') {
        focusTarget.focus({ preventScroll: true })
      }
      resetOuterScrollPosition()
      window.requestAnimationFrame(resetOuterScrollPosition)
      window.requestAnimationFrame(() => window.requestAnimationFrame(resetOuterScrollPosition))
    },
    [isLastActiveStep, resetOuterScrollPosition],
  )

  /** 풀이 중: 바깥(main) 스크롤 잠금 — 단계 영역만 스크롤 */
  useEffect(() => {
    const mainEl = document.querySelector('main')
    if (!mainEl) return undefined
    if (useFixedTrainingLayout) {
      mainEl.classList.add('training-solving-main-lock')
      resetOuterScrollPosition()
    } else {
      mainEl.classList.remove('training-solving-main-lock')
    }
    return () => {
      mainEl.classList.remove('training-solving-main-lock')
    }
  }, [useFixedTrainingLayout, resetOuterScrollPosition])

  useEffect(() => {
    if (!useFixedTrainingLayout) return undefined
    resetOuterScrollPosition()
    const mainEl = document.querySelector('main')
    const onOuterScroll = () => resetOuterScrollPosition()
    mainEl?.addEventListener('scroll', onOuterScroll, { passive: true })
    window.addEventListener('scroll', onOuterScroll, { passive: true })
    return () => {
      mainEl?.removeEventListener('scroll', onOuterScroll)
      window.removeEventListener('scroll', onOuterScroll)
    }
  }, [useFixedTrainingLayout, stepIdx, resetOuterScrollPosition])

  useEffect(() => {
    if (!useFixedTrainingLayout) return undefined
    const scrollEl = stepHistoryScrollRef.current
    const markUserStepScroll = () => {
      userStepScrollRef.current = true
      if (answerScrollGuardActiveRef.current) {
        captureAnswerScrollAnchor()
      }
    }
    scrollEl?.addEventListener('wheel', markUserStepScroll, { passive: true })
    scrollEl?.addEventListener('touchmove', markUserStepScroll, { passive: true })
    const vv = window.visualViewport
    const onViewportChange = () => {
      resetOuterScrollPosition()
      if (suspendScrollAnchorForVkRef.current) {
        scrollPanelAboveMathKeyboard()
        return
      }
      if (answerScrollGuardActiveRef.current) {
        restoreAnswerScrollAnchor()
      }
    }
    vv?.addEventListener('resize', onViewportChange)
    vv?.addEventListener('scroll', onViewportChange)
    return () => {
      scrollEl?.removeEventListener('wheel', markUserStepScroll)
      scrollEl?.removeEventListener('touchmove', markUserStepScroll)
      vv?.removeEventListener('resize', onViewportChange)
      vv?.removeEventListener('scroll', onViewportChange)
    }
  }, [
    useFixedTrainingLayout,
    stepIdx,
    completedSteps.length,
    captureAnswerScrollAnchor,
    restoreAnswerScrollAnchor,
    resetOuterScrollPosition,
    scrollPanelAboveMathKeyboard,
  ])

  /** 정답이 x=숫자(예: x=4)이면 x= 접두·숫자만 입력 (5단계) */
  const isNumericXValueStep = useMemo(
    () => isXValueNumericAnswer(expectedAnswer),
    [expectedAnswer]
  )

  const isStep5EquationSolve = useMemo(
    () =>
      Boolean(
        row &&
          isSecondToLastActiveTrainingStageIndex(row, stepIdx) &&
          isNumericXValueStep,
      ),
    [row, stepIdx, isNumericXValueStep],
  )

  const scaffoldingStepsForProblem = useMemo(
    () => (row ? getScaffoldingStepsForRow(row) : []),
    [row],
  )

  const hasScaffoldingForCurrentProblem = scaffoldingStepsForProblem.length > 0

  const shouldOfferScaffoldingOnStep5 =
    isOkdongjaTier && isStep5EquationSolve && hasScaffoldingForCurrentProblem

  const handleStep5WrongAfterAttempt = useCallback(
    (streak) => {
      if (!shouldOfferScaffoldingOnStep5) return false
      if (streak === 1) {
        setScaffoldingChoiceDialog({ streak })
        return true
      }
      if (streak === 2) {
        startScaffoldingSession()
        return true
      }
      return false
    },
    [shouldOfferScaffoldingOnStep5, startScaffoldingSession],
  )

  const handleScaffoldingChoiceSelect = useCallback((choiceIndex) => {
    setScaffoldingSession((prev) => {
      if (!prev || prev.isFinished) return prev
      const step = prev.steps[prev.stepIndex]
      if (!step) return prev
      if (choiceIndex === step.correctChoice) {
        const nextIndex = prev.stepIndex + 1
        if (nextIndex >= prev.steps.length) {
          return {
            ...prev,
            stepIndex: nextIndex,
            showRemember: false,
            wrongPickCount: 0,
            isFinished: true,
          }
        }
        return { ...prev, stepIndex: nextIndex, showRemember: false, wrongPickCount: 0 }
      }
      return {
        ...prev,
        showRemember: true,
        wrongPickCount: (prev.wrongPickCount ?? 0) + 1,
      }
    })
  }, [])

  const handleScaffoldingLearnConcept = useCallback((conceptKey) => {
    const key = String(conceptKey ?? '').trim()
    if (!key) return
    setScaffoldingConceptKey(key)
    setIsStepFocusedLearningOpen(true)
  }, [])

  const activeScaffoldStep =
    scaffoldingSession && !scaffoldingSession.isFinished
      ? scaffoldingSession.steps[scaffoldingSession.stepIndex] ?? null
      : null

  /** 마지막·그 전 단계(숫자만 x= 등)는 가상 키보드 비표시 — 스크롤 튐 방지 */
  const disableMathVirtualKeyboard = useMemo(() => {
    if (!row || isNumericXValueStep) return true
    return (
      isLastActiveTrainingStageIndex(row, stepIdx) ||
      isSecondToLastActiveTrainingStageIndex(row, stepIdx)
    )
  }, [row, stepIdx, isNumericXValueStep])

  useEffect(() => {
    if (!isMathLiveReady || disableMathVirtualKeyboard) {
      setIsMathVkOpen(false)
      suspendScrollAnchorForVkRef.current = false
      return undefined
    }
    const vk = window.mathVirtualKeyboard
    if (!vk?.addEventListener) return undefined

    const syncVkOpenState = (open) => {
      setIsMathVkOpen(open)
      suspendScrollAnchorForVkRef.current = open
    }

    const onVkToggle = () => {
      const open = Boolean(vk.visible)
      syncVkOpenState(open)
      if (open) {
        scrollPanelAboveMathKeyboard()
        window.requestAnimationFrame(() => {
          scrollPanelAboveMathKeyboard()
          window.requestAnimationFrame(scrollPanelAboveMathKeyboard)
        })
      }
    }

    const onVkGeometry = () => {
      if (vk.visible) scrollPanelAboveMathKeyboard()
    }

    vk.addEventListener('virtual-keyboard-toggle', onVkToggle)
    vk.addEventListener('geometrychange', onVkGeometry)
    syncVkOpenState(Boolean(vk.visible))

    return () => {
      vk.removeEventListener('virtual-keyboard-toggle', onVkToggle)
      vk.removeEventListener('geometrychange', onVkGeometry)
      suspendScrollAnchorForVkRef.current = false
    }
  }, [
    isMathLiveReady,
    disableMathVirtualKeyboard,
    scrollPanelAboveMathKeyboard,
    stepIdx,
    problemIdx,
  ])

  /** 마지막 단계·x=숫자 단계는 일반 텍스트 입력(수식 패드 없음) */
  const usePlainTextAnswerInput = isNumericXValueStep || isLastActiveStep

  const readMathFieldPlainAnswer = () => {
    const mf = mathFieldRef.current
    if (!mf || typeof mf.getValue !== 'function') return ''
    return latexToPlain((mf.getValue('latex') || '').trim())
  }

  const resolveTextAnswerForGrading = () => {
    if (isNumericXValueStep) return formatStudentXValueAnswer(textAnswer)
    const fromField = readMathFieldPlainAnswer()
    return (fromField || textAnswer).trim()
  }

  const gradedTextAnswer = useMemo(() => resolveTextAnswerForGrading(), [
    isNumericXValueStep,
    textAnswer,
    stepIdx,
    problemIdx,
  ])

  const canAdvance = useMemo(() => {
    if (!row || !questionText || !currentStage) return false
    if (isChoiceStep) {
      return choiceAnswerTextMatch(selectedChoice, expectedAnswer, {
        studentToken: selectedChoiceToken,
        expectedChoiceToken,
      })
    }
    if (!String(textAnswer || '').trim()) return false
    const rowType = String(row['유형'] ?? '').trim().toUpperCase()
    const rowStage = Number(row.__poolStage ?? row['학습단계'] ?? row['단계'])
    const allowUnorderedPairAtStep3 =
      stepIdx === 2 && rowStage === 5 && (rowType === 'A' || rowType === 'C')
    return gradeTrainingTextAnswer(gradedTextAnswer, expectedAnswer, {
      stepIdx,
      allowSwappedEquationSides: true,
      allowUnorderedPair: allowUnorderedPairAtStep3,
    })
  }, [
    row,
    questionText,
    currentStage,
    isChoiceStep,
    selectedChoice,
    selectedChoiceToken,
    expectedChoiceToken,
    expectedAnswer,
    stepIdx,
    gradedTextAnswer,
  ])

  useEffect(() => {
    setBlankValues({})
    setTextAnswer('')
    setSelectedChoice('')
    setSelectedChoiceToken('')
    setAnswerCheckState('')
    setWrongAttemptStreak(0)
    setStepWrongCounts(emptyStepCounts())
    setStepHintUsed(emptyStepFlags())
    stepWrongCountsRef.current = emptyStepCounts()
    stepHintUsedRef.current = emptyStepFlags()
    setCompletedSteps([])
    revealedStudentAnswerByStepRef.current = {}
    setActiveBlankKey('')
    blankInputRefs.current = {}
    setIsResultReady(false)
    if (row) {
      setStepIdx(getFirstActiveTrainingStageIndex(row))
    }
  }, [problemIdx, row])

  useEffect(() => {
    setSelectedChoice('')
    setSelectedChoiceToken('')
    setTextAnswer('')
    setAnswerCheckState('')
    setWrongAttemptStreak(0)
  }, [stepIdx, problemIdx])

  const stepLabel = useMemo(() => getTrainingStageDisplayLabel(stepIdx), [stepIdx])

  const renderStepInputHint = () => {
    if (isChoiceStep) return null
    if (answerCheckState !== '' || canAdvance) return null
    return <span className="text-xs font-medium text-slate-500">입력 후 다음 단계로</span>
  }

  const renderTextWithFractions = (text, keyPrefix = 'frac') => {
    const raw = preprocessFractionDisplayText(String(text || ''))
    if (!raw) return null
    const nodes = []
    let cursor = 0
    let match
    let idx = 0
    FRACTION_TOKEN_REGEX.lastIndex = 0

    while ((match = FRACTION_TOKEN_REGEX.exec(raw)) !== null) {
      const start = match.index
      const token = match[0]
      if (start > cursor) {
        nodes.push(<span key={`${keyPrefix}-txt-${idx}`}>{raw.slice(cursor, start)}</span>)
        idx += 1
      }
      nodes.push(
        <math-field
          key={`${keyPrefix}-mf-${idx}`}
          read-only
          value={plainToDisplayLatex(token)}
          className="mm-inline-math mx-0.5 inline-block align-middle text-base"
        />
      )
      idx += 1
      cursor = start + token.length
    }

    if (cursor < raw.length) {
      nodes.push(<span key={`${keyPrefix}-txt-${idx}`}>{raw.slice(cursor)}</span>)
    }
    return nodes
  }

  /** 결과 화면 정답 표시 — 줄바꿈·쉼표 구분 복수 정답을 한 줄(필요 시 wrap)로 */
  const splitDisplayAnswerParts = (text) => {
    const raw = String(text || '').trim()
    if (!raw) return []
    if (/\n/.test(raw)) {
      const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      if (lines.length >= 2) return lines
    }
    if (/,/.test(raw) && !raw.includes('=')) {
      const parts = raw.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean)
      if (parts.length >= 2) return parts
    }
    return [raw]
  }

  const renderHistoryCorrectAnswer = (text, keyPrefix = 'history-correct') => {
    const parts = splitDisplayAnswerParts(text)
    if (parts.length <= 1) {
      return renderTextWithFractions(text, keyPrefix)
    }
    return (
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {parts.map((part, index) => (
          <span key={`${keyPrefix}-part-${index}`} className="inline-flex items-center">
            {renderTextWithFractions(part, `${keyPrefix}-${index}`)}
          </span>
        ))}
      </span>
    )
  }

  const syncMathFieldToTextAnswer = () => {
    const plain = readMathFieldPlainAnswer()
    if (!plain && !mathFieldRef.current) return
    setTextAnswer(plain)
    setAnswerCheckState('')
  }

  const insertFractionTemplate = (targetEl) => {
    if (!targetEl) return
    if (typeof targetEl.executeCommand === 'function') {
      targetEl.executeCommand(['insert', '\\frac{#?}{#?}'])
    } else if (typeof targetEl.insert === 'function') {
      targetEl.insert('\\frac{#?}{#?}')
    }
  }

  /** MathLive 수학 모드에서도 띄어쓰기가 보이도록 삽입 (main.js 진단 모드와 동일) */
  const insertPlainSpace = (targetEl) => {
    if (!targetEl) return
    if (typeof targetEl.executeCommand === 'function') {
      targetEl.executeCommand(['insert', '\\text{ }'])
    } else if (typeof targetEl.insert === 'function') {
      targetEl.insert('\\text{ }')
    }
    syncMathFieldToTextAnswer()
  }

  const attachMathFieldInputHelpers = (mf, { disableVirtualKeyboard = false } = {}) => {
    if (!mf) return () => {}

    const onKeyDown = (event) => {
      if (event.key === ' ') {
        event.preventDefault()
        insertPlainSpace(mf)
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        insertFractionTemplate(mf)
        syncMathFieldToTextAnswer()
      }
    }

    const onBeforeInput = (event) => {
      if (event.inputType === 'insertText' && event.data === ' ') {
        event.preventDefault()
        insertPlainSpace(mf)
        return
      }
      if (event.inputType === 'insertText' && event.data === '/') {
        event.preventDefault()
        insertFractionTemplate(mf)
        syncMathFieldToTextAnswer()
      }
    }

    const onInput = () => {
      syncMathFieldToTextAnswer()
      handleAnswerFieldInput()
    }

    const onFocus = () => {
      if (!disableVirtualKeyboard) {
        applyTrainingMathVirtualKeyboard()
      }
      beginAnswerScrollGuard()
      resetOuterScrollPosition()
      if (
        disableVirtualKeyboard &&
        typeof window.mathVirtualKeyboard?.hide === 'function'
      ) {
        window.mathVirtualKeyboard.hide()
      }
    }

    const onFocusIn = () => {
      if (!disableVirtualKeyboard) {
        applyTrainingMathVirtualKeyboard()
      }
    }

    const onBlur = () => {
      endAnswerScrollGuard()
    }

    mf.addEventListener('keydown', onKeyDown)
    mf.addEventListener('beforeinput', onBeforeInput)
    mf.addEventListener('input', onInput)
    mf.addEventListener('focusin', onFocusIn)
    mf.addEventListener('focus', onFocus)
    mf.addEventListener('blur', onBlur)

    return () => {
      mf.removeEventListener('keydown', onKeyDown)
      mf.removeEventListener('beforeinput', onBeforeInput)
      mf.removeEventListener('input', onInput)
      mf.removeEventListener('focusin', onFocusIn)
      mf.removeEventListener('focus', onFocus)
      mf.removeEventListener('blur', onBlur)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!window.customElements?.get('math-field')) {
          await import('mathlive')
        }
        if (!cancelled) {
          setIsMathLiveReady(true)
          applyTrainingMathVirtualKeyboard()
        }
      } catch (error) {
        console.error('[TrainingMode] mathlive load failed', error)
        if (!cancelled) setLoadError('수식 입력기를 불러오지 못했습니다.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (usePlainTextAnswerInput) return undefined
    const host = mathFieldHostRef.current
    if (!host || !isMathLiveReady) return undefined
    host.innerHTML = ''
    const mf = document.createElement('math-field')
    mf.setAttribute(
      'math-virtual-keyboard-policy',
      disableMathVirtualKeyboard ? 'manual' : 'auto'
    )
    mf.setAttribute(
      'style',
      'min-height:38px;width:100%;border:1px solid rgb(252 211 77);border-radius:0.75rem;padding:0.3rem 0.65rem;background-color:white;font-size:0.9375rem;'
    )
    host.appendChild(mf)
    mathFieldRef.current = mf
    let hideMenu = () => {}
    if (disableMathVirtualKeyboard) {
      hideMenu = () => {
        try {
          mf.menuItems = []
        } catch {
          /* ignore */
        }
      }
      hideMenu()
      mf.addEventListener?.('mount', hideMenu)
    }
    const detachHelpers = attachMathFieldInputHelpers(mf, {
      disableVirtualKeyboard: disableMathVirtualKeyboard,
    })
    return () => {
      detachHelpers()
      mf.removeEventListener?.('mount', hideMenu)
      if (host.contains(mf)) host.removeChild(mf)
      mathFieldRef.current = null
    }
  }, [problemIdx, stepIdx, isMathLiveReady, usePlainTextAnswerInput, disableMathVirtualKeyboard])

  const renderMathPad = (withXPrefix = false, options = {}) => {
    const { hideMathField = false } = options
    return (
      <div className="space-y-1.5">
        {!hideMathField && (
          <div className="flex items-stretch gap-2">
            {withXPrefix && (
              <span className="inline-flex items-center rounded-xl border border-yellow-300 bg-yellow-50 px-2.5 py-1.5 text-sm font-black text-slate-800">
                x=
              </span>
            )}
            {isMathLiveReady ? (
              <div
                ref={mathFieldHostRef}
                className={`training-math-field-host flex-1${disableMathVirtualKeyboard ? ' training-math-field-host--no-vk' : ''}`}
              />
            ) : (
              <div className="flex min-h-[38px] flex-1 items-center rounded-xl border border-yellow-300 bg-white px-2.5 py-1.5 text-xs text-slate-500">
                수식 입력기를 준비하는 중...
              </div>
            )}
          </div>
        )}
        {isMathVkOpen && !disableMathVirtualKeyboard ? (
          <button
            type="button"
            onClick={handleCloseMathVirtualKeyboard}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 sm:text-sm"
          >
            키보드 닫기
          </button>
        ) : null}
      </div>
    )
  }

  const applyWrongAttempt = () => {
    const nextWrongStreak = Number(stepWrongCountsRef.current[stepIdx] || 0) + 1
    setWrongAttemptStreak(nextWrongStreak)
    setStepWrongCounts((prev) => {
      const next = [...prev]
      next[stepIdx] = nextWrongStreak
      stepWrongCountsRef.current = next
      return next
    })
    setAnswerCheckState('wrong')
    return nextWrongStreak
  }

  const tryAutoRevealAfterWrong = (nextWrongStreak, studentAnswerBeforeReveal) => {
    const usedHintAtCurrentStep = Boolean(hintFlags[stepIdx])
    const isStep5 = Boolean(row && isSecondToLastActiveTrainingStageIndex(row, stepIdx))
    const reachedAutoRevealCondition = isStep5
      ? nextWrongStreak >= 3
      : (usedHintAtCurrentStep && nextWrongStreak >= 2) ||
        (!usedHintAtCurrentStep && nextWrongStreak >= 3)
    if (!reachedAutoRevealCondition) return false
    const revealedAnswer = (expectedAnswer || '').trim()
    revealedStudentAnswerByStepRef.current[stepIdx] = studentAnswerBeforeReveal
    if (!isChoiceStep && revealedAnswer) setTextAnswer(revealedAnswer)
    setAnswerCheckState('revealed')
    setWrongAttemptStreak(0)
    const triggerMessage = usedHintAtCurrentStep ? '힌트 사용 후 오답 2회' : '힌트 미사용 오답 3회'
    showSimpleNoticeDialog('안내', triggerMessage + '로 정답을 제공합니다.\n정답: ' + (revealedAnswer || '정답 정보 없음'))
    window.setTimeout(() => handleNext({ forceProceed: true }), 0)
    return true
  }

  const handleChoicePick = (choiceLabel, choiceToken) => {
    if (isStepJudged) return
    const answerText = String(choiceLabel ?? '').trim()
    const answerToken = String(choiceToken ?? '').trim()
    setSelectedChoice(answerText)
    setSelectedChoiceToken(answerToken)
    if (
      choiceAnswerTextMatch(answerText, expectedAnswer, {
        studentToken: answerToken,
        expectedChoiceToken,
      })
    ) {
      setAnswerCheckState('correct')
      setWrongAttemptStreak(0)
      window.setTimeout(
        () =>
          handleNext({
            forceProceed: true,
            submittedAnswer: answerText,
            submittedChoiceToken: answerToken,
          }),
        0
      )
      return
    }
    const streak = applyWrongAttempt()
    tryAutoRevealAfterWrong(streak, answerText)
  }

  const renderStepFocusedLearningCta = () => {
    if (!showStepFocusedLearningButton) return null
    return (
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-violet-100/90 bg-violet-50/40 px-2.5 py-2">
        <button
          type="button"
          className={stepFocusedLearningButtonClass}
          onClick={() => setIsStepFocusedLearningOpen(true)}
        >
          💡 어려우면 먼저 학습해보기
        </button>
        <p className="min-w-0 flex-1 text-left text-sm font-medium leading-snug text-slate-800/90 sm:text-[0.9375rem]">
          개념 설명과 연습문제를 먼저 학습할 수 있어요.
        </p>
      </div>
    )
  }

  const renderQuestionBody = ({ compact = false } = {}) => {
    if (!row) return null
    if (isChoiceStep) {
      const { prompt, options } = choiceOptionsParsed
      return (
        <div className={compact ? 'space-y-2' : 'space-y-4'}>
          <p
            className={
              compact
                ? 'line-clamp-3 text-sm leading-snug text-slate-800'
                : 'whitespace-pre-wrap text-base leading-[1.8] text-slate-800 sm:text-lg sm:leading-[1.85]'
            }
          >
            {renderTextWithFractions(prompt || questionText, `choice-prompt-${problemIdx}`)}
          </p>
          {!compact ? renderStepFocusedLearningCta() : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((opt) => (
              <button
                key={`choice-${opt.token}`}
                type="button"
                disabled={isStepJudged}
                onClick={() => handleChoicePick(opt.label, opt.token)}
                className={[
                  'rounded-xl border-2 px-3 py-3 text-left text-sm font-bold transition sm:text-base',
                  selectedChoice === opt.label
                    ? 'border-violet-500 bg-violet-50 text-violet-900'
                    : 'border-slate-200 bg-white text-slate-800 hover:border-violet-300',
                  isStepJudged ? 'opacity-60' : '',
                ].join(' ')}
              >
                <span className="mr-1.5 text-violet-700">{opt.display}</span>
                {opt.label}
              </button>
            ))}
          </div>
          {!compact && currentStepHintAvailable ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              <button
                type="button"
                onClick={handleHint}
                disabled={isStepJudged}
                className={softButtonClass}
              >
                힌트 보기
              </button>
            </div>
          ) : null}
        </div>
      )
    }

    const plainInputProps = {
      ref: textInputRef,
      type: 'text',
      autoComplete: 'off',
      disabled: isStepJudged,
      value: textAnswer,
      onFocus: () => {
        beginAnswerScrollGuard()
        resetOuterScrollPosition()
      },
      onBlur: endAnswerScrollGuard,
    }

    if (compact) {
      return (
        <div className="space-y-2">
          <p className="line-clamp-3 text-sm leading-snug text-slate-800">
            {renderTextWithFractions(questionText, `question-${problemIdx}-${stepIdx}`)}
          </p>
          <div className="flex items-stretch gap-2">
            {isNumericXValueStep ? (
              <span className="inline-flex shrink-0 items-center rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-1.5 text-sm font-black text-slate-800">
                x=
              </span>
            ) : null}
            <input
              {...plainInputProps}
              inputMode={isNumericXValueStep ? 'decimal' : 'text'}
              onChange={(event) => {
                const raw = event.target.value
                const next = isNumericXValueStep ? raw.replace(/[^0-9.\-]/g, '') : raw
                setTextAnswer(next)
                setAnswerCheckState('')
                handleAnswerFieldInput()
              }}
              className="min-w-0 flex-1 rounded-lg border border-yellow-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
              placeholder={isNumericXValueStep ? '숫자만 입력' : '답 입력'}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCheckAnswer}
              disabled={isStepJudged}
              className="shrink-0 rounded-lg border border-blue-400 bg-white px-3 py-1.5 text-sm font-bold text-blue-800 transition hover:bg-blue-50"
            >
              입력
            </button>
            {currentStepHintAvailable ? (
              <button
                type="button"
                onClick={handleHint}
                disabled={isStepJudged}
                className="shrink-0 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-800 transition hover:bg-violet-100 sm:text-sm"
              >
                힌트 보기
              </button>
            ) : null}
            {renderStepInputHint()}
          </div>
          {answerCheckState === 'wrong' ? (
            <p className="text-xs font-semibold text-rose-700">
              {currentStepHintAvailable
                ? '다시 생각해 보세요. 힌트를 써도 좋아요.'
                : '다시 생각해 보세요.'}
            </p>
          ) : null}
          {answerCheckState === 'correct' ? (
            <p className="text-xs font-semibold text-emerald-700">정답입니다!</p>
          ) : null}
        </div>
      )
    }

    return (
      <div className="space-y-2.5">
        <p className="whitespace-pre-wrap text-base leading-[1.8] text-slate-800 sm:text-lg sm:leading-[1.85]">
          {renderTextWithFractions(questionText, `question-${problemIdx}-${stepIdx}`)}
        </p>
        {renderStepFocusedLearningCta()}
        <div className="mt-1 space-y-2">
        <label className="block text-sm font-black leading-normal text-violet-950">답 입력</label>
        {usePlainTextAnswerInput ? (
          <div className="flex items-stretch gap-2">
            {isNumericXValueStep ? (
              <span className="inline-flex items-center rounded-xl border border-yellow-300 bg-yellow-50 px-2.5 py-1.5 text-sm font-black text-slate-800">
                x=
              </span>
            ) : null}
            <input
              {...plainInputProps}
              inputMode={isNumericXValueStep ? 'decimal' : 'text'}
              onChange={(event) => {
                const raw = event.target.value
                const next = isNumericXValueStep ? raw.replace(/[^0-9.\-]/g, '') : raw
                setTextAnswer(next)
                setAnswerCheckState('')
                handleAnswerFieldInput()
              }}
              className="flex-1 rounded-xl border border-yellow-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
              placeholder={isNumericXValueStep ? '숫자만 입력' : '답 입력'}
            />
          </div>
        ) : (
          renderMathPad(false)
        )}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={handleCheckAnswer}
            disabled={isStepJudged}
            className={submitAnswerButtonClass}
            title="정답 입력 후 입력 버튼을 누르세요"
          >
            입력
          </button>
          {currentStepHintAvailable ? (
            <button
              type="button"
              onClick={handleHint}
              disabled={isStepJudged}
              className={softButtonClass}
            >
              힌트 보기
            </button>
          ) : null}
          {renderStepInputHint()}
        </div>
        </div>
      </div>
    )
  }

  const renderActiveStepPanel = ({ pinned = false } = {}) => {
    if (isAwaitingResultSave || isFinalStepLocked) return null
    return (
      <div
        ref={activeStepPanelRef}
        className={[
          'training-step-input-panel mb-1 rounded-2xl border border-blue-200 bg-white p-3 sm:p-4',
          pinned
            ? 'training-step-input-panel--pinned training-step-input-panel--compact shrink-0'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={pinned ? handleLastStepAnswerMouseDown : undefined}
      >
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
            수련 {activeFlowPosition + 1} / {activeStepCount || 1}
          </span>
          <span className="text-sm font-extrabold text-slate-700 sm:text-base">{stepLabel}</span>
        </div>
        <div className={pinned ? 'mt-1.5' : 'mt-4'}>{renderQuestionBody({ compact: pinned })}</div>
        {!pinned && answerCheckState === 'correct' && (
          <p className="mt-3 text-sm font-semibold text-emerald-700">정답입니다!</p>
        )}
        {!pinned && answerCheckState === 'wrong' && (
          <p className="mt-3 text-sm font-semibold text-rose-700">
            {currentStepHintAvailable
              ? '다시 한번 생각해보세요. 힌트를 사용해도 좋습니다'
              : '다시 한번 생각해보세요.'}
          </p>
        )}
        {!pinned && isChoiceStep && answerCheckState === '' && !canAdvance && (
          <p className="mt-3 text-sm text-slate-500">선택지를 눌러 주세요.</p>
        )}
      </div>
    )
  }

  const handleCheckAnswer = () => {
    if (isStepJudged) return
    if (isFinalStepLocked) return
    const answerForGrade = isChoiceStep ? selectedChoice : resolveTextAnswerForGrading()
    const isCorrect =
      isChoiceStep
        ? choiceAnswerTextMatch(selectedChoice, expectedAnswer, {
            studentToken: selectedChoiceToken,
            expectedChoiceToken,
          })
        : Boolean(answerForGrade) &&
          gradeTrainingTextAnswer(answerForGrade, expectedAnswer, {
            stepIdx,
            allowSwappedEquationSides: true,
            allowUnorderedPair:
              stepIdx === 2 &&
              Number(row?.__poolStage ?? row?.['학습단계'] ?? row?.['단계']) === 5 &&
              (String(row?.['유형'] ?? '').trim().toUpperCase() === 'A' ||
                String(row?.['유형'] ?? '').trim().toUpperCase() === 'C'),
          })
    if (isCorrect) {
      if (!isChoiceStep && answerForGrade !== textAnswer) {
        setTextAnswer(answerForGrade)
      }
      setAnswerCheckState('correct')
      setWrongAttemptStreak(0)
      console.log('[step] completed:', true)
      window.setTimeout(() => {
        handleNext({ forceProceed: true })
      }, 0)
      return
    }

    const streak = applyWrongAttempt()
    const studentView = isChoiceStep ? selectedChoice : answerForGrade
    if (handleStep5WrongAfterAttempt(streak)) return
    tryAutoRevealAfterWrong(streak, studentView)
  }

  const handleHint = async () => {
    if (isStepJudged) return
    const nextFlags = [...hintFlags]
    nextFlags[stepIdx] = true
    setHintFlags(nextFlags)
    setStepHintUsed((prev) => {
      const next = [...prev]
      next[stepIdx] = true
      stepHintUsedRef.current = next
      return next
    })

    const nextHintCount = hintUsageCount + 1
    setHintUsageCount(nextHintCount)

    const matchedHint = findTrainingHintForStep(row, stepIdx, hintsData)
    console.log('[hint-select] matched hint:', matchedHint ?? null)
    const hintBodyRaw = matchedHint?.힌트내용 || ''
    if (!isUsableTrainingHintBody(hintBodyRaw)) return
    const hintBody = hintBodyRaw

    const escapeHtml = (text) =>
      String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

    const renderHintHtml = (raw) =>
      escapeHtml(raw)
        .replace(/\[RED:\s*([^\]]+)\]/g, '<span style="color:#dc2626;font-weight:700">$1</span>')
        .replace(
          /\(([^()]+)\)\/\(([^()]+)\)|([0-9a-zA-Z.]+\/[0-9a-zA-Z.]+)/g,
          (token) =>
            `<math-field read-only class="mm-inline-math" value="${escapeHtml(
              plainToDisplayLatex(token)
            )}"></math-field>`
        )
        .replace(/\n/g, '<br/>')

    const showHintDialog = (htmlContent, fallbackText) => {
      const existing = document.getElementById('mm-hint-dialog-overlay')
      if (existing) existing.remove()

      const overlay = document.createElement('div')
      overlay.id = 'mm-hint-dialog-overlay'
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;'

      const card = document.createElement('div')
      card.style.cssText =
        'width:min(620px,95vw);background:#fff;border-radius:16px;box-shadow:0 20px 40px rgba(2,6,23,0.22);padding:18px 18px 14px;'

      const title = document.createElement('div')
      title.textContent = '힌트'
      title.style.cssText = 'font-weight:800;color:#0f172a;font-size:18px;margin-bottom:10px;'

      const body = document.createElement('div')
      body.style.cssText = 'color:#334155;line-height:1.7;font-size:15px;white-space:normal;'
      body.innerHTML = htmlContent

      const footer = document.createElement('div')
      footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;'

      const closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.textContent = '확인'
      closeBtn.style.cssText =
        'border:none;border-radius:10px;background:#111827;color:#fff;font-weight:700;padding:8px 14px;cursor:pointer;'
      closeBtn.addEventListener('click', () => overlay.remove())

      footer.appendChild(closeBtn)
      card.appendChild(title)
      card.appendChild(body)
      card.appendChild(footer)
      overlay.appendChild(card)
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove()
      })
      document.body.appendChild(overlay)

      // 혹시 DOM 렌더 중 실패하면 기본 alert로 폴백
      if (!document.getElementById('mm-hint-dialog-overlay')) {
        window.alert(`힌트\n${fallbackText}`)
      }
    }

    showHintDialog(renderHintHtml(hintBody), hintBody)
  }

  const handleNext = async (options = {}) => {
    const { forceProceed = false, submittedAnswer, submittedChoiceToken } = options
    console.log('[step] move triggered by button click')
    if (!forceProceed && !isStepJudged && !canAdvance) {
      const nextWrongStreak = Number(stepWrongCountsRef.current[stepIdx] || 0) + 1
      setWrongAttemptStreak(nextWrongStreak)
      setStepWrongCounts((prev) => {
        const next = [...prev]
        next[stepIdx] = nextWrongStreak
        stepWrongCountsRef.current = next
        return next
      })
      setAnswerCheckState('wrong')
      return
    }
    const capturedAnswerOnReveal = revealedStudentAnswerByStepRef.current[stepIdx]
    const answerForView =
      submittedAnswer != null && String(submittedAnswer).trim() !== ''
        ? String(submittedAnswer).trim()
        : capturedAnswerOnReveal !== undefined
          ? capturedAnswerOnReveal
          : isChoiceStep
            ? selectedChoice
            : isNumericXValueStep
              ? formatStudentXValueAnswer(textAnswer)
              : textAnswer.trim()
    const correctAnswerForView = (expectedAnswer || '').trim()
    const currentStepWrongCount = Number(stepWrongCountsRef.current[stepIdx] || 0)
    const currentStepHintUsed = Boolean(stepHintUsedRef.current[stepIdx] || hintFlags[stepIdx])
    const isCurrentStepFailed =
      (currentStepHintUsed && currentStepWrongCount >= 2) ||
      (!currentStepHintUsed && currentStepWrongCount >= 3)
    const rowType = String(row['유형'] ?? '').trim().toUpperCase()
    const rowStage = Number(row.__poolStage ?? row['학습단계'] ?? row['단계'])
    const allowUnorderedPairAtStep3 =
      stepIdx === 2 && rowStage === 5 && (rowType === 'A' || rowType === 'C')
    const stepAnswerCorrect = isChoiceStep
      ? choiceAnswerTextMatch(answerForView, expectedAnswer, {
          studentToken: submittedChoiceToken ?? selectedChoiceToken,
          expectedChoiceToken,
        })
      : gradeTrainingTextAnswer(answerForView, expectedAnswer, {
          stepIdx,
          allowSwappedEquationSides: true,
          allowUnorderedPair: allowUnorderedPairAtStep3,
        })
    const currentStepResult = isCurrentStepFailed ? 0 : stepAnswerCorrect ? 1 : 0

    const nextCompletedSteps = [
      ...completedSteps,
      {
        stepNumber: stepIdx + 1,
        displayStepNumber: activeFlowPosition + 1,
        totalActiveSteps: activeStepCount,
        label: stepLabel,
        question: questionText,
        answer: answerForView,
        correctAnswer: correctAnswerForView || '(정답 정보 없음)',
        processResult: currentStepResult,
        wrongCount: currentStepWrongCount,
        hintUsed: currentStepHintUsed,
      },
    ]
    console.log('[answer-display] studentAnswer:', answerForView)
    console.log('[answer-display] correctAnswer:', correctAnswerForView || '(정답 정보 없음)')
    setCompletedSteps(nextCompletedSteps)
    delete revealedStudentAnswerByStepRef.current[stepIdx]

    const nextActiveIdx = getNextActiveTrainingStageIndex(row, stepIdx)
    if (nextActiveIdx != null) {
      setStepIdx(nextActiveIdx)
      setSelectedChoice('')
      setSelectedChoiceToken('')
      setBlankValues({})
      setTextAnswer('')
      setAnswerCheckState('')
      setWrongAttemptStreak(0)
      setActiveBlankKey('')
      blankInputRefs.current = {}
      setIsResultReady(false)
      return
    }
    const sheetSteps = buildActiveStepSheetPayload(nextCompletedSteps, activeStageIndices)
    const stepAnswerPayload = {
      step1: sheetSteps.step1,
      step2: sheetSteps.step2,
      step3: sheetSteps.step3,
      step4: sheetSteps.step4,
      step5_1: sheetSteps.step5_1,
      step5_2: sheetSteps.step5_2,
      step5_3: sheetSteps.step5_3,
      step6: sheetSteps.step6,
      scores: sheetSteps.scores,
      activeStepCount: sheetSteps.activeStepCount,
    }
    const failCount = sheetSteps.failCount
    const successCount = sheetSteps.successCount
    const problemCode = `${String(row?.__poolStage ?? row?.['단계'] ?? '').trim()}-${String(
      row?.['유형'] || ''
    )
      .trim()
      .toUpperCase()}`

    const trainingType = normalizeTrainingKind(row?.type) || '본문제'
    const saveKey = `${problemCode}|${trainingType}`
    const awardMathCard = shouldAwardMathCard(trainingType, failCount)
    let awardedCard = null
    if (awardMathCard) {
      console.log('[math card] award:', problemCode)
      try {
        const matchedCards = await getMathCardsByProblem(problemCode)
        const picked = Array.isArray(matchedCards) ? matchedCards[0] : null
        if (picked) {
          addMathCardToCollection(picked)
          const sameRarityCount = getMathCardsArray().filter(
            (card) => Number(card?.rarity) === Number(picked?.rarity)
          ).length
          awardedCard = {
            ...picked,
            rarityCount: sameRarityCount,
          }
        }
      } catch (error) {
        console.warn('[math card] load failed:', error)
      }
    } else {
      console.log('[math card] no award:', problemCode)
    }
    console.log('[save] triggered by result button click')
    const alreadySaved = isSaved || savedTrainingKeysRef.current.has(saveKey)
    console.log('[save] already saved:', alreadySaved)

    const aiPayload = {
      problemMeta: {
        code: problemCode,
        type: trainingType,
        problemPrinciple: String(row?.problemPrinciple ?? '').trim(),
        problemStrategy: String(row?.problemStrategy ?? '').trim(),
      },
      problemPrinciple: String(row?.problemPrinciple ?? '').trim(),
      problemStrategy: String(row?.problemStrategy ?? '').trim(),
      ...stepAnswerPayload,
      steps: nextCompletedSteps.map((item, i) => ({
        index: i + 1,
        meaning: TRAINING_STEP_MEANINGS[i] || '',
        isCorrect: Number(item.processResult) > 0,
      })),
      failedStepDetails: buildFailedStepDetailsFromCompletedSteps(
        nextCompletedSteps,
        TRAINING_STEP_MEANINGS,
      ),
      total: successCount,
      fail_count: failCount,
      type: trainingType,
      status: resolveTrainingSaveStatus(trainingType, failCount),
      hint: hintUsageCount,
    }

    let aiFeedbackText = ''
    if (!alreadySaved) {
      setIsAwaitingTrainingAi(true)
      try {
        aiFeedbackText = await generateStudentFeedback(aiPayload, { post: postGenerateAiFeedback })
      } catch (err) {
        console.warn('[TrainingMode] AI feedback fetch failed', err)
        aiFeedbackText = await generateStudentFeedback(aiPayload)
      } finally {
        setIsAwaitingTrainingAi(false)
      }

      const savePayload = {
        닉네임: nickname,
        classCode: normalizeClassCode(classCode ?? trainingPlan?.classCode),
        type: trainingType,
        단계: row?.__poolStage ?? row?.['단계'] ?? '',
        문제번호: problemIdx + 1,
        problem: problemCode,
        ...stepAnswerPayload,
        total: successCount,
        fail_count: failCount,
        status: resolveTrainingSaveStatus(trainingType, failCount),
        hint: hintUsageCount,
        ai: aiFeedbackText,
        completedAt: new Date().toISOString(),
      }

      savedTrainingKeysRef.current.add(saveKey)
      const saveResult = await updateSupplement(savePayload)
      if (saveResult?.ok === false) {
        savedTrainingKeysRef.current.delete(saveKey)
        window.alert('저장에 실패했습니다. 다시 시도해주세요.')
        return
      }
    } else {
      aiFeedbackText =
        savedAiFeedbackByKeyRef.current[saveKey] ||
        getStudentFeedbackDisplayText(trainingAiFeedback)
    }
    savedAiFeedbackByKeyRef.current[saveKey] = aiFeedbackText
    setTrainingAiFeedback(aiFeedbackText)
    setPendingSavePayload(null)
    setIsResultReady(false)
    setIsSaved(true)
    setResultSessionSnapshot(
      buildTrainingResultSessionSnapshot({
        row,
        completedSteps: nextCompletedSteps,
        activeStepCount,
        hintUsageCount,
        problemCode,
        trainingType,
        successCount,
        failCount,
        awardedCard: awardedCard,
      }),
    )
    setIsResultView(true)
    setTrainingSessionActive(false)
    setAwardedMathCardPopup(awardedCard)
    if (awardedCard) {
      setRecentlyAcquiredCardCode(
        normalizeMathCardStorageCode(awardedCard.code ?? awardedCard.problem ?? problemCode),
      )
    }
    applyProblemProgressMap((prev) =>
      mergeTrainingProgressAfterSave(prev, problemCode, trainingType, failCount),
    )
    console.log('[result-view] opened:', true)
    console.log('[result-view] saved:', true)
  }

  const handleResultView = async () => {
    if (isResultView) return
    if (!pendingSavePayload && !isSaved) return
    console.log('[save] triggered by result button click')
    const alreadySaved = isSaved || (
      pendingSavePayload ? savedTrainingKeysRef.current.has(pendingSavePayload.saveKey) : false
    )
    console.log('[save] already saved:', alreadySaved)
    if (!alreadySaved) {
      savedTrainingKeysRef.current.add(pendingSavePayload.saveKey)
      const saveResult = await updateSupplement(pendingSavePayload.payload)
      if (saveResult?.ok === false) {
        window.alert('저장에 실패했습니다. 다시 시도해주세요.')
        return
      }
    }
    if (!resultSessionSnapshot && row) {
      const code = `${String(row?.__poolStage ?? row?.['단계'] ?? '').trim()}-${String(
        row?.['유형'] || '',
      )
        .trim()
        .toUpperCase()}`
      setResultSessionSnapshot(
        buildTrainingResultSessionSnapshot({
          row,
          completedSteps,
          activeStepCount,
          hintUsageCount,
          problemCode: code,
          trainingType: row?.type,
        }),
      )
    }
    setIsSaved(true)
    setIsResultView(true)
    setTrainingSessionActive(false)
    setPendingSavePayload(null)
    console.log('[result-view] opened:', true)
    console.log('[result-view] saved:', true)
  }

  const transitionToTrainingComplete = useCallback(() => {
    const pick =
      TRAINING_COMPLETION_MESSAGES[Math.floor(Math.random() * TRAINING_COMPLETION_MESSAGES.length)] ||
      TRAINING_COMPLETION_MESSAGES[0]
    console.log('[training-complete] all problems completed')
    setCompletionEncouragement(pick)
    setTrainingAllComplete(true)
    setRetryChallengeDialog(null)
  }, [])

  useEffect(() => {
    if (isLoading || trainingAllComplete) return
    if (trainingSessionActive || isResultView) return
    const fromPlan = trainingPlan?.openTrainingCompleteScreen === true
    if (!fromPlan && !allFifteenTrainingCodesComplete) return
    transitionToTrainingComplete()
  }, [
    isLoading,
    trainingAllComplete,
    trainingSessionActive,
    isResultView,
    trainingPlan?.openTrainingCompleteScreen,
    allFifteenTrainingCodesComplete,
    transitionToTrainingComplete,
  ])

  const handleBackToCardBoard = useCallback(async () => {
    setIsResultView(false)
    setResultSessionSnapshot(null)
    setIsSaved(false)
    setIsResultReady(false)
    setPendingSavePayload(null)
    setTrainingAiFeedback('')
    setAwardedMathCardPopup(null)
    setRetryChallengeDialog(null)
    setTrainingSessionActive(false)
    setFlippingProblemCode(null)
    setCompletedSteps([])
    setStepIdx(0)
    setHintFlags(emptyStepFlags())
    setSelectedChoice('')
    setSelectedChoiceToken('')
    setWrongAttemptStreak(0)
    setStepWrongCounts(emptyStepCounts())
    setStepHintUsed(emptyStepFlags())
    stepWrongCountsRef.current = emptyStepCounts()
    stepHintUsedRef.current = emptyStepFlags()
    setBlankValues({})
    setTextAnswer('')
    setAnswerCheckState('')
    setActiveBlankKey('')
    blankInputRefs.current = {}
    revealedStudentAnswerByStepRef.current = {}

    const nick = (nickname || '').trim()
    const cc = normalizeClassCode(classCode ?? trainingPlan?.classCode)
    if (nick && cc) {
      try {
        const progress = await fetchStudentLearningProgress(nick, cc)
        setSheetFailedProblems(normalizeProblemCodeList(progress?.failedProblems))
        setSheetCompletedProblems(normalizeProblemCodeList(progress?.completedProblems))
        const map = progress?.trainingProblemProgressByCode
        if (map && typeof map === 'object') {
          applyProblemProgressMap((prev) =>
            applySheetProblemOutcomeLists(
              mergeTrainingProblemProgressMaps(prev, map),
              progress.completedProblems,
              progress.failedProblems,
            ),
          )
        }
      } catch (err) {
        console.warn('[TrainingMode] refresh progress on card board', err)
      }
    }
  }, [nickname, classCode, trainingPlan?.classCode, applyProblemProgressMap])

  const learnerName = (nickname || '').trim() || '학습자'
  const tierForAvatar = resolveCanonicalDiagnosticTier(
    trainingPlan?.diagnosticTier ||
      trainingPlan?.diagnosticRecord?.level ||
      trainingPlan?.characterName ||
      '하'
  )
  const characterName = getCharacterDisplayName(
    (trainingPlan?.characterName || '').trim() || tierForAvatar
  )
  const currentStep = Math.min(Math.max(activeFlowPosition + 1, 1), activeStepCount || 1)
  console.log('[render] isResultView:', isResultView)
  console.log('[render] currentStep:', currentStep)
  console.log('[step-control] currentStep:', currentStep)
  console.log('[step-control] isResultView:', isResultView)
  console.log('[step-control] isResultReady:', isResultReady)
  const characterCardImage =
    {
      최상: sonGokuImg,
      상: shaoImg,
      중: samjangImg,
      하: okdongjaImg,
    }[tierForAvatar] || magicMainIllustration
  const headerKicker = `학습자: ${learnerName} · 진단 레벨 캐릭터: ${characterName}`
  const softButtonClass =
    'rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 transition hover:bg-blue-50 active:translate-y-px'
  const submitAnswerButtonClass =
    'rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 shadow-sm transition hover:bg-blue-50 hover:shadow-[0_3px_10px_rgba(37,99,235,0.14)] active:translate-y-px'
  const stepFocusedLearningButtonClass =
    'step-learning-cta-glow step-learning-cta-btn inline-flex max-w-full shrink-0 items-center justify-center rounded-lg bg-violet-600 px-3 py-[calc(0.375rem*1.1)] text-sm font-bold leading-tight text-white shadow-md shadow-violet-600/40 hover:bg-violet-700 active:translate-y-px sm:px-3.5'
  const accentButtonClass =
    'rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45'
  const textInputClass =
    'w-full rounded-xl border border-yellow-300 bg-white px-3 py-2.5 text-sm outline-none ring-yellow-300 transition focus:ring-2 sm:px-4 sm:py-3 sm:text-base'

  const resetStateForCardPick = useCallback(() => {
    setIsResultView(false)
    setIsSaved(false)
    setIsResultReady(false)
    setPendingSavePayload(null)
    setTrainingAiFeedback('')
    setAwardedMathCardPopup(null)
    setCompletedSteps([])
    setStepIdx(0)
    setHintFlags(emptyStepFlags())
    setSelectedChoice('')
    setSelectedChoiceToken('')
    setWrongAttemptStreak(0)
    setStepWrongCounts(emptyStepCounts())
    setStepHintUsed(emptyStepFlags())
    stepWrongCountsRef.current = emptyStepCounts()
    stepHintUsedRef.current = emptyStepFlags()
    setBlankValues({})
    setTextAnswer('')
    setAnswerCheckState('')
    setActiveBlankKey('')
    blankInputRefs.current = {}
    revealedStudentAnswerByStepRef.current = {}
  }, [])

  const startTrainingFromCardPick = useCallback(
    (card, startKind) => {
      const codeMatch = String(card?.code || '').trim().toUpperCase().match(/^(\d+)-([A-Z])$/)
      if (!codeMatch || !rows.length) return
      const stage = Number(codeMatch[1])
      const letter = String(codeMatch[2]).trim().toUpperCase()
      const idx = findMatchingTrainingRowIndex(rows, stage, letter, startKind)
      if (idx < 0) {
        showSimpleNoticeDialog(
          '안내',
          `문제 ${card.code}의 「${startKind}」 행을 데이터에서 찾지 못했습니다.`
        )
        return
      }
      if (keywordFlipTimerRef.current) {
        window.clearTimeout(keywordFlipTimerRef.current)
        keywordFlipTimerRef.current = null
      }
      setProblemIdx(idx)
      setFlippingProblemCode(card.code)
      keywordFlipTimerRef.current = window.setTimeout(() => {
        keywordFlipTimerRef.current = null
        setFlippingProblemCode(null)
        setTrainingSessionActive(true)
      }, KEYWORD_CARD_PICK_TO_SESSION_MS)
    },
    [rows]
  )

  const resultOutcomeCard = useMemo(() => {
    if (!isResultView) return null
    const steps = resultDisplay.completedSteps || []
    const successCount = Number(resultDisplay.successCount) || 0
    const failCount = Number(resultDisplay.failCount) || 0
    const statusLabel =
      resultDisplay.status === '성공' || String(resultDisplay.status).toLowerCase() === 'success'
        ? '성공'
        : resultDisplay.status === '실패' || String(resultDisplay.status).toLowerCase() === 'fail'
          ? '실패'
          : failCount === 0
            ? '성공'
            : '실패'
    return {
      successCount,
      failCount,
      statusLabel,
      feedback: getStudentFeedbackDisplayText(trainingAiFeedback),
      hasFeedback: Boolean(String(trainingAiFeedback || '').trim()),
      stepCount: resultDisplay.activeStepCount || steps.length,
    }
  }, [isResultView, resultDisplay, trainingAiFeedback])

  const keywordCardsEnabled =
    flippingProblemCode === null &&
    !retryChallengeDialog &&
    (!trainingSessionActive || (isResultView && isSaved))

  if (loadError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-white/90 p-6 shadow-xl">
        <p className="font-bold text-red-700">{loadError}</p>
        <button
          type="button"
          onClick={onExit}
          className="mt-4 rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white"
        >
          돌아가기
        </button>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-blue-200 bg-white/90 p-8 text-center shadow-xl">
        <p className="text-slate-600">데이터를 불러오는 중...</p>
      </section>
    )
  }

  if (trainingAllComplete) {
    return (
      <section className="rounded-3xl border border-amber-200/90 bg-gradient-to-b from-amber-50/95 to-white/95 p-6 shadow-2xl backdrop-blur-md sm:p-10 lg:p-12">
        <p className="text-center text-5xl font-black tracking-tight text-amber-700 sm:text-6xl lg:text-7xl">
          🎉 수련 완료!
        </p>

        <div className="mx-auto mt-8 grid w-full max-w-4xl gap-5 lg:grid-cols-2">
          <div className="flex min-h-[220px] flex-col justify-center rounded-2xl border border-blue-100 bg-white/80 px-5 py-4 text-left shadow-sm sm:px-6">
            <div className="flex items-center gap-6">
            <img
              src={characterCardImage}
              alt={`${characterName} 캐릭터`}
              className="h-44 w-44 rounded-2xl border border-blue-200 bg-blue-50 object-cover sm:h-52 sm:w-52"
            />
              <div className="space-y-3 text-slate-800">
                <p className="text-xl sm:text-2xl">
                닉네임 <span className="font-black text-blue-900">{learnerName}</span>
                </p>
                <p className="text-xl sm:text-2xl">
                캐릭터 <span className="font-black text-blue-900">{characterName}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-[220px] flex-col justify-center rounded-2xl border border-blue-100 bg-white/80 px-5 py-4 text-center shadow-sm sm:px-6 lg:text-left">
            <h2 className="text-4xl font-black tracking-tight text-blue-950 sm:text-5xl lg:text-6xl">
              축하합니다!
            </h2>
            <p className="mt-4 text-lg font-semibold text-slate-700 sm:text-xl">
              모든 수련 문제를 해결했습니다.
            </p>
          </div>
        </div>

        <div className="mx-auto mt-10 max-w-lg space-y-3 rounded-2xl border border-blue-200 bg-blue-50/80 px-5 py-5 text-center text-slate-800 shadow-inner sm:px-6">
          <p className="text-base font-bold text-blue-900 sm:text-lg">
            당신은 15장의 숫자카드를 모두 모았습니다.
          </p>
          <p className="text-base font-bold text-blue-800 sm:text-lg">이제 당신은 방정식 마스터입니다!</p>
        </div>

        <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-slate-700 sm:text-lg">
          {completionEncouragement}
        </p>

        <div className="mx-auto mt-10 w-full max-w-4xl rounded-2xl border border-slate-200 bg-white/90 px-3 py-5 shadow-md sm:px-5">
          <div className="mb-4 flex flex-col items-center justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-center text-base font-black text-slate-800 sm:text-left">🎴 획득 카드</p>
            <p className="text-sm font-semibold text-slate-600 sm:text-base">
              획득 {acquiredMathCardCount} / 15
            </p>
          </div>
          <MathCardSlotGrid
            compact
            slots={mathCardCollectionSlots}
            unlockedSet={mathCardVaultCompletedByProgressSet}
            recentlyAcquiredCode={recentlyAcquiredCardCode}
          />
        </div>

        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={onExit}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 sm:px-6 sm:text-base"
          >
            나가기
          </button>
        </div>
      </section>
    )
  }

  if (!row) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-white/90 p-6 shadow-xl">
        <p className="font-semibold text-amber-700">
          수련 문제를 표시할 수 없습니다. 데이터 경로 또는 단계 매핑을 확인해 주세요.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-4 rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white"
        >
          돌아가기
        </button>
      </section>
    )
  }

  return (
    <>
      {isMathCardCollectionOpen ? (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-900/45 px-3 backdrop-blur-[1px] sm:px-4">
          <div className="flex w-full max-w-[min(96vw,640px)] flex-col overflow-hidden rounded-3xl border border-violet-300 bg-white p-4 shadow-2xl sm:p-5">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <p className="text-base font-black text-violet-800 sm:text-xl">카드 보관함</p>
              <p className="text-sm font-semibold text-slate-600 sm:text-base">
                획득 {acquiredMathCardCount} / 15
              </p>
            </div>
            <div className="flex shrink-0 justify-center overflow-hidden py-3 sm:py-4">
              <MathCardSlotGrid
                scaled75
                slots={mathCardCollectionSlots}
                unlockedSet={mathCardVaultCompletedByProgressSet}
                recentlyAcquiredCode={recentlyAcquiredCardCode}
              />
            </div>
            <div className="flex shrink-0 justify-center border-t border-violet-100 pt-4">
              <button
                type="button"
                onClick={() => setIsMathCardCollectionOpen(false)}
                className="math-card-vault-close-btn rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {awardedMathCardPopup ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-3xl border border-yellow-300 bg-white p-5 shadow-2xl sm:p-6">
            <p className="text-center text-[1.6875rem] font-bold leading-tight text-amber-700 sm:text-[1.875rem]">
              MATH-CARD를 획득했습니다!
            </p>
            <div className="mt-6 flex justify-center">
              <div className="math-card-glow math-card-acquire-enter mx-auto flex h-[340px] w-[240px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-amber-300 bg-white">
                <img
                  src={String(awardedMathCardPopup.image || '')}
                  alt={String(awardedMathCardPopup.name || '매쓰카드')}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setAwardedMathCardPopup(null)}
                className="math-card-vault-close-btn rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isAwaitingTrainingAi ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/30 px-4 backdrop-blur-[2px]">
          <p className="rounded-2xl border border-blue-200 bg-white px-6 py-4 text-center text-sm font-bold text-slate-800 shadow-xl">
            보리도사의 꿀팁을 준비하는 중...
          </p>
        </div>
      ) : null}
      {retryChallengeDialog ? (
        <div
          className="fixed inset-0 z-[108] flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mm-retry-challenge-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRetryChallengeDialog(null)
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-violet-200 bg-white p-6 shadow-2xl sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              id="mm-retry-challenge-title"
              className="text-center text-base font-bold leading-relaxed text-slate-800 sm:text-lg"
            >
              {RETRY_CHALLENGE_MESSAGES[retryChallengeDialog.phase] || ''}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setRetryChallengeDialog(null)}
                className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = retryChallengeDialog
                  if (!d?.card) return
                  setRetryChallengeDialog(null)
                  resetStateForCardPick()
                  startTrainingFromCardPick(d.card, d.startKind)
                }}
                className={accentButtonClass}
              >
                도전하기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {scaffoldingChoiceDialog ? (
        <div
          className="fixed inset-0 z-[108] flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scaffolding-choice-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-indigo-200 bg-white p-6 shadow-2xl sm:p-7">
            <p
              id="scaffolding-choice-title"
              className="text-center text-base font-bold leading-relaxed text-slate-800 sm:text-lg"
            >
              5단계에서 틀렸어요. 어떻게 할까요?
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setScaffoldingChoiceDialog(null)}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                다시 도전
              </button>
              <button
                type="button"
                onClick={startScaffoldingSession}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:brightness-105"
              >
                보리도사와 함께 방정식 풀기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={
          useFixedTrainingLayout
            ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden'
            : isResultView
              ? 'training-result-page-scroll flex min-h-0 w-full flex-1 flex-col overflow-y-auto'
              : 'w-full'
        }
      >
      <section
        className={[
          'rounded-3xl border border-blue-200/80 bg-white/90 shadow-2xl backdrop-blur-md',
          useFixedTrainingLayout ? 'flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4' : 'p-4 sm:p-6 lg:p-8',
          isResultView ? 'flex flex-col' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
      {useFixedTrainingLayout ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 p-1">
            <img
              src={characterCardImage}
              alt={`${characterName} 캐릭터 카드`}
              className="h-[4.25rem] w-[4.25rem] rounded-lg border border-blue-200 object-cover sm:h-[4.75rem] sm:w-[4.75rem]"
            />
          </div>
          <div className="flex h-[4.25rem] min-w-0 flex-1 flex-col justify-center gap-1 sm:h-[4.75rem] sm:gap-1.5">
            <p className="truncate text-[11px] font-semibold leading-snug text-blue-700 sm:text-xs">
              {headerKicker}
            </p>
            <h2 className="truncate text-base font-black leading-snug text-blue-950 sm:text-lg">
              방정식의 활용 수련
            </h2>
            <p className="truncate text-[11px] font-semibold leading-snug text-slate-800 sm:text-xs">
              <span>{resultDisplay.summary}</span>
              <span className="text-slate-600">
                {' '}
                · 힌트 사용 {resultDisplay.hintUsageCount}회
              </span>
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onExit}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 sm:px-3 sm:text-sm"
            >
              나가기
            </button>
            <button
              type="button"
              onClick={() => setIsMathCardCollectionOpen(true)}
              className="rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100 sm:px-3 sm:text-sm"
            >
              카드 보관함
            </button>
            <button
              type="button"
              onClick={() => setIsScratchPadOpen(true)}
              className="rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100 sm:px-3 sm:text-sm"
            >
              연습장
            </button>
          </div>
        </div>
      ) : (
      <div className="grid shrink-0 gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs font-semibold text-blue-700 sm:text-sm">{headerKicker}</p>
          <h2 className="mt-1 text-xl font-black text-blue-950 sm:text-2xl lg:text-3xl">방정식의 활용 수련</h2>
        </div>
        <div className="flex items-start gap-2.5 sm:gap-3 lg:self-end">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-2">
            <img
              src={characterCardImage}
              alt={`${characterName} 캐릭터 카드`}
              className="h-24 w-24 rounded-lg border border-blue-200 object-cover sm:h-32 sm:w-32 lg:h-40 lg:w-40"
            />
          </div>
          <button
            type="button"
            onClick={onExit}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 sm:px-4 sm:text-sm"
          >
            나가기
          </button>
          <button
            type="button"
            onClick={() => setIsMathCardCollectionOpen(true)}
            className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 transition hover:bg-violet-100 sm:px-4 sm:text-sm"
          >
            카드 보관함
          </button>
          {showTrainingProblemBody ? (
            <button
              type="button"
              onClick={() => setIsScratchPadOpen(true)}
              className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100 sm:px-4 sm:text-sm"
            >
              연습장
            </button>
          ) : null}
        </div>
      </div>
      )}

      {!showTrainingProblemBody ? (
      <>
      <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/70 p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-violet-800 sm:text-base">
            문제 선택 카드
          </p>
          <p className="text-xs font-bold text-violet-700 sm:text-sm">
            전체 {tierProblemSets.length}단계 중 {visibleTrainingSetCount}단계 진행 중
          </p>
        </div>
        <div className="space-y-6">
          {visibleKeywordTrainingSets.map(({ setIndex, heading, cards }) => (
            <div
              key={`training-set-section-${setIndex}`}
              className={setIndex > 0 ? 'border-t border-violet-200/80 pt-5' : ''}
            >
              <p className="mb-2 text-sm font-black text-violet-900 sm:text-base">{heading}</p>
              <div className="grid grid-cols-5 items-stretch gap-3 sm:gap-4">
                {cards.map((card) => {
                  const cardProgress = problemProgressByCode[card.code] || {
                    isComplete: false,
                    nextKind: '본문제',
                    latestByType: {},
                    status: 'not_started',
                  }
                  const isCardLocked = isProblemCardComplete(
                    cardProgress,
                    card.code,
                    sheetCompletedProblemSet,
                  )
                  const codeMatch = card.code.match(/^(\d+)-([A-Z])$/)
                  const startKind = cardProgress.nextKind || '본문제'
                  const challengeHintPhase = resolveCardChallengeHintPhase(
                    cardProgress,
                    card.code,
                    sheetFailedProblemSet,
                  )
                  const targetRowIndex =
                    codeMatch && rows.length
                      ? findMatchingTrainingRowIndex(rows, Number(codeMatch[1]), codeMatch[2], startKind)
                      : -1
                  const showCodeFace =
                    targetRowIndex >= 0 &&
                    problemIdx === targetRowIndex &&
                    !isResultView &&
                    (flippingProblemCode === card.code || trainingSessionActive)
                  const isSelected =
                    targetRowIndex >= 0 &&
                    problemIdx === targetRowIndex &&
                    (trainingSessionActive || flippingProblemCode === card.code)
                  const isRetryCard = challengeHintPhase === 'retry_similar1'
                  const isRecommended =
                    !isCardLocked &&
                    keywordCardsEnabled &&
                    recommendedKeywordCard?.code === card.code
                  const canCardHover = keywordCardsEnabled && !isCardLocked
                  return (
                    <button
                      key={`problem-card-${setIndex}-${card.code}`}
                      type="button"
                      disabled={!keywordCardsEnabled || isCardLocked}
                      onClick={() => {
                        if (!keywordCardsEnabled || flippingProblemCode || isCardLocked) return
                        if (keywordFlipTimerRef.current) {
                          window.clearTimeout(keywordFlipTimerRef.current)
                          keywordFlipTimerRef.current = null
                        }

                        resetStateForCardPick()

                        if (!codeMatch) return
                        if (challengeHintPhase === 'retry_similar1') {
                          setRetryChallengeDialog({
                            phase: challengeHintPhase,
                            startKind,
                            card: { code: card.code, keyword: card.keyword },
                          })
                          return
                        }

                        startTrainingFromCardPick(card, startKind)
                      }}
                      className={[
                        'group relative flex h-full w-full overflow-hidden rounded-xl border p-0 text-left shadow-sm',
                        canCardHover && 'keyword-card-interactive keyword-card-hover-violet',
                        isRecommended && 'keyword-card-recommended',
                        isCardLocked
                          ? 'cursor-not-allowed border-emerald-400 ring-2 ring-emerald-300/90 shadow-md shadow-emerald-200/50'
                          : !keywordCardsEnabled
                            ? 'cursor-not-allowed border-violet-200 opacity-50'
                            : isSelected
                              ? 'border-violet-500 ring-2 ring-violet-200'
                              : 'border-violet-200',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={
                        isCardLocked
                          ? `${card.keyword} (${card.code}) — 수련 완료`
                          : challengeHintPhase === 'retry_similar1'
                            ? `${card.keyword} (${card.code}) — 재도전 (유사문제1)`
                            : `${card.keyword} (${card.code}) · 다음: ${startKind}`
                      }
                    >
                      <div
                        className="relative h-full min-h-[7.75rem] w-full flex-1 rounded-xl sm:min-h-[9rem]"
                        style={{ perspective: '1000px' }}
                      >
                        <div
                          className="absolute inset-0 transition-transform duration-300 ease-out"
                          style={{
                            transformStyle: 'preserve-3d',
                            transform: showCodeFace ? 'rotateY(180deg)' : 'rotateY(0deg)',
                          }}
                        >
                          <div
                            className="absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden rounded-xl text-center shadow-inner [container-type:size]"
                            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(0deg)' }}
                          >
                            <div
                              className={[
                                'relative flex min-h-0 flex-1 flex-col items-center justify-center px-0.5',
                                isCardLocked
                                  ? 'bg-gradient-to-br from-emerald-500 via-teal-600 to-emerald-800'
                                  : 'keyword-card-face-main bg-gradient-to-br from-violet-600 via-violet-700 to-violet-900',
                              ].join(' ')}
                            >
                              <span
                                className={[
                                  'font-black leading-none [overflow-wrap:anywhere] [text-shadow:0_1px_2px_rgba(0,0,0,0.45)] [word-break:keep-all]',
                                  isCardLocked ? 'text-amber-100' : 'text-amber-200',
                                ].join(' ')}
                                style={{
                                  fontSize: 'clamp(0.975rem, 45cqmin, 2.1875rem)',
                                  lineHeight: 1.05,
                                }}
                              >
                                {card.keyword}
                              </span>
                              {isCardLocked || isRetryCard ? (
                                <span
                                  className={[
                                    'keyword-card-status-badge',
                                    isCardLocked
                                      ? 'keyword-card-status-badge--complete'
                                      : 'keyword-card-status-badge--retry',
                                  ].join(' ')}
                                  aria-hidden
                                >
                                  <span className="keyword-card-status-badge__icon" aria-hidden>
                                    {isCardLocked ? '✅' : '🔄'}
                                  </span>
                                  <span>{isCardLocked ? '완료' : '재도전'}</span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div
                            className={[
                              'absolute inset-0 flex items-center justify-center rounded-xl font-black [container-type:size]',
                              isCardLocked
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                : 'border-violet-200 bg-white text-violet-900',
                            ].join(' ')}
                            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                          >
                            <span
                              className="px-1 text-center leading-none [overflow-wrap:anywhere]"
                              style={{ fontSize: 'clamp(1rem, 34cqmin, 1.75rem)' }}
                            >
                              {card.code}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-violet-200/80 pt-3 text-sm font-semibold text-slate-800 sm:text-base">
          <p className="text-slate-600">키워드 카드를 선택해 주세요.</p>
        </div>
      </div>
      </>
      ) : (
        <div
          className={
            useFixedTrainingLayout
              ? 'training-problem-session flex min-h-0 flex-1 flex-col overflow-hidden'
              : 'training-result-page-scroll flex flex-col'
          }
        >
      {!useFixedTrainingLayout ? (
      <div className={`flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-blue-100 bg-blue-50/90 px-3 py-2 text-sm font-semibold text-slate-800 sm:px-4 sm:text-base ${isResultView ? 'mb-4 mt-3 sm:mb-5 sm:mt-4' : ''}`}>
        {isResultView ? (
          <>
            <p className="text-base font-black text-violet-950 sm:text-lg">수련 완료</p>
            <p className="mt-0.5 w-full font-semibold text-slate-600">{resultDisplay.summary}</p>
          </>
        ) : (
          <>
            <p>{resultDisplay.summary}</p>
            <span className="font-semibold text-slate-600">
              힌트 사용 {resultDisplay.hintUsageCount}회
            </span>
          </>
        )}
      </div>
      ) : null}
      {isResultView && resultOutcomeCard ? (
        <section
          className="mt-4 rounded-3xl border-2 border-violet-300 bg-gradient-to-br from-white via-violet-50/90 to-indigo-50/80 p-4 shadow-lg shadow-violet-200/40 sm:p-6"
          aria-labelledby="training-result-summary-title"
        >
          <p
            id="training-result-summary-title"
            className="text-center text-lg font-black tracking-tight text-violet-950 sm:text-xl"
          >
            수련 결과
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-xl border border-blue-200 bg-white/90 px-3 py-2.5 text-center">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">성공 단계</dt>
              <dd className="mt-1 text-2xl font-black tabular-nums text-blue-950">
                {resultOutcomeCard.successCount}
              </dd>
            </div>
            <div className="rounded-xl border border-rose-200 bg-white/90 px-3 py-2.5 text-center">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">실패 단계</dt>
              <dd className="mt-1 text-2xl font-black tabular-nums text-rose-950">
                {resultOutcomeCard.failCount}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-center">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">전체 단계</dt>
              <dd className="mt-1 text-2xl font-black tabular-nums text-slate-900">
                {resultOutcomeCard.stepCount}
              </dd>
            </div>
            <div className="rounded-xl border border-violet-200 bg-white/90 px-3 py-2.5 text-center">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">결과</dt>
              <dd className="mt-1 text-lg font-black text-violet-950">{resultOutcomeCard.statusLabel}</dd>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white/90 px-3 py-2.5 text-center">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">힌트</dt>
              <dd className="mt-1 text-2xl font-black tabular-nums text-amber-950">
                {Number(resultDisplay.hintUsageCount) || 0}
              </dd>
            </div>
          </dl>
          <div className="mt-5 rounded-2xl border-2 border-indigo-300/80 bg-white/95 px-4 py-4 shadow-inner sm:px-5 sm:py-5">
            <p className="text-sm font-black text-indigo-800 sm:text-base">보리도사의 학습 피드백</p>
            {resultOutcomeCard.hasFeedback ? (
              <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-slate-800 sm:text-lg">
                {resultOutcomeCard.feedback}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-500">피드백을 불러오는 중이거나 아직 없습니다.</p>
            )}
          </div>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
            <div className="flex min-w-0 flex-col gap-2">
              <button type="button" onClick={handleBackToCardBoard} className={accentButtonClass}>
                카드 화면으로 돌아가기
              </button>
              <p className="flex items-start gap-1.5 text-[calc(0.875rem*1.1)] font-medium leading-snug text-slate-700">
                <span className="mt-px shrink-0 text-[0.92em] opacity-45" aria-hidden>
                  🎴
                </span>
                <span>다음 수련 문제는 카드 화면에서 선택해 주세요.</span>
              </p>
            </div>
            {allFifteenTrainingCodesComplete ? (
              <button type="button" onClick={() => transitionToTrainingComplete()} className={softButtonClass}>
                세트 수련 완료 보기
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {String(resultDisplay.problemText || '').trim() && isResultView ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase text-amber-800">문제 텍스트</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 sm:text-base">
            {renderTextWithFractions(
              resultDisplay.problemText,
              `problem-text-${resultDisplay.problemCode || problemIdx}`,
            )}
          </p>
        </div>
      ) : null}

      {isResultView ? (
      <div className="mt-5 shrink-0 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 sm:mt-6 sm:p-5">
          <details open className="group rounded-xl border border-blue-200/80 bg-white/60 open:shadow-sm">
            <summary className="cursor-pointer list-none px-3 py-3 text-sm font-bold text-blue-900 marker:content-none sm:px-4 sm:text-base [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-2">
                단계별 풀이 보기 ({resultDisplay.activeStepCount}단계)
                <span className="text-xs font-semibold text-blue-600 group-open:hidden">펼치기</span>
                <span className="hidden text-xs font-semibold text-blue-600 group-open:inline">접기</span>
              </span>
            </summary>
            <div className="border-t border-blue-100 px-1 pb-3 pr-1 pt-2 sm:px-2">
              {resultDisplay.completedSteps.map((item) => (
                <div
                  key={`completed-${item.stepNumber}`}
                  className="mb-3 rounded-2xl border border-blue-200 bg-white p-3 last:mb-0 sm:mb-4 sm:p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                      수련 {item.displayStepNumber ?? item.stepNumber} /{' '}
                      {item.totalActiveSteps ?? resultDisplay.activeStepCount}
                    </span>
                    <span className="text-sm font-extrabold text-slate-700 sm:text-base">{item.label}</span>
                    <span
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-bold',
                        Number(item.processResult) > 0
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700',
                      ].join(' ')}
                    >
                      {Number(item.processResult) > 0 ? '성공' : '실패'}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800 sm:mt-3 sm:text-base">
                    {renderTextWithFractions(item.question, `history-question-${item.stepNumber}`)}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-blue-700 sm:text-sm">정답:</p>
                      <p className="mt-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-sm text-blue-900">
                        {renderHistoryCorrectAnswer(item.correctAnswer, `history-correct-${item.stepNumber}`)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 sm:text-sm">입력한 답:</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-sm text-emerald-900">
                        {String(item.answer ?? '').trim()
                          ? renderTextWithFractions(item.answer, `history-answer-${item.stepNumber}`)
                          : '미입력'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>
      </div>
      ) : (
      <div className="training-problem-panel mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80 shadow-sm sm:mt-5">
        {String(resultDisplay.problemText || '').trim() ? (
          <div className="training-problem-sticky shrink-0 border-b border-amber-200/90 bg-amber-50/95 p-3 sm:p-4">
            <p className="text-xs font-semibold uppercase text-amber-800">문제 텍스트</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 sm:text-base">
              {renderTextWithFractions(
                resultDisplay.problemText,
                `problem-text-active-${resultDisplay.problemCode || problemIdx}`,
              )}
            </p>
          </div>
        ) : null}
        <div
          className={[
            'training-problem-steps flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl bg-blue-50/60',
            isLastActiveStep ? 'training-problem-steps--last-step' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            ref={stepHistoryScrollRef}
            className="training-step-history-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4"
          >
            <div className="pr-1">
              {resultDisplay.completedSteps.map((item) => (
                <div
                  key={`completed-${item.stepNumber}`}
                  className="mb-3 rounded-2xl border border-blue-200 bg-white p-3 sm:mb-4 sm:p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                      수련 {item.displayStepNumber ?? item.stepNumber} /{' '}
                      {item.totalActiveSteps ?? resultDisplay.activeStepCount}
                    </span>
                    <span className="text-sm font-extrabold text-slate-700 sm:text-base">{item.label}</span>
                    <span
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-bold',
                        Number(item.processResult) > 0
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700',
                      ].join(' ')}
                    >
                      {Number(item.processResult) > 0 ? '성공' : '실패'}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800 sm:mt-3 sm:text-base">
                    {renderTextWithFractions(item.question, `history-question-${item.stepNumber}`)}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-blue-700 sm:text-sm">정답:</p>
                      <p className="mt-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-sm text-blue-900">
                        {renderHistoryCorrectAnswer(item.correctAnswer, `history-correct-${item.stepNumber}`)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 sm:text-sm">입력한 답:</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-sm text-emerald-900">
                        {String(item.answer ?? '').trim()
                          ? renderTextWithFractions(item.answer, `history-answer-${item.stepNumber}`)
                          : '미입력'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {!isLastActiveStep ? renderActiveStepPanel() : null}
            </div>
          </div>
          {isLastActiveStep ? (
            <div className="training-step-pinned-slot shrink-0 px-3 sm:px-5">
              <div className="pr-1">{renderActiveStepPanel({ pinned: true })}</div>
            </div>
          ) : null}
        </div>
      </div>
      )}
        </div>
      )}
      </section>
      </div>
      <ScratchPadModal open={isScratchPadOpen} onClose={() => setIsScratchPadOpen(false)} />
      <EquationScaffoldingModal
        open={Boolean(scaffoldingSession && !isStepFocusedLearningOpen)}
        step={activeScaffoldStep}
        stepIndex={scaffoldingSession?.stepIndex ?? 0}
        totalSteps={scaffoldingSession?.steps?.length ?? 0}
        showRemember={scaffoldingSession?.showRemember ?? false}
        wrongPickCount={scaffoldingSession?.wrongPickCount ?? 0}
        rememberText={activeScaffoldStep?.remember ?? ''}
        isFinished={scaffoldingSession?.isFinished ?? false}
        onSelectChoice={handleScaffoldingChoiceSelect}
        onLearnConcept={handleScaffoldingLearnConcept}
        onExitAlone={closeScaffoldingSession}
        onReturnToProblem={closeScaffoldingSession}
      />
      <StepFocusedLearningModal
        open={isStepFocusedLearningOpen}
        onClose={() => {
          setIsStepFocusedLearningOpen(false)
          setScaffoldingConceptKey(null)
        }}
        stageLabel={
          scaffoldingConceptKey ? '5단계 방정식 풀기' : currentStage?.displayLabel ?? ''
        }
        dialogTitle={scaffoldingConceptKey ? '이 개념 다시 배우기' : '단계 집중 학습'}
        returnButtonLabel={
          scaffoldingConceptKey
            ? '보리도사와 함께 푸는 방정식으로 돌아가기'
            : undefined
        }
        conceptBundles={stepFocusedConceptBundles}
      />
    </>
  )
}
