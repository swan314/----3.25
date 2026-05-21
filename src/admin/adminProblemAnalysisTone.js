/**
 * 교사 대시보드 문제별 AI 분석 — 짧은 수업 메모 톤
 */

export const ADMIN_SECTION_MAX_CHARS = 96

const VERBOSE_ADMIN_RE = [
  [/평균\s*점수는\s*[\d.]+\s*점으로\s*상대적으로/g, ''],
  [/해당\s*유형을\s*우선\s*보강할\s*필요가\s*있습니다/g, '보강 필요'],
  [/필요가\s*있습니다/g, '필요'],
  [/보입니다/g, '확인됨'],
  [/보여\s*줍니다/g, '확인됨'],
  [/것으로\s*보입니다/g, ''],
  [/것을\s*추천합니다/g, '권장'],
  [/진행해\s*주세요/g, '권장'],
  [/합니다\s*$/g, ''],
]

/** @param {string} text */
export function compactAdminAnalysisLine(text, max = ADMIN_SECTION_MAX_CHARS) {
  let t = String(text || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''

  for (const [re, rep] of VERBOSE_ADMIN_RE) {
    t = t.replace(re, rep)
  }
  t = t
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim()

  if (t.length > max) {
    const cut = t.slice(0, max - 1).replace(/\s+\S*$/, '').trim()
    t = cut || t.slice(0, max - 1)
  }
  if (t && !/[.!?。]$/.test(t)) t += '.'
  return t
}

/** @param {import('./problemAnalysisContract.js').AdminProblemAnalysisSections} sections */
export function compactAdminAnalysisSections(sections) {
  const s = sections || {}
  return {
    learningTrend: compactAdminAnalysisLine(s.learningTrend),
    majorDifficulty: compactAdminAnalysisLine(s.majorDifficulty),
    misconception: compactAdminAnalysisLine(s.misconception),
    teachingGuide: compactAdminAnalysisLine(s.teachingGuide),
    recommendedActivities: compactAdminAnalysisLine(s.recommendedActivities),
  }
}

export function buildAdminAnalysisOpenAiUserPrompt(problem, compactPayloadJson) {
  return [
    '역할: 중학교 일차방정식 수업 담당 교사의 문제별 분석 메모 작성.',
    '아래 JSON은 클래스 문제 코드 [' + problem + '] 유형별 집계·기록이다.',
    '',
    compactPayloadJson,
    '',
    '출력: 유효한 JSON 객체 하나만. 마크다운·코드펜스 금지.',
    '키(문자열): learningTrend, majorDifficulty, misconception, teachingGuide, recommendedActivities.',
    '',
    '【톤】 교사용 수업 메모. 각 필드 1~2문장, 필드당 40~80자.',
    '명사형·간결체(~확인됨, ~높음, ~필요, ~권장). 해요체·학생 격려 금지.',
    '"평균 점수는 X점으로 상대적으로" 같은 장문 설명 금지. 수치는 필드당 1개만.',
    '',
    'learningTrend: 점수·실패율 흐름만 (예: 유사문제 재도전 후 성취 향상 확인됨).',
    'majorDifficulty: 어려운 유형·단계만 (예: 문제 상황 해석 단계 보강 필요).',
    'misconception: 수업에서 다룰 핵심 개념·관계 (예: 거리·시간·속력 관계 정리 활동 필요).',
    'teachingGuide: 수업 흐름 제안 (예: 본문제 → 유사문제 순 반복 지도 권장).',
    'recommendedActivities: 짧은 활동 2~4개, 쉼표로 구분 (예: 조건 밑줄, 관계 표 완성).',
    '데이터 부족 시 한 줄로만 밝힐 것. 없는 수치 지어내지 말 것.',
  ].join('\n')
}

export const ADMIN_ANALYSIS_SYSTEM_PROMPT =
  '너는 JSON 객체만 반환한다. 교사용 분석 메모체. 장문·설명문·GPT 느낌 금지. 한국어.'

function findTypeRow(stats, pattern) {
  return stats.find((s) => pattern.test(String(s?.type ?? '')))
}

function pct(n) {
  return `${Math.round(Number(n) * 100)}%`
}

/** @param {import('./problemAnalysisContract.js').AdminProblemAnalysisPayload} payload */
export function createProblemAnalysisDraftMemo(payload) {
  const stats = Array.isArray(payload?.stats) ? payload.stats : []
  if (!stats.length) {
    return {
      learningTrend: '통계 부족 — 학습 경향 산출 불가.',
      majorDifficulty: '실패율 분석 데이터 부족.',
      misconception: '개념 분석 데이터 부족.',
      teachingGuide: '기록 누적 후 지도 순서 제안 예정.',
      recommendedActivities: '기초 유형 단계별 반복 수련.',
    }
  }

  const main = findTypeRow(stats, /본문제/) || stats[0]
  const similar = findTypeRow(stats, /유사/)
  const sortedByAvg = [...stats].sort((a, b) => Number(b.avgTotal) - Number(a.avgTotal))
  const sortedByFail = [...stats].sort((a, b) => Number(b.failRate) - Number(a.failRate))
  const topFail = sortedByFail[0]
  const highFail = stats.filter((s) => Number(s.failRate) >= 0.5)
  const lowAvg = sortedByAvg[sortedByAvg.length - 1]

  let learningTrend = ''
  if (similar && main && Number(similar.avgTotal) > Number(main.avgTotal) + 0.3) {
    learningTrend = '유사문제 재도전 후 성취 향상 확인됨.'
  } else if (Number(main.failRate) >= 0.5) {
    learningTrend = '본문제 이해 단계에서 어려움 나타남.'
  } else if (sortedByAvg.length >= 2) {
    learningTrend = `반복 수련 과정에서 ${String(sortedByAvg[0].type)} 중심 점수 상승 경향.`
  } else {
    learningTrend = `${String(main.type)} 평균 ${Number(main.avgTotal).toFixed(1)}점 — 안정적 흐름.`
  }

  let majorDifficulty = ''
  if (highFail.length) {
    const t = String(highFail[0].type)
    if (/본문제/.test(t)) {
      majorDifficulty = `본문제 실패율 ${pct(highFail[0].failRate)} — 초기 접근 어려움 높음.`
    } else {
      majorDifficulty = `${t} 실패율 ${pct(highFail[0].failRate)} — 반복 오류 가능.`
    }
  } else if (topFail) {
    majorDifficulty = `${String(topFail.type)} 실패율 ${pct(topFail.failRate)} — 단계 보강 필요.`
  }

  const focusType = String(lowAvg?.type || main?.type || '')
  let misconception = ''
  if (/유사/.test(focusType)) {
    misconception = '문제 상황 해석·식 변환 연습 필요.'
  } else if (/본문제/.test(focusType)) {
    misconception = '관계식 작성·방정식 세우기 개념 정리 필요.'
  } else {
    misconception = '핵심 관계를 식으로 표현하는 연습 필요.'
  }

  let teachingGuide = ''
  if (main && similar) {
    teachingGuide = '본문제 → 유사문제 순 반복 지도 권장.'
  } else if (highFail.length) {
    teachingGuide = `${String(highFail[0].type)} 관계식 작성 과정 함께 점검 필요.`
  } else {
    teachingGuide = '낮은 점수 유형 중심 개념 확인 후 유사문제 연결.'
  }

  let recommendedActivities = ''
  if (/본문제/.test(focusType) || Number(main?.failRate) >= 0.4) {
    recommendedActivities = '조건 밑줄, 관계 표 완성, 식 만들기 말로 설명하기.'
  } else {
    recommendedActivities = '유사문제 반복, 오답 원인 한 줄 정리, 짝 활동 점검.'
  }

  if (Number(payload?.lowestAvgTotalType?.avgTotal) < 5 && /거리|속력|시간/.test(
    (payload.typePatternSummary || []).map((x) => x.summary).join(' '),
  )) {
    misconception = '거리·시간·속력 관계 정리 활동 필요.'
    recommendedActivities = '관계 표 완성, 조건 밑줄, 식 세우기 말로 설명하기.'
  }

  return compactAdminAnalysisSections({
    learningTrend,
    majorDifficulty,
    misconception,
    teachingGuide,
    recommendedActivities,
  })
}
