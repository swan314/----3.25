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
  })
}

function buildFeedbackPromptInstructions(tier) {
  if (tier === 'success') {
    return [
      '【출력】 한국어 2~3문장. 번호·목록 금지.',
      '1문장: 흐름 안정(안정적이었어요·자연스럽게 이어졌어요).',
      '2문장: 잘 이어진 단계 1개. 3문장: 다음 문제 습관·전략 유지(이어가 보자·정리해보자).',
      '실패 단계·어려움·표 그리기 보완 힌트 금지.',
    ].join('\n')
  }
  if (tier === 'partial') {
    return [
      '【출력】 한국어 2~3문장. 번호·목록 금지.',
      '1문장: 흐름 인정. 2문장: 약한 단계 1개(확인해보자). 3문장: 행동 전략 1개.',
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

  return [
    '중1 일차방정식 수련 결과를 바탕으로, 옆에서 짧게 말하는 수학 선생님 톤의 학습 피드백만 작성하세요.',
    '',
    STUDENT_FEEDBACK_VOICE_PROMPT,
    '',
    buildFeedbackPromptInstructions(tier),
    '',
    MATH_STRATEGY_PROMPT_BLOCK,
    tierPromptBlock(tier),
    '',
    '【금지】 문제 지문 인용·요약, 과한 응원(힘내요·응원해요·MATH-MASTER), MATH-CARD·카드 획득/미획득 언급, 단계없음 언급, 빈 단계명·", , ,".',
    tier === 'fail'
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
  let text = String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  text = text.replace(BANNED_CHEER, '')
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

  const filtered = polished.filter((sentence) => {
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
  })

  return stripMathCardMentionsFromFeedback(filtered.join(' ').trim().slice(0, 520))
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
