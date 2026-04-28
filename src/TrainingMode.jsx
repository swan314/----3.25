import { getStagesByLevel } from './config/curriculumConfig'; // 경로가 다르면 맞게 수정해주세요
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import magicMainIllustration from './assets/magic-main-illustration.png'
import sonGokuImg from './assets/son-goku.png'
import shaoImg from './assets/shao.png'
import samjangImg from './assets/samjang.png'
import okdongjaImg from './assets/okdongja.png'
import { updateSupplement } from './sheets'
import {
  findMatchingTrainingRowIndex,
  normalizeTrainingKind,
  resolveNextTrainingRowIndex,
} from './training/trainingRowSelect'
import {
  blanksAllCorrect,
  hasBlanks,
  matchesScaffoldExpected,
  splitByParentheses,
} from './training/scaffoldUtils'
import { loadGroupedTrainingData, loadTrainingCsvRows } from './utils/dataLoader'
import ScratchPadModal from './components/ScratchPadModal'

const DEFAULT_CSV_PATH = '/data/training_problems_with_similar_v2.csv'
const DEFAULT_HINTS_CSV_PATH = '/data/hints_structured.csv'

const STAGE_DEF = [
  { qKey: '비계1(구하고자 하는 것은 무엇인가요?)', aKey: null },
  { qKey: '비계2(미지수를 정해보자)', aKey: null },
  { qKey: '비계3(수학적 의미 찾기)', aKey: '비계3 정답' },
  { qKey: '비계4(방정식 세우기)', aKey: '비계4 정답' },
  { qKey: '비계5(방정식 풀기)', aKey: '비계5 정답' },
  { qKey: '비계6(답 구하기)', aKey: '비계6 정답' },
]

const POSITIVE_FEEDBACK = [
  '아주 좋아요! 이 흐름을 계속 유지해봐요.',
  '정확해요! 생각 과정을 잘 잡았어요.',
  '좋습니다! 다음 수련 단계로 가볼까요?',
]

const TRAINING_COMPLETION_MESSAGES = [
  '포기하지 않고 끝까지 해낸 당신이 정말 자랑스럽습니다.',
  '꾸준한 노력으로 큰 성장을 이루었습니다.',
  '이제 어떤 방정식도 해결할 수 있습니다!',
  '당신은 스스로 해낸 경험을 얻었습니다.',
]

/** 숫자카드 15종 (텍스트 목록용) */
const NUMBER_CARD_NAMES = [
  '등호 카드',
  '방정식 카드',
  '미지수 카드',
  '해 구하기 카드',
  '계수 카드',
  '상수항 카드',
  '이항 카드',
  '양변 연산 카드',
  '괄호 카드',
  '분수·비례 카드',
  '문장제 카드',
  '일차방정식 카드',
  '연산 순서 카드',
  '검산 카드',
  '방정식 마스터 카드',
]

function hintColumnsFromFlags(flags) {
  /** @type {Record<string, 'Y' | 'N'>} */
  const o = {}
  for (let i = 0; i < 6; i += 1) {
    o[`비계단계_${i + 1}_힌트여부`] = flags[i] ? 'Y' : 'N'
  }
  return o
}

