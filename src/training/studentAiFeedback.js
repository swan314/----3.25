import { TRAINING_SHEET_STEP_KEYS } from './trainingStageConfig.js'
import { getTrainingPedagogyFromRecord } from './trainingProblemMeta.js'
import {
  FAIL_STRATEGY_PROMPT_BLOCK,
  MATH_STRATEGY_PROMPT_BLOCK,
  PARTIAL_STRATEGY_PROMPT_BLOCK,
  isRemedialToneSentence,
  pickFailRemediationHint,
  pickPartialCoachingHint,
  pickPartialWeakStepLine,
  pickSuccessMaintenanceHint,
  pickSuccessPraiseLine,
  replaceAwkwardFeedbackSentence,
  STUDENT_FEEDBACK_VOICE_PROMPT,
  SUCCESS_STRATEGY_PROMPT_BLOCK,
  TEACHER_STEP_STRATEGY,
  unifyStudentFeedbackTone,
} from './mathStrategyHintTone.js'

const FEEDBACK_MAX_SENTENCES = 3

const FAILED_STEP_AI_TEXT_LIMITS = {
  meaning: 80,
  question: 280,
  answer: 120,
}

/** partial·fail + failedStepDetails — 답 비교 우선순위 */
const FEEDBACK_TIER_STATUS_RULE = [
  '【feedbackTier 우선】 status는 학습 결과 저장용 값이다.',
  'AI 피드백 문장 구조·톤·난이도는 반드시 feedbackTier(success/partial/fail)만 따른다.',
  'status가 "실패"여도 feedbackTier가 partial이면 partial 구조를 쓴다.',
].join(' ')

const FAILED_STEP_PRIORITY_RULE = [
  '【우선순위 — failedStepDetails가 있을 때】',
  '1순위: studentAnswer와 correctAnswer 차이 — 단, 오류 원인을 확실히 판단할 수 있을 때만 구체적으로(부호·숫자 등).',
  '2순위: primaryFailStep(가장 앞선 실패 단계).',
  '3순위: problemStrategy(일반 전략).',
  '차이만으로 원인이 불확실하면 1순위를 억지로 쓰지 말고 2→3순위의 안전한 행동 안내를 쓴다.',
  '최종 답·정답 전체·풀이 전체를 직접 알려주지 않는다.',
  '단계명을 그대로 나열하거나 "…하는 단계에서 어려움이"처럼 단계명을 문장에 끼워 넣지 않는다.',
].join(' ')

/** 구체적이지만 틀린 피드백 방지 */
const FEEDBACK_ACCURACY_RULE = [
  '【정확성 우선】 구체적이지만 틀린 피드백보다, 조금 일반적이더라도 정확한 피드백이 낫다.',
  'studentAnswer와 correctAnswer 차이만으로 부호·계산·단위·식 세우기 오류를 확실히 판단할 수 있을 때만 구체적으로 짚는다.',
  '확실하지 않으면 오류 유형을 추측하거나 단정하지 않고, primaryFailStep→problemStrategy 순의 안전한 행동 안내를 쓴다.',
].join(' ')

/** 시간·거리·속력 — 단위 변환 방향 단정 금지 */
const FEEDBACK_UNIT_SAFETY_RULE = [
  '【단위 — 보수적】 변환 방향(분→시간, 시간→분 등)이 답 차이만으로 확실하지 않으면 변환 방향을 말하지 않는다.',
  '안전 예: "시간의 단위가 식에서 서로 맞는지 확인해보자." "거리, 시간, 속력의 단위를 확인한 뒤 식을 세워보자."',
  '금지: "20분을 분으로 바꿔라"처럼 근거 없는 단위 변환 단정.',
].join(' ')

/** 최종 문장 품질 */
const FEEDBACK_SENTENCE_QUALITY_RULE = [
  '【문장 품질】 2~3문장, 각 문장은 마침표로 끝낸다.',
  '같은 행동 지시(확인해보자·정리해보자)를 반복하지 않는다.',
  '마침표 없이 문장을 이어 붙이지 않는다. generic 응원은 수학 피드백이 부족할 때만 1문장.',
].join(' ')

