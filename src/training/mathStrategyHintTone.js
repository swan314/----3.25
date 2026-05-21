/** CSV problemStrategy → 학생이 바로 행동할 수 있는 짧은 교사 힌트 */

const MAX_HINT_LEN = 58

/** success / partial / fail 공통 — OpenAI·폴백·후처리 */
export const STUDENT_FEEDBACK_VOICE_PROMPT = [
  '【말투 통일】 중1 수학 선생님이 옆에서 짧게 말하는 톤. 해요체.',
  '행동 중심: 해보자·확인해보자·정리해보자·이어가 보자·적어보자·세워보자.',
  'success·partial·fail 모두 같은 말투. 지나친 칭찬·임의 응원 금지.',
  '금지: ~필요합니다, ~중요합니다, ~활용하세요/바랍니다, 설명형(~하는 것이, ~이해하는 것), 나타났습니다.',
].join(' ')

function trimHint(text, max = MAX_HINT_LEN) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1).replace(/\s+\S*$/, '').trim()
  return cut || t.slice(0, max - 1)
}

function finishHint(text) {
  let t = trimHint(text)
  if (!t) return ''
  t = t.replace(/해보자\.?$/, '해보자.').replace(/확인해보자\.?$/, '확인해보자.')
  if (!/[.!?]$/.test(t)) t += '.'
  return t
}

/** 단계별 짧은 행동 힌트 (실패·보완 단계와 연결) */
export const TEACHER_STEP_STRATEGY = {
  step1: '구하는 것을 한 줄로 적은 뒤 식으로 옮겨보자.',
  step2: '구하는 양을 x로 정하고 끝까지 같은 문자로 써보자.',
  step3: '문제 속 관계가 식에 모두 들어갔는지 확인해보자.',
  step4: '방정식에 문제 조건이 모두 들어갔는지 다시 확인해보자.',
  step5_1: '괄호 안 모든 항에 숫자가 곱해졌는지 다시 확인해보자.',
  step5_2: '항을 옮긴 뒤 양변에 같은 항만 남았는지 확인해보자.',
  step5_3: 'x 앞 숫자로 나누기 전에 식이 맞는지 확인해보자.',
  step6: '구한 값을 문제 조건에 넣어 맞는지 확인해보자.',
}

const AWKWARD_FEEDBACK_RE =
  /에서\s*한\s*번\s*더\s*확인보면\s*좋아요|확인보면\s*좋아요|확인해\s*보면\s*좋아요|이어가\s*보세요|같은\s*흐름으로\s*풀어보세요|도움이\s*돼|필요합니다|중요합니다|활용하(시|해)\s*바랍|나타났습니다|이해하는\s*것이/

/**
 * @param {{ strategy?: string, principle?: string, failStep?: { key?: string, label?: string } | null }} input
 */