/**
 * @typedef {{
 *   nickname?: string,
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

export default function TrainingMode({ nickname, onExit, trainingPlan = null }) {
  const [rows, setRows] = useState([])
  const [hintsData, setHintsData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [problemIdx, setProblemIdx] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  /** @type {[boolean[], function]} */
  const [hintFlags, setHintFlags] = useState(() => Array(6).fill(false))
  /** 진단·수련 세션 동안 힌트 버튼을 누른 횟수 */
  const [hintUsageCount, setHintUsageCount] = useState(0)
  /** 괄호 빈칸 값: 키 `${stepIdx}-${blankIdx}` */
  const [blankValues, setBlankValues] = useState({})
  const [textAnswer, setTextAnswer] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [answerCheckState, setAnswerCheckState] = useState('')
  const [wrongAttemptStreak, setWrongAttemptStreak] = useState(0)
  const [stepWrongCounts, setStepWrongCounts] = useState(() => Array(6).fill(0))
  const [stepHintUsed, setStepHintUsed] = useState(() => Array(6).fill(false))
  const [completedSteps, setCompletedSteps] = useState([])
  const [isResultView, setIsResultView] = useState(false)
  const [isResultReady, setIsResultReady] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [activeBlankKey, setActiveBlankKey] = useState('')
  const [isMathLiveReady, setIsMathLiveReady] = useState(false)
  const [isScratchPadOpen, setIsScratchPadOpen] = useState(false)
  const [trainingAllComplete, setTrainingAllComplete] = useState(false)
  /** 방금 완료한 문항의 비계 총점 (유사문제 분기용) */
  const [lastCompletedTotalScore, setLastCompletedTotalScore] = useState(0)
  /** 마지막(6/6) 결과보기 클릭 전, 저장 대기 중 페이로드 */
  const [pendingSavePayload, setPendingSavePayload] = useState(null)
  const [completionEncouragement, setCompletionEncouragement] = useState('')
  const blankLogTimer = useRef(null)
  const textInputRef = useRef(null)
  const mathFieldHostRef = useRef(null)
  const mathFieldRef = useRef(null)
  const blankInputRefs = useRef({})
  const startedProblemKeySetRef = useRef(new Set())
  const stepWrongCountsRef = useRef(Array(6).fill(0))
  const stepHintUsedRef = useRef(Array(6).fill(false))
  const savedTrainingKeysRef = useRef(new Set())
  const revealedStudentAnswerByStepRef = useRef({})

  useEffect(() => {
    setHintUsageCount(0)
    setHintFlags(Array(6).fill(false))
    setProblemIdx(0)
    setStepIdx(0)
    setBlankValues({})
    setTextAnswer('')
    setSuccessMessage('')
    setAnswerCheckState('')
    setWrongAttemptStreak(0)
    setStepWrongCounts(Array(6).fill(0))
    setStepHintUsed(Array(6).fill(false))
    stepWrongCountsRef.current = Array(6).fill(0)
    stepHintUsedRef.current = Array(6).fill(false)
    setCompletedSteps([])
    setIsResultView(false)
    setIsResultReady(false)
    setIsSaved(false)
    setActiveBlankKey('')
    setIsScratchPadOpen(false)
    blankInputRefs.current = {}
    startedProblemKeySetRef.current = new Set()
    setTrainingAllComplete(false)
    setCompletionEncouragement('')
    setLastCompletedTotalScore(0)
    setPendingSavePayload(null)
    savedTrainingKeysRef.current = new Set()
    revealedStudentAnswerByStepRef.current = {}
  }, [trainingPlan?.launchedAt])

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
        setProblemIdx(0)
        setStepIdx(0)
        setCompletedSteps([])
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
  }, [trainingPlan])

  useEffect(() => {
    if (!rows.length) return
    const resumeProblemCode = String(trainingPlan?.resumeProblemCode || '').trim().toUpperCase()
    const parsedResumeProblemCode = resumeProblemCode.match(/^(\d+)-([A-Z])$/)
    if (parsedResumeProblemCode) {
      const codeStage = Number(parsedResumeProblemCode[1])
      const codeType = String(parsedResumeProblemCode[2]).trim().toUpperCase()
      const resumeKind = normalizeTrainingKind(trainingPlan?.resumeType) || '본문제'
      const exactIdx = findMatchingTrainingRowIndex(rows, codeStage, codeType, resumeKind)
      if (exactIdx >= 0) {
        setProblemIdx(exactIdx)
        setStepIdx(0)
        setCompletedSteps([])
        setIsResultView(false)
        setIsResultReady(false)
        setIsSaved(false)
        setPendingSavePayload(null)
        return
      }

      const fallbackIdx = rows.findIndex((r) => {
        if (normalizeTrainingKind(r?.type) !== resumeKind) return false
        const rowStage = Number(r.__poolStage ?? r['단계'])
        const rowType = String(r?.['유형'] || '').trim().toUpperCase()
        if (!Number.isFinite(rowStage) || !rowType) return false
        if (rowStage > codeStage) return true
        if (rowStage < codeStage) return false
        return rowType > codeType
      })
      if (fallbackIdx >= 0) {
        setProblemIdx(fallbackIdx)
        setStepIdx(0)
        setCompletedSteps([])
        setIsResultView(false)
        setIsResultReady(false)
        setIsSaved(false)
        setPendingSavePayload(null)
        return
      }
    }

    const resumeStage = Number(trainingPlan?.resumeStage)
    const resumeProblemNumber = Number(trainingPlan?.resumeProblemNumber)
    const resumeTrainingKind = normalizeTrainingKind(trainingPlan?.resumeType) || '본문제'
    if (!Number.isFinite(resumeStage) || !Number.isFinite(resumeProblemNumber)) return
    if (resumeStage <= 0 || resumeProblemNumber <= 0) return

    const stageIndices = rows
      .map((r, idx) => ({ stage: Number(r.__poolStage), idx }))
      .filter((r) => r.stage === resumeStage)
      .map((r) => r.idx)
    if (!stageIndices.length) return

    const typedIndices =
      resumeTrainingKind && resumeTrainingKind !== 'next'
        ? stageIndices.filter((idx) => normalizeTrainingKind(rows[idx]?.type) === resumeTrainingKind)
        : stageIndices
    const indices = typedIndices.length ? typedIndices : stageIndices

    const boundedOffset = Math.min(Math.max(Math.floor(resumeProblemNumber) - 1, 0), indices.length - 1)
    setProblemIdx(indices[boundedOffset])
    setStepIdx(0)
    setCompletedSteps([])
    setIsResultView(false)
    setIsResultReady(false)
    setIsSaved(false)
    setPendingSavePayload(null)
  }, [
    rows,
    trainingPlan?.resumeStage,
    trainingPlan?.resumeProblemNumber,
    trainingPlan?.resumeType,
    trainingPlan?.resumeProblemCode,
  ])

  const row = rows[problemIdx] || null
  const isFinalStepLocked =
    stepIdx === STAGE_DEF.length - 1 &&
    (answerCheckState === 'correct' || answerCheckState === 'revealed')
  const isAwaitingResultSave =
    !isResultView &&
    isResultReady &&
    stepIdx === STAGE_DEF.length - 1 &&
    completedSteps.length >= STAGE_DEF.length

  const nextProblemIndexAfterPass = useMemo(() => {
    if (!isResultView || !row || !rows.length) return -2
    return resolveNextTrainingRowIndex(rows, row, lastCompletedTotalScore, true)
  }, [isResultView, row, rows, lastCompletedTotalScore])

  const currentDef = STAGE_DEF[stepIdx]
  const questionText = row && currentDef ? row[currentDef.qKey] ?? '' : ''
  const expectedAnswer = row && currentDef?.aKey ? row[currentDef.aKey] ?? '' : ''
  const isStepJudged =
    answerCheckState === 'correct' || answerCheckState === 'revealed'

  const blankParts = useMemo(() => splitByParentheses(questionText), [questionText])
  const stageUsesBlanks = stepIdx <= 1 && hasBlanks(questionText)

  const canAdvance = useMemo(() => {
    if (!row || !questionText) return false
    if (stepIdx <= 1 && stageUsesBlanks) {
      return blanksAllCorrect(questionText, blankValues, stepIdx)
    }
    if (stepIdx <= 1 && !stageUsesBlanks) {
      return Boolean((textAnswer || '').trim())
    }
    const rowType = String(row['유형'] ?? '').trim().toUpperCase()
    const rowStage = Number(row.__poolStage ?? row['학습단계'] ?? row['단계'])
    const allowUnorderedPairAtStep3 =
      stepIdx === 2 && rowStage === 5 && (rowType === 'A' || rowType === 'C')
    return matchesScaffoldExpected(textAnswer, expectedAnswer, {
      allowSwappedEquationSides: stepIdx === 3,
      allowUnorderedPair: allowUnorderedPairAtStep3,
      mathEquivalentMode: stepIdx === 2 ? 'addition' : stepIdx === 3 ? 'equation' : 'none',
    })
  }, [row, questionText, stepIdx, stageUsesBlanks, blankValues, textAnswer, expectedAnswer])

  useEffect(() => {
    setBlankValues({})
    setTextAnswer('')
    setSuccessMessage('')
    setAnswerCheckState('')
    setWrongAttemptStreak(0)
    setStepWrongCounts(Array(6).fill(0))
    setStepHintUsed(Array(6).fill(false))
    stepWrongCountsRef.current = Array(6).fill(0)
    stepHintUsedRef.current = Array(6).fill(false)
    setCompletedSteps([])
    revealedStudentAnswerByStepRef.current = {}
    setActiveBlankKey('')
    blankInputRefs.current = {}
    setIsResultReady(false)
  }, [problemIdx])

  useEffect(() => {
    if (answerCheckState !== 'correct') return
    if (canAdvance) setSuccessMessage(POSITIVE_FEEDBACK[stepIdx % POSITIVE_FEEDBACK.length])
  }, [canAdvance, stepIdx])

  const stepLabel = useMemo(() => {
    const raw = currentDef?.qKey || ''
    const match = raw.match(/^비계\d+\((.*)\)$/)
    if (match?.[1]) return match[1]
    return raw.replace(/^비계\d+\s*/, '').trim()
  }, [currentDef])
  const isEquationSolveStep = stepIdx === 4
  const isDiagnosticStyleMathStep = stepIdx === 2
  const mathPadTokens = ['=', '+', '-', '×', '/', '(', ')', '{', '}']

  const normalizeCollapsedFractionWithVariable = (text) =>
    String(text || '')
      // \frac{14}{x}처럼 저장된 경우를 (1)/(4)x 로 보정
      .replace(/\((\d)(\d)\)\/\(([a-zA-Z])\)/g, '($1)/($2)$3')
      // 14/x 형태로 남은 경우도 동일 보정
      .replace(/\b(\d)(\d)\/([a-zA-Z])\b/g, '($1)/($2)$3')

  const latexToPlain = (latex) =>
    normalizeCollapsedFractionWithVariable(
      (latex || '')
        .replace(/\\left|\\right/g, '')
        .replace(/\\text\s*\{\s*\}/g, ' ')
        .replace(/\\times|\\cdot/g, '*')
        .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
        .replace(/\\frac\s*([0-9a-zA-Z]+)\s*([0-9a-zA-Z]+)/g, '($1)/($2)')
        .replace(/\\/g, '')
        .replace(/[{}]/g, '')
        .trim()
    )

  const plainToDisplayLatex = (plainText) => {
    const raw = normalizeCollapsedFractionWithVariable(plainText).trim()
    if (!raw) return ''
    let latex = raw.replace(/\*/g, '\\times ')
    // (a)/(b) 두 덩어리 분수
    latex = latex.replace(/\(([^()]+)\)\/\(([^()]+)\)/g, '\\frac{$1}{$2}')
    // (1/4) 한 괄호 안의 숫자 분수 — x가 분모로 들어가는 오류 방지
    latex = latex.replace(/\((\d+)\/(\d+)\)/g, '\\frac{$1}{$2}')
    // 숫자/숫자 — 분모는 연속 숫자만 (1/4x → \frac{1}{4} 뒤에 x 분리)
    latex = latex.replace(/(\d+)\/(\d+)(?!\d)/g, '\\frac{$1}{$2}')
    // 남는 단순 문자/문자 분수 (x/y 한 글자 등)
    latex = latex.replace(/\b([a-zA-Z])\/([a-zA-Z])\b/g, '\\frac{$1}{$2}')
    return latex
  }

  /** 토큰 분리 시에도 1/4x 전체를 한 덩어리로 잡지 않도록 숫자 분수만 좁게 매칭 */
  const FRACTION_TOKEN_REGEX =
    /\(([^()]+)\)\/\(([^()]+)\)|\(\d+\/\d+\)|\d+\/\d+(?!\d)|\d+\/[a-zA-Z]/g

  const renderTextWithFractions = (text, keyPrefix = 'frac') => {
    const raw = String(text || '')
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
          className="mx-0.5 inline-block align-middle"
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

  const syncMathFieldToTextAnswer = () => {
    const mf = mathFieldRef.current
    if (!mf || typeof mf.getValue !== 'function') return
    const latex = (mf.getValue('latex') || '').trim()
    setTextAnswer(latexToPlain(latex))
    setAnswerCheckState('')
    setSuccessMessage('')
  }

  const insertFractionTemplate = (targetEl) => {
    if (!targetEl) return
    if (typeof targetEl.executeCommand === 'function') {
      targetEl.executeCommand(['insert', '\\frac{#?}{#?}'])
    } else if (typeof targetEl.insert === 'function') {
      targetEl.insert('\\frac{#?}{#?}')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!window.customElements?.get('math-field')) {
          await import('mathlive')
        }
        if (!cancelled) setIsMathLiveReady(true)
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
    const host = mathFieldHostRef.current
    if (!host || !isMathLiveReady) return
    host.innerHTML = ''
    const mf = document.createElement('math-field')
    mf.setAttribute(
      'style',
      'min-height:52px;width:100%;border:1px solid rgb(252 211 77);border-radius:0.75rem;padding:0.6rem 0.8rem;background-color:white;'
    )
    const handleInput = () => {
      syncMathFieldToTextAnswer()
    }
    mf.addEventListener('input', handleInput)
    host.appendChild(mf)
    mathFieldRef.current = mf
    return () => {
      mf.removeEventListener('input', handleInput)
      if (host.contains(mf)) host.removeChild(mf)
      mathFieldRef.current = null
    }
  }, [problemIdx, stepIdx, isMathLiveReady])

  const insertMathToken = (token) => {
    if (isStepJudged) return
    if (stepIdx <= 1 && stageUsesBlanks && activeBlankKey) {
      const blankInputEl = blankInputRefs.current[activeBlankKey]
      const currentValue = blankValues[activeBlankKey] ?? ''
      const start = blankInputEl?.selectionStart ?? currentValue.length
      const end = blankInputEl?.selectionEnd ?? currentValue.length
      const nextValue = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`
      const [stepPart, blankPart] = activeBlankKey.split('-')
      const blankLabel = Number(blankPart) + 1
      setBlankValues((prev) => ({ ...prev, [activeBlankKey]: nextValue }))
      setAnswerCheckState('')
      setSuccessMessage('')
      window.requestAnimationFrame(() => {
        blankInputEl?.focus()
        const cursor = start + token.length
        if (blankInputEl?.setSelectionRange) {
          blankInputEl.setSelectionRange(cursor, cursor)
        }
      })
      return
    }

    const mf = mathFieldRef.current
    if (mf) {
      if (token === '/') {
        insertFractionTemplate(mf)
      } else if (typeof mf.executeCommand === 'function') {
        mf.executeCommand(['insert', token === '×' ? '\\times' : token])
      } else if (typeof mf.insert === 'function') {
        mf.insert(token === '×' ? '\\times' : token)
      }
      syncMathFieldToTextAnswer()
      if (typeof mf.focus === 'function') mf.focus()
      return
    }

    const inputEl = textInputRef.current
    if (!inputEl) {
      setTextAnswer((prev) => `${prev}${token}`)
      setAnswerCheckState('')
      setSuccessMessage('')
      return
    }
    const start = inputEl.selectionStart ?? textAnswer.length
    const end = inputEl.selectionEnd ?? textAnswer.length
    const nextValue = `${textAnswer.slice(0, start)}${token}${textAnswer.slice(end)}`
    setTextAnswer(nextValue)
    setAnswerCheckState('')
    setSuccessMessage('')
    window.requestAnimationFrame(() => {
      inputEl.focus()
      const cursor = start + token.length
      inputEl.setSelectionRange(cursor, cursor)
    })
  }

  const renderMathPad = (withXPrefix = false, options = {}) => {
    const { hideMathField = false } = options
    return (
    <div className="space-y-2">
      {!hideMathField && (
        <div className="flex items-stretch gap-2">
          {withXPrefix && (
            <span className="inline-flex items-center rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 text-base font-black text-slate-800">
              x=
            </span>
          )}
          {isMathLiveReady ? (
            <div ref={mathFieldHostRef} className="flex-1" />
          ) : (
            <div className="flex-1 rounded-xl border border-yellow-300 bg-white px-3 py-3 text-xs text-slate-500 sm:text-sm">
              수식 입력기를 준비하는 중...
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {mathPadTokens.map((token) => (
          <button
            key={token}
            type="button"
            onClick={() => insertMathToken(token)}
            disabled={isStepJudged}
            className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800 transition hover:bg-blue-100 sm:text-base"
          >
            {token}
          </button>
        ))}
      </div>
    </div>
  )
  }

  const handleBlankChange = (key, expectedInner, value) => {
    if (isStepJudged) return
    setBlankValues((prev) => ({ ...prev, [key]: value }))
    setAnswerCheckState('')
    setSuccessMessage('')
  }

  const renderQuestionBody = () => {
    if (!row) return null
    if (stepIdx <= 1 && stageUsesBlanks) {
      let bi = 0
      return (
        <div className="space-y-3">
          <p className="text-base leading-relaxed text-slate-800 sm:text-lg">
            {blankParts.map((part, pi) => {
            if (part.type === 'text') {
              return <span key={`t-${pi}`}>{part.value}</span>
            }
            const idx = bi
            bi += 1
            const key = `${stepIdx}-${idx}`
            const expected = (part.expected ?? '').trim()
            const val = blankValues[key] ?? ''
            return (
              <input
                key={`b-${stepIdx}-${pi}`}
                ref={(el) => {
                  if (el) blankInputRefs.current[key] = el
                }}
                type="text"
                value={val}
                onChange={(e) => handleBlankChange(key, expected, e.target.value)}
                onFocus={() => setActiveBlankKey(key)}
                aria-label={`빈칸 ${idx + 1}`}
                autoComplete="off"
                disabled={isStepJudged}
                className={[
                  'mx-0.5 inline-block min-w-[4.5rem] max-w-[11rem] rounded-md border-2 border-dashed bg-white px-2 py-1 align-middle text-sm font-semibold outline-none transition sm:min-w-[5.5rem] sm:max-w-[14rem] sm:text-base',
                  'border-amber-400 text-slate-800',
                ].join(' ')}
              />
            )
            })}
          </p>
          {renderMathPad(false, { hideMathField: true })}
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-800 sm:text-lg">
          {renderTextWithFractions(questionText, `question-${problemIdx}-${stepIdx}`)}
        </p>
        <label className="block text-sm font-semibold text-slate-700">답 입력</label>
        {renderMathPad(isEquationSolveStep)}
        <div>
          <button
            type="button"
            onClick={handleCheckAnswer}
            disabled={isStepJudged}
            className={softButtonClass}
          >
            입력
          </button>
        </div>
      </div>
    )
  }

  const handleCheckAnswer = () => {
    if (isStepJudged) return
    if (isFinalStepLocked) return
    if (canAdvance) {
      setAnswerCheckState('correct')
      setSuccessMessage(POSITIVE_FEEDBACK[stepIdx % POSITIVE_FEEDBACK.length])
      setWrongAttemptStreak(0)
      console.log('[step] completed:', true)
      window.setTimeout(() => {
        handleNext({ forceProceed: true })
      }, 0)
      return
    }

    const nextWrongStreak = Number(stepWrongCountsRef.current[stepIdx] || 0) + 1
    setWrongAttemptStreak(nextWrongStreak)
    setStepWrongCounts((prev) => {
      const next = [...prev]
      next[stepIdx] = nextWrongStreak
      stepWrongCountsRef.current = next
      return next
    })
    setAnswerCheckState('wrong')
    setSuccessMessage('')

    const usedHintAtCurrentStep = Boolean(hintFlags[stepIdx])
    const reachedAutoRevealCondition =
      (usedHintAtCurrentStep && nextWrongStreak >= 2) || (!usedHintAtCurrentStep && nextWrongStreak >= 3)
    if (!reachedAutoRevealCondition) return

    const expectedBlanks = blankParts
      .filter((part) => part.type === 'blank')
      .map((part) => (part.expected ?? '').trim())
    const hasExpectedBlanks = stepIdx <= 1 && stageUsesBlanks && expectedBlanks.length > 0
    const revealedAnswer = hasExpectedBlanks
      ? expectedBlanks.join(', ')
      : (expectedAnswer || '').trim()
    const studentAnswerBeforeRevealForView =
      stepIdx <= 1 && stageUsesBlanks
        ? blankParts
            .filter((part) => part.type === 'blank')
            .map((_, idx) => blankValues[`${stepIdx}-${idx}`] ?? '')
            .join(', ')
        : textAnswer.trim()
    revealedStudentAnswerByStepRef.current[stepIdx] = studentAnswerBeforeRevealForView

    if (hasExpectedBlanks) {
      const nextValues = { ...blankValues }
      expectedBlanks.forEach((answer, idx) => {
        nextValues[`${stepIdx}-${idx}`] = answer
      })
      setBlankValues(nextValues)
    } else if (revealedAnswer) {
      setTextAnswer(revealedAnswer)
    }

    setAnswerCheckState('revealed')
    setSuccessMessage('정답이 공개되었습니다. "다음 수련 단계" 버튼으로 이동하세요.')
    setWrongAttemptStreak(0)
    console.log('[step] completed:', true)
    const triggerMessage = usedHintAtCurrentStep
      ? '힌트 사용 후 오답 2회'
      : '힌트 미사용 오답 3회'
    window.alert(`${triggerMessage}로 정답을 제공합니다.\n정답: ${revealedAnswer || '정답 정보 없음'}`)
    window.setTimeout(() => {
      handleNext({ forceProceed: true })
    }, 0)
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

    const currentStage = String(row?.__poolStage ?? row?.['단계'] ?? '').trim()
    const currentType = String(row?.['유형'] ?? '').trim().toUpperCase()
    const currentTrainingType = normalizeTrainingKind(row?.type) || '본문제'
    const currentStepOrder = String(stepIdx + 1)
    console.log('[hint-select] 단계:', currentStage)
    console.log('[hint-select] 유형:', currentType)
    console.log('[hint-select] type:', currentTrainingType)
    console.log('[hint-select] 단계_순서:', currentStepOrder)
    const matchedHint = hintsData.find(
      (hint) =>
        hint.단계 === currentStage &&
        hint.유형 === currentType &&
        hint.type === currentTrainingType &&
        hint.단계_순서 === currentStepOrder
    )
    console.log('[hint-select] matched hint:', matchedHint ?? null)
    const hintBody = matchedHint?.힌트내용 || '힌트를 준비 중입니다.'

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
    const { forceProceed = false } = options
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
      setSuccessMessage('')
      return
    }
    const capturedAnswerOnReveal = revealedStudentAnswerByStepRef.current[stepIdx]
    const answerForView =
      capturedAnswerOnReveal !== undefined
        ? capturedAnswerOnReveal
        : stepIdx <= 1 && stageUsesBlanks
          ? blankParts
              .filter((part) => part.type === 'blank')
              .map((_, idx) => blankValues[`${stepIdx}-${idx}`] ?? '')
              .join(', ')
          : textAnswer.trim()
    const correctAnswerForView =
      stepIdx <= 1 && stageUsesBlanks
        ? blankParts
            .filter((part) => part.type === 'blank')
            .map((part) => (part.expected ?? '').trim())
            .join(', ')
        : (expectedAnswer || '').trim()
    const currentStepWrongCount = Number(stepWrongCountsRef.current[stepIdx] || 0)
    const currentStepHintUsed = Boolean(stepHintUsedRef.current[stepIdx] || hintFlags[stepIdx])
    const isCurrentStepFailed =
      (currentStepHintUsed && currentStepWrongCount >= 2) ||
      (!currentStepHintUsed && currentStepWrongCount >= 3)
    const currentStepResult = isCurrentStepFailed ? 0 : 1

    const nextCompletedSteps = [
      ...completedSteps,
      {
        stepNumber: stepIdx + 1,
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

    if (stepIdx < STAGE_DEF.length - 1) {
      setStepIdx((s) => Math.min(s + 1, STAGE_DEF.length - 1))
      setBlankValues({})
      setTextAnswer('')
      setSuccessMessage('')
      setAnswerCheckState('')
      setWrongAttemptStreak(0)
      setActiveBlankKey('')
      blankInputRefs.current = {}
      setIsResultReady(false)
      return
    }
    const stepAnswerPayload = nextCompletedSteps.reduce((acc, item) => {
      acc[`step${item.stepNumber}`] = Number(item.processResult) > 0 ? 1 : 0
      return acc
    }, {})
    const totalScore = nextCompletedSteps.reduce((sum, item) => sum + (Number(item.processResult) > 0 ? 1 : 0), 0)
    const problemCode = `${String(row?.__poolStage ?? row?.['단계'] ?? '').trim()}-${String(
      row?.['유형'] || ''
    )
      .trim()
      .toUpperCase()}`

    setLastCompletedTotalScore(totalScore)

    const trainingType = normalizeTrainingKind(row?.type) || '본문제'
    const savePayload = {
      닉네임: nickname,
      type: trainingType,
      단계: row?.__poolStage ?? row?.['단계'] ?? '',
      문제번호: problemIdx + 1,
      problem: problemCode,
      ...stepAnswerPayload,
      total: totalScore,
      hint: hintUsageCount,
      ai: '성공했습니다',
      completedAt: new Date().toISOString(),
    }
    const saveKey = `${problemCode}|${trainingType}`
    console.log('[save] triggered by result button click')
    const alreadySaved = isSaved || savedTrainingKeysRef.current.has(saveKey)
    console.log('[save] already saved:', alreadySaved)
    if (!alreadySaved) {
      savedTrainingKeysRef.current.add(saveKey)
      const saveResult = await updateSupplement(savePayload)
      if (saveResult?.ok === false) {
        window.alert('저장에 실패했습니다. 다시 시도해주세요.')
        return
      }
    }
    setPendingSavePayload(null)
    setIsResultReady(false)
    setIsSaved(true)
    setIsResultView(true)
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
    setIsSaved(true)
    setIsResultView(true)
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
  }, [])

  const handleMoveToNextProblem = () => {
    if (!row) return
    const nextIdx = resolveNextTrainingRowIndex(rows, row, lastCompletedTotalScore)
    if (nextIdx < 0) {
      transitionToTrainingComplete()
      return
    }
    setProblemIdx(nextIdx)
    setStepIdx(0)
    setHintFlags(Array(6).fill(false))
    setWrongAttemptStreak(0)
    setStepWrongCounts(Array(6).fill(0))
    setStepHintUsed(Array(6).fill(false))
    stepWrongCountsRef.current = Array(6).fill(0)
    stepHintUsedRef.current = Array(6).fill(false)
    setCompletedSteps([])
    setIsResultView(false)
    setIsSaved(false)
    setPendingSavePayload(null)
  }

  const learnerName = (nickname || '').trim() || '학습자'
  const characterName = (trainingPlan?.characterName || '').trim() || '옥동자'
  const currentStep = Math.min(Math.max(stepIdx + 1, 1), STAGE_DEF.length)
  console.log('[render] isResultView:', isResultView)
  console.log('[render] currentStep:', currentStep)
  console.log('[step-control] currentStep:', currentStep)
  console.log('[step-control] isResultView:', isResultView)
  console.log('[step-control] isResultReady:', isResultReady)
  const characterCardImage = {
    손오공: sonGokuImg,
    샤오: shaoImg,
    삼장: samjangImg,
    옥동자: okdongjaImg,
  }[characterName] || magicMainIllustration
  const headerKicker = `학습자: ${learnerName} · 진단 레벨 캐릭터: ${characterName}`
  const softButtonClass =
    'rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 transition hover:bg-blue-50 active:translate-y-px'
  const accentButtonClass =
    'rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45'
  const textInputClass =
    'w-full rounded-xl border border-yellow-300 bg-white px-3 py-2.5 text-sm outline-none ring-yellow-300 transition focus:ring-2 sm:px-4 sm:py-3 sm:text-base'

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

        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white/90 px-5 py-5 text-left shadow-md sm:px-6">
          <p className="mb-4 text-center text-base font-black text-slate-800">🎴 획득 카드</p>
          <ul className="space-y-2 text-sm text-slate-700 sm:text-base">
            {NUMBER_CARD_NAMES.map((name) => (
              <li key={name} className="flex gap-2 border-b border-slate-100 pb-2 last:border-0">
                <span className="text-slate-400">•</span>
                <span>{name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-xs font-semibold text-slate-500">(총 15개)</p>
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
      <section className="rounded-3xl border border-blue-200/80 bg-white/90 p-4 shadow-2xl backdrop-blur-md sm:p-6 lg:p-8">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs font-semibold text-blue-700 sm:text-sm">{headerKicker}</p>
          <h2 className="mt-1 text-xl font-black text-blue-950 sm:text-2xl lg:text-3xl">방정식의 활용 수련</h2>
          <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:mt-5 sm:gap-3">
            <label className="text-xs font-semibold text-slate-700 sm:text-sm" htmlFor="training-problem">
              문항
            </label>
            <select
              id="training-problem"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold sm:px-3 sm:text-sm"
              value={problemIdx}
              onChange={(e) => {
                setProblemIdx(Number(e.target.value))
                setStepIdx(0)
                setHintFlags(Array(6).fill(false))
              }}
            >
              {rows.map((r, i) => (
                <option
                  key={`${r.__poolStage ?? 'x'}-${r['유형'] ?? ''}-${r.type ?? ''}-${i}`}
                  value={i}
                >
                  유형 {r['유형'] ?? i + 1}
                  {r.type ? ` · ${r.type}` : ''}
                  {r.__poolStage != null ? ` · 학습단계 ${r.__poolStage}` : ''}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500 sm:text-sm">
              ({problemIdx + 1} / {rows.length})
            </span>
            <span className="text-xs font-semibold text-slate-600 sm:text-sm">힌트 사용 {hintUsageCount}회</span>
          </div>
        </div>
        <div className="flex items-start gap-2.5 sm:gap-3 lg:self-end">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-2">
            <div className="flex items-center">
              <img
                src={characterCardImage}
                alt={`${characterName} 캐릭터 카드`}
                className="h-24 w-24 rounded-lg border border-blue-200 object-cover sm:h-32 sm:w-32 lg:h-40 lg:w-40"
              />
            </div>
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
            onClick={() => setIsScratchPadOpen(true)}
            className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100 sm:px-4 sm:text-sm"
          >
            연습장
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 sm:p-4">
        <p className="text-xs font-semibold uppercase text-amber-800">문제 텍스트</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 sm:text-base">
          {renderTextWithFractions(row['문제 텍스트'], `problem-text-${problemIdx}`)}
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 sm:mt-6 sm:p-5">
        <div className="max-h-[56vh] overflow-y-auto pr-1 sm:max-h-[620px]">
          {completedSteps.map((item) => (
            <div key={`completed-${item.stepNumber}`} className="mb-3 rounded-2xl border border-blue-200 bg-white p-3 sm:mb-4 sm:p-4">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                  수련 {item.stepNumber} / 6
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
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-sm text-blue-900">
                    {renderTextWithFractions(item.correctAnswer, `history-correct-${item.stepNumber}`)}
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
          {isResultView ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-bold text-blue-800">6단계 수련을 모두 마쳤습니다.</p>
              {nextProblemIndexAfterPass >= 0 ? (
                <button
                  type="button"
                  onClick={handleMoveToNextProblem}
                  className={accentButtonClass}
                >
                  다음 수련 단계로 이동
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => transitionToTrainingComplete()}
                  className={accentButtonClass}
                >
                  수련 완료 보기
                </button>
              )}
            </div>
          ) : (
            <>
              {!isAwaitingResultSave && !isFinalStepLocked && (
                <>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                      수련 {stepIdx + 1} / 6
                    </span>
                    <span className="text-sm font-extrabold text-slate-700 sm:text-base">{stepLabel}</span>
                  </div>
                  <div className="mt-4">{renderQuestionBody()}</div>
                  {stepIdx <= 1 && stageUsesBlanks && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={handleCheckAnswer}
                    disabled={isStepJudged}
                        className={softButtonClass}
                      >
                        입력
                      </button>
                    </div>
                  )}

                  {answerCheckState === 'correct' && (
                    <p className="mt-3 text-sm font-semibold text-emerald-700">
                      정답입니다!
                    </p>
                  )}
                  {answerCheckState === 'wrong' && (
                    <p className="mt-3 text-sm font-semibold text-rose-700">
                      다시 한번 생각해보세요. 힌트를 사용해도 좋습니다
                    </p>
                  )}
                  {answerCheckState === '' && !canAdvance && (
                    <p className="mt-3 text-sm text-slate-500">
                      {stepIdx <= 1 && stageUsesBlanks
                        ? ''
                        : '정답 형태로 입력하면 다음으로 넘어갈 수 있어요.'}
                    </p>
                  )}
                </>
              )}
              {!isAwaitingResultSave && !isFinalStepLocked && (
                <div className="mt-4 flex flex-wrap gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={handleHint}
                    disabled={isStepJudged}
                    className={softButtonClass}
                  >
                    힌트 보기
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </section>
      <ScratchPadModal open={isScratchPadOpen} onClose={() => setIsScratchPadOpen(false)} />
    </>
  )
}