/** @deprecated FAILED_STEP_PRIORITY_RULE에 통합 — 하위 호환용 별칭 */
const FAILED_ANSWER_ANALYSIS_PROMPT = FAILED_STEP_PRIORITY_RULE

function clampFailedStepAiText(raw, max) {
  const t = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  if (t.length <= max) return t
  return t.slice(0, max - 1).trim()
}

function normalizeFailedStepDetailEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const stepNumberRaw = Number(raw.stepNumber)
  const stepNumber = Number.isFinite(stepNumberRaw) && stepNumberRaw > 0 ? stepNumberRaw : null
  const meaning = clampFailedStepAiText(raw.meaning, FAILED_STEP_AI_TEXT_LIMITS.meaning)
  const question = clampFailedStepAiText(raw.question, FAILED_STEP_AI_TEXT_LIMITS.question)
  const studentAnswer = clampFailedStepAiText(
    raw.studentAnswer ?? raw.answer,
    FAILED_STEP_AI_TEXT_LIMITS.answer,
  )
  const correctAnswer = clampFailedStepAiText(raw.correctAnswer, FAILED_STEP_AI_TEXT_LIMITS.answer)
  const wrongCount = Math.max(0, Math.round(Number(raw.wrongCount) || 0))
  const hintUsed = Boolean(raw.hintUsed)
  if (!meaning && !question && !studentAnswer && !correctAnswer && !stepNumber) return null
  return {
    stepNumber,
    meaning,
    question,
    studentAnswer,
    correctAnswer,
    wrongCount,
    hintUsed,
  }
}

function normalizeFailedStepDetailsArray(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeFailedStepDetailEntry).filter(Boolean)
}

/**
 * completedSteps(메모리)에서 실패 단계만 AI 분석용으로 추출합니다.
 * @param {object[]} completedSteps
 * @param {string[]} [stepMeanings]
 */
export function buildFailedStepDetailsFromCompletedSteps(completedSteps, stepMeanings = []) {
  const list = Array.isArray(completedSteps) ? completedSteps : []
  const meanings = Array.isArray(stepMeanings) ? stepMeanings : []
  return normalizeFailedStepDetailsArray(
    list
      .filter((item) => Number(item?.processResult) === 0)
      .map((item) => {
        const stepNumber = Number(item?.stepNumber) || null
        const meaning =
          String(item?.label || '').trim() ||
          (stepNumber && meanings[stepNumber - 1] ? String(meanings[stepNumber - 1]).trim() : '') ||
          (stepNumber ? `단계 ${stepNumber}` : '')
        return {
          stepNumber,
          meaning,
          question: item?.question,
          studentAnswer: item?.answer,
          correctAnswer: item?.correctAnswer,
          wrongCount: item?.wrongCount,
          hintUsed: item?.hintUsed,
        }
      }),
  )
}

/** 피드백·분석용 단계 표시명 */
export const FEEDBACK_STEP_LABELS = {
  step1: '무엇을 구하는지 파악',
  step2: '미지수 설정',
  step3: '문제 상황을 식으로 표현',
  step4: '방정식 세우기',
  step5_1: '식 정리',
  step5_2: '항 이동',
  step5_3: '계수 나누기',
  step6: '구한 값을 문제 상황에 맞게 해석',
}

const BANNED_CHEER =
  /힘내요|응원해요|MATH-MASTER|MATH-CARD|아자아자|화이팅|최고야|대단해|멋져|보리도사/gi

/** 후처리: 어색한 문장·단위 단정·붙은 문장 보정 */
function polishStudentFeedbackText(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''

  t = t.replace(/,\s*!\s*/g, '. ')
  t = t.replace(/,\s*$/g, '.')
  t = t.replace(
    /\d+\s*분을\s*분으로[^.!?]*/gi,
    '시간의 단위가 식에서 서로 맞는지 확인해보자',
  )
  t = t.replace(
    /(?:시간을\s*분으로|분을\s*시간으로|분으로\s*바꿔|시간으로\s*바꿔)[^.!?]*/gi,
    '거리, 시간, 속력의 단위를 확인한 뒤 식을 세워보자',
  )
  t = t.replace(/([요다자해])\s+(?=[가-힣])/g, '$1. ')
  return t.replace(/\s+/g, ' ').trim()
}