export function rewriteToTeacherStrategyHint(input) {
  const strategy = String(input?.strategy ?? '').trim().replace(/"/g, '')
  const principle = String(input?.principle ?? '').trim()
  const fail = input?.failStep || null
  const failKey = String(fail?.key ?? '').trim()
  const src = `${principle} ${strategy}`.replace(/\s+/g, ' ')

  if (/거리|속력|시간/.test(src)) {
    return finishHint('거리·시간·속력은 표에 적고 관계를 먼저 정리해보자')
  }
  if (/비율|전체.*부분|\/\d+\s*×|1\/\d/.test(src)) {
    return finishHint('전체와 부분의 관계를 표에 먼저 적어보자')
  }
  if (/분배|괄호|distributive/i.test(src) || failKey === 'step5_1') {
    return finishHint('괄호 안 모든 항에 숫자가 곱해졌는지 다시 확인해보자')
  }
  if (/10x\s*\+|10x\+|십의\s*자리|일의\s*자리|두\s*자리/.test(src)) {
    return finishHint('두 자리 수는 10x+a 꼴로 적고 조건을 식으로 옮겨보자')
  }
  if (/x\s*\+\s*1|연속|다음\s*(자연수|수)/.test(src)) {
    return finishHint('연속한 수는 x와 x+1로 두고 합·차를 식으로 세워보자')
  }
  if (/x\s*\+\s*2|홀수/.test(src)) {
    return finishHint('작은 수를 x로 두고 다음 수는 x+2로 적어보자')
  }
  if (/나이|살\s*많|많으면|\+\s*\d+/.test(strategy) || /많다|적다/.test(principle)) {
    const m = strategy.match(/\+\s*(\d+)/)
    if (m) return finishHint(`많은 쪽은 x+${m[1]}, 적은 쪽은 x로 두고 합·차 식을 세워보자`)
    return finishHint('많고 적은 쪽을 x와 x+N으로 나눠 식을 세워보자')
  }
  if (/다리|소|닭|양|오리|개.*다리/.test(src)) {
    return finishHint('동물마다 다리 수를 표에 적고 다리 합 식을 세워보자')
  }
  if (/둘레|직사각형|가로|세로/.test(src)) {
    return finishHint('가로·세로를 표에 적고 둘레나 넓이 식을 세워보자')
  }
  if (/개수\s*×|×\s*1|곱|배/.test(strategy)) {
    return finishHint('개수와 한 개 값을 곱한 식으로 관계를 적어보자')
  }
  if (/미래|몇\s*년\s*후|현재\s*나이/.test(src)) {
    return finishHint('지금 나이와 몇 년 뒤 나이를 x와 x+N으로 나눠 적어보자')
  }
  if (/주고\s*받|개수\s*변화/.test(src)) {
    return finishHint('주고받기 전·후 개수를 표에 적고 변화를 식으로 세워보자')
  }
  if (/항\s*이동|move_term/i.test(strategy) || failKey === 'step5_2') {
    return TEACHER_STEP_STRATEGY.step5_2
  }
  if (/계수|나누|divide/i.test(strategy) || failKey === 'step5_3') {
    return TEACHER_STEP_STRATEGY.step5_3
  }
  if (failKey && TEACHER_STEP_STRATEGY[failKey]) {
    return TEACHER_STEP_STRATEGY[failKey]
  }

  if (strategy) {
    let out = strategy
      .replace(/관계를\s*생각하고\s*/g, '')
      .replace(/를\s*떠올리(고|며)?\s*/g, '')
      .replace(/구해보자/g, '적어보자')
      .replace(/나타내(보자|야)/g, '적어보자')
      .replace(/생각해보자/g, '정리해보자')
      .replace(/이다\.?$/g, '로 적어보자')
      .replace(/\s+/g, ' ')
      .trim()
    if (out.length > 8) return finishHint(out)
  }

  if (principle && /많다|적다|합|차|비/.test(principle)) {
    return finishHint('조건을 표에 적고 관계를 식으로 옮겨보자')
  }

  return ''
}

export const MATH_STRATEGY_PROMPT_BLOCK = [
  '【수학 전략】 마지막 문장은 짧은 행동 힌트 1개만.',
  '설명·공식 암기 유도(~를 떠올려, ~관계를 생각해) 금지.',
  '"~확인보면 좋아요" 같은 어색한 표현 금지. 표를 그려·적어보자·확인해보자·세워보자 사용.',
  'problemStrategy를 참고하되 35~55자로 바로 실행 가능하게 다시 쓴다.',
].join(' ')

export const SUCCESS_STRATEGY_PROMPT_BLOCK = [
  '【성공·feedbackTier=success】 한국어 2~3문장.',
  '1문장: 흐름 안정(안정적이었어요·자연스럽게 이어졌어요). 2문장: 잘 이어진 단계 1개. 3문장: 다음 문제 습관·전략 유지(이어가 보자·정리해보자).',
  '실패 단계·어려움·표 그리기 보완 힌트 금지. "잘했어요·좋았어요"만 쓰지 말 것.',
].join(' ')

export const PARTIAL_STRATEGY_PROMPT_BLOCK = [
  '【부분 성공·feedbackTier=partial】 한국어 2~3문장.',
  '1문장: 흐름 인정(이해하고 있었어요·자연스럽게 이어졌어요). 2문장: 약한 단계 1개(확인해보자). 3문장: 행동 전략 1개.',
  '실패처럼 길게 쓰지 말고 같은 교사 말투 유지.',
].join(' ')

export const FAIL_STRATEGY_PROMPT_BLOCK = [
  '【실패·feedbackTier=fail】 한국어 2~3문장.',
  '1문장: 어려움이 있었어요. 2문장: 가장 어려운 단계 1개. 3문장: problemStrategy 기반 핵심 전략(해보자).',
  '격려·설명 최소화, 행동 힌트만.',
].join(' ')

const REMEDIAL_TONE_RE =
  /표를\s*(먼저\s*)?그려|어려움이\s*있었|특히\s*.+\s*단계에서\s*어려움|다시\s*도전|틀린\s*단계/

/** 성공 티어 — 보완·기초 전략 느낌 문장 */
export function isRemedialToneSentence(sentence) {
  return REMEDIAL_TONE_RE.test(String(sentence || ''))
}

export function pickSuccessPraiseLine(analysis) {
  const step = analysis?.primarySuccessStep
  const key = String(step?.key ?? '')
  if (key === 'step3') return '문제 조건을 정리하며 식을 세운 흐름이 안정적이었어요.'
  if (key === 'step4') return '방정식을 차근차근 세운 흐름이 자연스럽게 이어졌어요.'
  if (key === 'step2') return '미지수를 일관되게 두고 푼 흐름이 안정적이었어요.'
  if (step?.label) {
    const short = String(step.label).replace(/하기$/, '').trim()
    return `${short} 흐름이 자연스럽게 이어졌어요.`
  }
  return '문제 조건을 정리하며 식을 세운 흐름이 안정적이었어요.'
}

/** 성공 티어 — 전략 유지·습관 (실패 단계·표 그리기 최소화) */
export function pickSuccessMaintenanceHint(analysis) {
  const src = `${analysis?.problemPrinciple ?? ''} ${analysis?.problemStrategy ?? ''}`
  if (/거리|속력|시간/.test(src)) {
    return finishHint('다음 문제에서도 거리·시간·속력 관계를 정리하며 풀어보자')
  }
  if (/비율|전체|부분/.test(src)) {
    return finishHint('다음 문제에서도 전체와 부분 관계를 먼저 정리해보자')
  }
  if (/많다|적다|나이/.test(src)) {
    return finishHint('다음 문제에서도 관계를 정리하며 식을 세워보자')
  }
  return finishHint('다음 문제에서도 조건을 먼저 정리하는 습관을 이어가 보자')
}

/** 부분 성공 — 약한 단계 짚기 (코칭 톤) */
export function pickPartialWeakStepLine(analysis) {
  const fail = analysis?.primaryFailStep
  if (!fail?.label) return ''
  const label = String(fail.label).replace(/하기$/, '').trim()
  if (fail.key === 'step4') {
    return finishHint('방정식을 세울 때 문제 조건이 모두 들어갔는지 확인해보자')
  }
  if (fail.key === 'step3') {
    return finishHint('문제 속 관계가 식에 모두 들어갔는지 확인해보자')
  }
  return finishHint(`${label}에서 한 번 더 확인해보자`)
}

/** 부분 성공 — 전략 1개 */
export function pickPartialCoachingHint(analysis) {
  const hint = rewriteToTeacherStrategyHint({
    strategy: analysis?.problemStrategy,
    principle: analysis?.problemPrinciple,
    failStep: analysis?.primaryFailStep,
  })
  if (hint) return hint
  const fail = analysis?.primaryFailStep
  if (fail?.key && TEACHER_STEP_STRATEGY[fail.key]) {
    return TEACHER_STEP_STRATEGY[fail.key]
  }
  return finishHint('문제 조건을 하나씩 식으로 바꿔보자')
}

/** 실패 티어 — 핵심 전략 */
export function pickFailRemediationHint(analysis) {
  const hint = rewriteToTeacherStrategyHint({
    strategy: analysis?.problemStrategy,
    principle: analysis?.problemPrinciple,
    failStep: analysis?.primaryFailStep,
  })
  if (hint) return hint
  const fail = analysis?.primaryFailStep
  if (fail?.key && TEACHER_STEP_STRATEGY[fail.key]) {
    return TEACHER_STEP_STRATEGY[fail.key]
  }
  return finishHint('문제 조건을 하나씩 식으로 바꿔보자')
}

/**
 * 실패 단계 보완 또는 다음 문제용 전략 (성공·균형 톤 3·4문장째)
 * @param {object} analysis
 * @param {{ forFailStep?: boolean }} [options]
 */
export function pickContextStrategyHint(analysis, options = {}) {
  const tier = String(analysis?.feedbackTier || '').trim()
  if (tier === 'success') return pickSuccessMaintenanceHint(analysis)
  if (tier === 'partial') return pickPartialCoachingHint(analysis)
  if (tier === 'fail') return pickFailRemediationHint(analysis)

  const fail = analysis?.primaryFailStep
  const useFail = options.forFailStep !== false && fail?.key
  const hint = rewriteToTeacherStrategyHint({
    strategy: analysis?.problemStrategy,
    principle: analysis?.problemPrinciple,
    failStep: useFail ? fail : null,
  })
  if (hint) return hint
  if (useFail && fail?.key && TEACHER_STEP_STRATEGY[fail.key]) {
    return TEACHER_STEP_STRATEGY[fail.key]
  }
  return finishHint('다음 문제에서도 조건을 표에 적고 식으로 옮겨보자')
}

/** AI·폴백 문장을 통일된 교사 힌트 말투로 정리 */
export function unifyStudentFeedbackTone(sentence) {
  let t = String(sentence || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''

  t = t
    .replace(/활용하(시|해)\s*바랍니다/g, '먼저 적어보자')
    .replace(/활용해\s*보세요/g, '먼저 적어보자')
    .replace(/공식을\s*활용/g, '공식을 먼저 적어')
    .replace(/관계를\s*이해하는\s*것이\s*중요합니다/g, '관계를 먼저 정리해보자')
    .replace(/[^.!?]{0,40}이\s*중요합니다/g, '먼저 정리해보자')
    .replace(/확인이\s*필요합니다/g, '다시 확인해보자')
    .replace(/나타났습니다/g, '있었어요')
    .replace(/어려움이\s*나타났/g, '어려움이 있었')
    .replace(/연습이\s*필요합니다/g, '다시 연습해보자')
    .replace(/([가-힣·\s]{2,24})\s*필요합니다\.?$/g, '$1 해보자.')
    .replace(/잘했습니다/g, '안정적으로 해결했어요')
    .replace(/점이\s*좋아요/g, '흐름이 안정적이었어요')
    .replace(/흐름이\s*좋았어요/g, '흐름이 자연스럽게 이어졌어요')
    .replace(/확인보면\s*좋아요/g, '확인해보자')
    .replace(/확인해\s*보면\s*좋아요/g, '확인해보자')
    .replace(/도움이\s*돼\.?$/g, '확인해보자.')
    .replace(/해보세요/g, '해보자')
    .replace(/적어보세요/g, '적어보자')
    .replace(/세워보세요/g, '세워보자')
    .replace(/정리하세요/g, '정리해보자')

  if (!/[.!?]$/.test(t)) t += '.'
  return t.replace(/\s+/g, ' ').trim()
}

/** AI·폴백 문장이 어색하면 티어별 교사 힌트로 치환 */
export function replaceAwkwardFeedbackSentence(sentence, analysis) {
  const t = String(sentence || '').trim()
  if (!t || !analysis) return t
  const tier = String(analysis?.feedbackTier || '').trim()

  if (tier === 'success' && (AWKWARD_FEEDBACK_RE.test(t) || isRemedialToneSentence(t))) {
    return pickSuccessMaintenanceHint(analysis)
  }
  if (!AWKWARD_FEEDBACK_RE.test(t)) return unifyStudentFeedbackTone(t)
  if (tier === 'partial') return pickPartialCoachingHint(analysis)
  if (tier === 'fail') return pickFailRemediationHint(analysis)
  const hasFail = Boolean(analysis.primaryFailStep?.key)
  return pickContextStrategyHint(analysis, { forFailStep: hasFail })
}