function dedupeSimilarFeedbackSentences(sentences) {
  const out = []
  const seen = []
  for (const raw of sentences) {
    const s = String(raw || '').trim()
    if (!s) continue
    const key = s
      .replace(/\s+/g, '')
      .replace(/[.!?…]+$/g, '')
      .slice(0, 24)
    if (seen.some((prev) => prev === key || (prev.includes(key) && key.length > 10))) continue
    if (seen.some((prev) => key.includes(prev) && prev.length > 10)) continue
    seen.push(key)
    out.push(s)
  }
  return out
}

/** 피드백 본문에서 카드 획득·미획득 문장 제거 */
const MATH_CARD_FEEDBACK_LINE =
  /MATH-?CARD|매쓰\s*카드|math\s*card|카드\s*(를\s*)?(획득|얻|받)|획득(하지|하지\s*못|못)\s*(했|하였)|다음\s*카드에\s*도전/i

/** fail_count 기준 전체 수행 수준 */
export function deriveOverallPerformanceLevel(fail_count) {
  const fc = Math.max(0, Math.round(Number(fail_count) || 0))
  if (fc <= 1) return 'stable'
  if (fc <= 3) return 'partial_difficulty'
  return 'multi_difficulty'
}

export function overallPerformanceSummarySentence(level) {
  if (level === 'stable') return '전체 해결 흐름이 안정적이었어요.'
  if (level === 'partial_difficulty') return '이번 문제에서는 일부 단계에서 어려움이 있었어요.'
  return '이번 문제에서는 여러 단계에서 어려움이 있었어요.'
}

/**
 * 피드백 3단계: success | partial | fail
 * - success: total >= 6 && fail_count <= 1
 * - fail: total <= 3 || fail_count >= 4
 * - partial: 그 외 (보통 total 4~5, fail 2~3)
 */
export function deriveFeedbackTier(fail_count, total) {
  const fc = Math.max(0, Math.round(Number(fail_count) || 0))
  const t = Math.max(0, Math.round(Number(total) || 0))
  if (t >= 6 && fc <= 1) return 'success'
  if (t <= 3 || fc >= 4) return 'fail'
  return 'partial'
}

/** @deprecated deriveFeedbackTier 사용 — GAS·레거시 호환 */
export function deriveFeedbackEmphasis(fail_count, total) {
  const tier = deriveFeedbackTier(fail_count, total)
  if (tier === 'success') return 'success'
  if (tier === 'fail') return 'remediation'
  return 'partial'
}

export function tierOverallSummarySentence(tier) {
  if (tier === 'success') return '전체 해결 흐름이 안정적이었어요.'
  if (tier === 'partial') return '전체 흐름은 자연스럽게 이어졌어요.'
  return '이번 문제에서는 여러 단계에서 어려움이 있었어요.'
}

export function enrichAnalysisWithOverallPerformance(analysis) {
  const a = analysis || analyzeStudentStepResult({})
  const level =
    String(a.overallPerformanceLevel || '').trim() ||
    deriveOverallPerformanceLevel(a.fail_count)
  const feedbackTier =
    String(a.feedbackTier || '').trim() || deriveFeedbackTier(a.fail_count, a.total)
  const feedbackEmphasis =
    String(a.feedbackEmphasis || '').trim() || deriveFeedbackEmphasis(a.fail_count, a.total)
  return {
    ...a,
    overallPerformanceLevel: level,
    overallPerformanceSummary:
      String(a.overallPerformanceSummary || '').trim() ||
      tierOverallSummarySentence(feedbackTier) ||
      overallPerformanceSummarySentence(level),
    feedbackTier,
    feedbackEmphasis,
  }
}

function isSuccessPraiseSentence(sentence, successLabels) {
  const t = String(sentence || '')
  if (/안정적으로 해결|잘 마쳤|잘 이어졌|훌륭|완벽|단계는 잘/.test(t)) return true
  for (const label of successLabels) {
    if (!label) continue
    if (t.includes(label) && /안정|잘|해결했|이어졌/.test(t)) return true
  }
  return false
}

const STEP_STRATEGY = TEACHER_STEP_STRATEGY

function isEmptyStepValue(raw) {
  return raw === '' || raw === null || raw === undefined
}

function normalizeStepOutcome(raw, isCorrectHint) {
  if (isEmptyStepValue(raw)) return 'skipped'
  if (typeof isCorrectHint === 'boolean') {
    return isCorrectHint ? 'success' : 'fail'
  }
  const n = Number(raw)
  if (n === 1) return 'success'
  if (n === 0) return 'fail'
  return 'skipped'
}

function labelForStepKey(key, meaning) {
  const fromMap = FEEDBACK_STEP_LABELS[key]
  if (fromMap) return fromMap
  const m = String(meaning || '').trim()
  return m || key
}

function buildStepRow(key, raw, extra = {}) {
  const outcome = normalizeStepOutcome(raw, extra.isCorrect)
  return {
    key,
    label: labelForStepKey(key, extra.meaning),
    outcome,
    index: extra.index ?? null,
  }
}

/**
 * @param {object} record 시트 행·aiPayload·저장 payload
 * @returns {{
 *   successSteps: Array<{key:string,label:string}>,
 *   failSteps: Array<{key:string,label:string}>,
 *   skippedSteps: Array<{key:string,label:string}>,
 *   total: number,
 *   fail_count: number,
 *   type: string,
 *   status: string,
 *   primarySuccessStep: {key:string,label:string}|null,
 *   primaryFailStep: {key:string,label:string}|null,
 * }}
 */
export function analyzeStudentStepResult(record) {
  const input = record || {}
  const rows = []

  const hasSheetKeys = TRAINING_SHEET_STEP_KEYS.some(
    (key) => !isEmptyStepValue(input[key]) || !isEmptyStepValue(input.stepResults?.[key]),
  )

  if (hasSheetKeys) {
    TRAINING_SHEET_STEP_KEYS.forEach((key) => {
      const raw = input.stepResults?.[key] ?? input[key]
      rows.push(buildStepRow(key, raw))
    })
  } else if (Array.isArray(input.steps) && input.steps.length) {
    input.steps.forEach((step, i) => {
      const key = TRAINING_SHEET_STEP_KEYS[i] || `step${i + 1}`
      const raw = step.isCorrect === true ? 1 : step.isCorrect === false ? 0 : ''
      rows.push(
        buildStepRow(key, raw, {
          isCorrect: step.isCorrect,
          meaning: step.meaning,
          index: Number(step.index) || i + 1,
        }),
      )
    })
  }

  const successSteps = rows
    .filter((r) => r.outcome === 'success')
    .map(({ key, label }) => ({ key, label }))
  const failSteps = rows
    .filter((r) => r.outcome === 'fail')
    .map(({ key, label }) => ({ key, label }))
  const skippedSteps = rows
    .filter((r) => r.outcome === 'skipped')
    .map(({ key, label }) => ({ key, label }))

  const totalFromRecord = Number(input.total)
  const total = Number.isFinite(totalFromRecord)
    ? Math.max(0, Math.round(totalFromRecord))
    : successSteps.length

  const failFromRecord = Number(input.fail_count ?? input.failCount)
  const fail_count = Number.isFinite(failFromRecord)
    ? Math.max(0, Math.round(failFromRecord))
    : failSteps.length

  const primarySuccessStep = successSteps.length ? successSteps[successSteps.length - 1] : null
  const primaryFailStep = failSteps.length ? failSteps[0] : null
  const { problemPrinciple, problemStrategy } = getTrainingPedagogyFromRecord(input)

  return enrichAnalysisWithOverallPerformance({
    successSteps,
    failSteps,
    skippedSteps,
    total,
    fail_count,
    type: String(input.type ?? input.problemMeta?.type ?? '').trim(),
    status: String(input.status ?? '').trim(),
    primarySuccessStep,
    primaryFailStep,
    problemPrinciple,
    problemStrategy,
    failedStepDetails: normalizeFailedStepDetailsArray(input.failedStepDetails),
  })
}

function buildFeedbackPromptInstructions(tier, hasFailedDetails = false) {
  if (tier === 'success') {
    return [
      '【출력】 한국어 2~3문장. 번호·목록 금지.',
      '1문장: 흐름 안정(안정적이었어요·자연스럽게 이어졌어요).',
      '2문장: 잘 이어진 단계 1개. 3문장: 다음 문제 습관·전략 유지(이어가 보자·정리해보자).',
      '실패 단계·어려움·표 그리기 보완 힌트 금지.',
    ].join('\n')
  }
  if (tier === 'partial' && hasFailedDetails) {
    return [
      '【출력 — partial + failedStepDetails】 한국어 2~3문장. 번호·목록 금지.',
      '1문장: 전체 흐름 또는 잘한 부분을 짧게 인정(예: 전체 흐름은 자연스럽게 이어졌어요).',
      '2문장: 답 차이로 오류가 확실할 때만 구체적으로 짚고 행동 1개(확인해보자·세워보자).',
      '확실하지 않으면 primaryFailStep·problemStrategy로 안전하게 안내(예: 조건이 식에 모두 들어갔는지 확인해보자).',
    ].join('\n')
  }
  if (tier === 'partial') {
    return [
      '【출력】 한국어 2~3문장. 번호·목록 금지.',
      '1문장: 흐름 인정. 2문장: 약한 단계 1개(확인해보자). 3문장: 행동 전략 1개.',
    ].join('\n')
  }
  if (tier === 'fail' && hasFailedDetails) {
    return [
      '【출력 — fail + failedStepDetails】 한국어 2~3문장. 번호·목록 금지.',
      '1문장: 여러 단계 어려움이 있었음을 짧게(예: 여러 단계에서 어려움이 있었어요).',
      '2문장: primaryFailStep과 연관된 오류 — 답 차이로 확실할 때만 구체적으로, 아니면 안전한 행동 1개.',
      '모든 실패를 나열하지 않는다. 단계명을 어색하게 반복하지 않는다. 성공 단계 칭찬 금지.',
    ].join('\n')
  }
  return [
    '【출력】 한국어 2~3문장. 번호·목록 금지.',
    '1문장: 어려움이 있었어요. 2문장: 가장 어려운 단계. 3문장: 핵심 전략(해보자).',
  ].join('\n')
}

function tierPromptBlock(tier) {
  if (tier === 'success') return SUCCESS_STRATEGY_PROMPT_BLOCK
  if (tier === 'partial') return PARTIAL_STRATEGY_PROMPT_BLOCK
  return FAIL_STRATEGY_PROMPT_BLOCK
}

export function buildAiFeedbackPrompt(analysis) {
  const a = enrichAnalysisWithOverallPerformance(analysis || analyzeStudentStepResult({}))
  const tier = a.feedbackTier || deriveFeedbackTier(a.fail_count, a.total)
  const failedStepDetails =
    tier !== 'success' ? normalizeFailedStepDetailsArray(a.failedStepDetails) : []

  const data = {
    feedbackTier: tier,
    overallPerformanceLevel: a.overallPerformanceLevel,
    overallPerformanceSummary: a.overallPerformanceSummary,
    feedbackEmphasis: a.feedbackEmphasis,
    successSteps: a.successSteps.map((s) => s.label),
    failSteps: a.failSteps.map((s) => s.label),
    primarySuccessStep: a.primarySuccessStep?.label || null,
    primaryFailStep: a.primaryFailStep?.label || null,
    problemPrinciple: a.problemPrinciple || '—',
    problemStrategy: a.problemStrategy || '—',
    total: a.total,
    fail_count: a.fail_count,
    type: a.type || '—',
    status: a.status || '—',
  }
  if (failedStepDetails.length > 0) {
    data.failedStepDetails = failedStepDetails
  }

  const hasFailedDetails = failedStepDetails.length > 0
  const strategyNote = hasFailedDetails
    ? 'failedStepDetails: 답 차이로 오류가 확실할 때만 구체적으로. 불확실하면 problemStrategy로 안전하게.'
    : ''
  const accuracyBlock =
    tier !== 'success' && hasFailedDetails
      ? [FEEDBACK_ACCURACY_RULE, FEEDBACK_UNIT_SAFETY_RULE, FEEDBACK_SENTENCE_QUALITY_RULE].join('\n')
      : tier !== 'success'
        ? FEEDBACK_SENTENCE_QUALITY_RULE
        : ''

  return [
    '중1 일차방정식 수련 결과를 바탕으로, 옆에서 짧게 말하는 수학 선생님 톤의 학습 피드백만 작성하세요.',
    '',
    STUDENT_FEEDBACK_VOICE_PROMPT,
    '',
    tier !== 'success' ? FEEDBACK_TIER_STATUS_RULE : '',
    tier !== 'success' && hasFailedDetails ? FAILED_STEP_PRIORITY_RULE : '',
    accuracyBlock,
    '',
    buildFeedbackPromptInstructions(tier, hasFailedDetails),
    '',
    MATH_STRATEGY_PROMPT_BLOCK,
    strategyNote,
    hasFailedDetails ? '' : tierPromptBlock(tier),
    '',
    '【금지】 문제 지문 인용·요약, 과한 응원(힘내요·응원해요·MATH-MASTER), MATH-CARD·카드 획득/미획득 언급, 단계없음 언급, 빈 단계명·", , ,".',
    '단계명을 문장에 그대로 끼워 넣거나 "…하는 단계에서 어려움이"처럼 어색하게 반복하지 않는다.',
    tier === 'fail' && !hasFailedDetails
      ? '【중요】 feedbackTier가 fail이면 성공 단계 칭찬 문장을 쓰지 마세요.'
      : '',
    tier === 'success'
      ? '【중요】 feedbackTier가 success이면 실패 단계·어려움·표 그리기 보완 힌트를 쓰지 마세요.'
      : '',
    '',
    '【분석 데이터】',
    JSON.stringify(data, null, 2),
  ]
    .filter(Boolean)
    .join('\n')
}

/** 티어별 핵심 전략 (fail·partial) */
export function pickMathStrategyHint(analysis) {
  const tier = String(analysis?.feedbackTier || '').trim() || deriveFeedbackTier(
    analysis?.fail_count,
    analysis?.total,
  )
  if (tier === 'success') return pickSuccessMaintenanceHint(analysis)
  if (tier === 'partial') return pickPartialCoachingHint(analysis)
  return pickFailRemediationHint(analysis)
}

/**
 * @param {ReturnType<typeof analyzeStudentStepResult>} analysis
 */
export function generateFallbackFeedback(analysis) {
  const a = enrichAnalysisWithOverallPerformance(analysis || analyzeStudentStepResult({}))
  const tier = a.feedbackTier || deriveFeedbackTier(a.fail_count, a.total)
  const sentences = [
    tierOverallSummarySentence(tier) || a.overallPerformanceSummary,
  ].filter(Boolean)

  if (tier === 'success') {
    sentences.push(pickSuccessPraiseLine(a))
    sentences.push(pickSuccessMaintenanceHint(a))
  } else if (tier === 'partial') {
    if (!a.primaryFailStep?.key && a.primarySuccessStep) {
      const label = String(a.primarySuccessStep.label).replace(/하기$/, '').trim()
      sentences.push(`${label}까지는 자연스럽게 이어졌어요.`)
    }
    const weakLine = pickPartialWeakStepLine(a)
    if (weakLine) sentences.push(weakLine)
    sentences.push(pickPartialCoachingHint(a))
  } else {
    if (a.primaryFailStep) {
      const label = String(a.primaryFailStep.label).replace(/하기$/, '').trim()
      sentences.push(`${label} 단계에서 어려움이 있었어요.`)
    } else if (a.fail_count > 0 && !/어려움이\s*있었/.test(sentences[0] || '')) {
      sentences.push('이번 문제의 주요 단계에서 어려움이 있었어요.')
    }
    sentences.push(pickFailRemediationHint(a))
  }

  return sanitizeStudentFeedback(
    sentences.filter(Boolean).slice(0, FEEDBACK_MAX_SENTENCES).join(' '),
    a,
  )
}

export function sanitizeStudentFeedback(rawText, analysis) {
  let text = polishStudentFeedbackText(
    String(rawText || '')
      .replace(/\r/g, '\n')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )

  text = text.replace(BANNED_CHEER, '')
  text = polishStudentFeedbackText(text)
  text = text
    .replace(/[^.!?]{1,48}를\s*떠올리고,\s*/g, '')
    .replace(/관계를\s*생각하고\s*/g, '')
    .replace(/관계를\s*생각해\s*/g, '')
  text = text.replace(/,\s*,+/g, ', ')
  text = text.replace(/\s+,/g, ',')
  text = text.replace(/^\s*[,.]\s*/g, '')

  const parts = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !/^[,.\s]+$/.test(s))

  const tier =
    String(analysis?.feedbackTier || '').trim() ||
    (analysis ? deriveFeedbackTier(analysis.fail_count, analysis.total) : '')
  const limited = parts.slice(0, FEEDBACK_MAX_SENTENCES)
  if (!limited.length) return ''

  const successLabels = new Set((analysis?.successSteps || []).map((s) => s.label))
  const failLabels = new Set((analysis?.failSteps || []).map((s) => s.label))

  const polished = limited.map((sentence) => {
    const replaced = analysis ? replaceAwkwardFeedbackSentence(sentence, analysis) : sentence
    return unifyStudentFeedbackTone(replaced)
  })

  const filtered = dedupeSimilarFeedbackSentences(
    polished.filter((sentence) => {
    if (!analysis) return true
    const praisesFail = [...failLabels].some(
      (label) => label && (sentence.includes(`${label} 단계는 안정`) || sentence.includes(`${label}는 잘`)),
    )
    if (praisesFail) return false
    const isTierSummaryLine = /^(전체 해결 흐름|전체 흐름|이번 문제에서는)/.test(sentence)
    const falseSuccess =
      !isTierSummaryLine &&
      [...successLabels].length === 0 &&
      /안정|잘했|잘 해|훌륭|완벽/.test(sentence)
    if (falseSuccess && analysis.fail_count > 0) return false
    const emphasis = analysis.feedbackEmphasis
    if ((tier === 'fail' || emphasis === 'remediation') && isSuccessPraiseSentence(sentence, successLabels)) {
      return false
    }
    if (tier === 'success' && isRemedialToneSentence(sentence)) return false
    return true
    }),
  )

  return polishStudentFeedbackText(
    stripMathCardMentionsFromFeedback(filtered.join(' ').trim().slice(0, 520)),
  )
}

export function stripMathCardMentionsFromFeedback(rawText) {
  const parts = String(rawText || '')
    .replace(/\r/g, '\n')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const kept = parts.filter((sentence) => !MATH_CARD_FEEDBACK_LINE.test(sentence))
  return kept.join(' ').replace(/\s+/g, ' ').trim()
}

/** 화면·시트·관리자 공통 표시 — 카드 획득 문구는 제외 */
export function getStudentFeedbackDisplayText(feedbackText) {
  return stripMathCardMentionsFromFeedback(String(feedbackText || '').trim())
}

/**
 * 최종 학습 피드백 단일 생성 (화면·시트 ai 열·관리자 동일 문자열)
 * @param {object} record aiPayload 또는 시트 행
 * @param {{ post?: typeof postGenerateAiFeedback }} [options]
 */
export async function generateStudentFeedback(record, options = {}) {
  const analysis = enrichAnalysisWithOverallPerformance(analyzeStudentStepResult(record))
  const post = options.post
  if (typeof post !== 'function') {
    return generateFallbackFeedback(analysis)
  }

  const payload = { v: 4, analysis }

  try {
    const res = await post(payload)
    if (res?.ok) {
      const fromApi = sanitizeStudentFeedback(String(res.feedback ?? '').trim(), analysis)
      if (fromApi) return fromApi
    } else {
      console.warn('[studentAiFeedback] API issue', res?.reason || res)
    }
  } catch (err) {
    console.warn('[studentAiFeedback] fetch failed', err)
  }

  return generateFallbackFeedback(analysis)
}
