/**
 * 관리자 대시보드 — 문제별 학습 통계 기반 AI 분석(추후 OpenAI 연동).
 * 현재는 payload 구조만 정의하고, 호출 시 콘솔 로그만 출력합니다.
 */

/**
 * @param {string} classCode
 * @param {string} selectedProblem
 * @param {Array<object>} statsRows — 선택한 문제에 대한 유형별 통계 행 (class_problem_stats.stats 필터 결과)
 * @param {Array<object>} allRecords — 전체 수련 기록 (같은 API의 records)
 * @returns {{
 *   classCode: string,
 *   problem: string,
 *   stats: Array<{ type: string, participantCount: number, avgTotal: number, failRate: number, avgHint: number }>,
 *   records: Array<{ nickname: string, type: string, total: number|string, hint: number|string, status: string }>,
 *   highFailRateTypes: Array<{ type: string, failRate: number }>,
 *   lowestAvgTotalType: { type: string, avgTotal: number } | null,
 *   mostParticipantsType: { type: string, participantCount: number } | null,
 *   typePatternSummary: Array<{ type: string, summary: string }>
 * }}
 */
export function buildProblemAnalysisAiPayload(classCode, selectedProblem, statsRows, allRecords) {
  const sp = String(selectedProblem || '').trim()
  const stats = (Array.isArray(statsRows) ? statsRows : []).map((r) => ({
    type: String(r?.type ?? '').trim() || '—',
    participantCount: Number.isFinite(Number(r?.participantCount))
      ? Number(r.participantCount)
      : 0,
    avgTotal: Number.isFinite(Number(r?.avgTotal)) ? Number(r.avgTotal) : 0,
    failRate: Number.isFinite(Number(r?.failRate)) ? Number(r.failRate) : 0,
    avgHint: Number.isFinite(Number(r?.avgHint)) ? Number(r.avgHint) : 0,
  }))
  const records = (Array.isArray(allRecords) ? allRecords : [])
    .filter((r) => String(r?.problem ?? '').trim() === sp)
    .map((r) => ({
      nickname: String(r?.nickname ?? '').trim() || '—',
      type: String(r?.type ?? '').trim() || '—',
      total: Number.isFinite(Number(r?.total)) ? Number(r.total) : r?.total ?? '',
      hint: Number.isFinite(Number(r?.hint)) ? Number(r.hint) : r?.hint ?? '',
      status: String(r?.status ?? '').trim() || '—',
    }))
  const highFailRateTypes = stats
    .filter((s) => Number(s.failRate) >= 0.5)
    .map((s) => ({ type: s.type, failRate: s.failRate }))
  const lowestAvgTotalType = stats.length
    ? stats.reduce((minRow, row) => (row.avgTotal < minRow.avgTotal ? row : minRow), stats[0])
    : null
  const mostParticipantsType = stats.length
    ? stats.reduce(
        (maxRow, row) => (row.participantCount > maxRow.participantCount ? row : maxRow),
        stats[0],
      )
    : null
  const typePatternSummary = stats.map((row) => {
    const typeRecords = records.filter((r) => r.type === row.type)
    const failCount = typeRecords.filter((r) => String(r.status).includes('실패')).length
    const totalCount = typeRecords.length
    const successCount = typeRecords.filter((r) => String(r.status).includes('성공')).length
    const summary = [
      `참여 ${row.participantCount}명`,
      `평균점수 ${row.avgTotal.toFixed(2)}`,
      `실패율 ${(row.failRate * 100).toFixed(1)}%`,
      `힌트평균 ${row.avgHint.toFixed(2)}`,
      totalCount > 0 ? `기록 ${totalCount}건(성공 ${successCount}·실패 ${failCount})` : '기록 없음',
    ].join(', ')
    return { type: row.type, summary }
  })
  return {
    classCode: String(classCode || '').trim(),
    problem: sp,
    stats,
    records,
    highFailRateTypes,
    lowestAvgTotalType: lowestAvgTotalType
      ? { type: lowestAvgTotalType.type, avgTotal: lowestAvgTotalType.avgTotal }
      : null,
    mostParticipantsType: mostParticipantsType
      ? { type: mostParticipantsType.type, participantCount: mostParticipantsType.participantCount }
      : null,
    typePatternSummary,
  }
}

/**
 * 추후 OpenAI 등으로 문제 단위 집계 분석을 요청할 때 사용.
 * 현재: payload만 콘솔에 출력합니다.
 *
 * @param {ReturnType<typeof buildProblemAnalysisAiPayload>} payload
 * @returns {Promise<null>}
 */
export async function generateProblemAnalysisFeedback(payload) {
  console.log('[AI problem payload]', payload)
  return null
}

/**
 * API 없이 payload만으로 교사용 기본 분석 문장을 생성합니다.
 *
 * @param {ReturnType<typeof buildProblemAnalysisAiPayload>} payload
 * @returns {{
 *   learningTrend: string,
 *   majorDifficulty: string,
 *   misconception: string,
 *   teachingGuide: string,
 *   recommendedActivities: string
 * }}
 */
export function createProblemAnalysisDraft(payload) {
  const stats = Array.isArray(payload?.stats) ? payload.stats : []
  if (!stats.length) {
    return {
      learningTrend: '선택한 문제의 통계가 아직 충분하지 않아 학습 경향을 계산할 수 없습니다.',
      majorDifficulty: '실패율 분석을 위한 데이터가 부족합니다.',
      misconception: '점수 기반 오개념 추정에 필요한 데이터가 부족합니다.',
      teachingGuide: '기록이 누적되면 유형별 지도 순서를 자동 제안할 예정입니다.',
      recommendedActivities: '기초 유형부터 단계적으로 반복 학습을 진행해 주세요.',
    }
  }

  const sortedByAvg = [...stats].sort((a, b) => Number(b.avgTotal) - Number(a.avgTotal))
  const highestAvg = sortedByAvg[0]
  const lowestAvg = sortedByAvg[sortedByAvg.length - 1]
  const highFailTypes = stats.filter((s) => Number(s.failRate) >= 0.5)
  const sortedByFail = [...stats].sort((a, b) => Number(b.failRate) - Number(a.failRate))
  const topFail = sortedByFail[0]
  const lowTypeName = String(lowestAvg?.type || '특정 유형')
  const highTypeName = String(highestAvg?.type || '특정 유형')
  const highFailTypeNames = highFailTypes.map((s) => s.type).join(', ')

  const learningTrend =
    sortedByAvg.length >= 2
      ? `${highTypeName} 평균 점수는 ${Number(highestAvg.avgTotal).toFixed(1)}점으로 상대적으로 높지만, ${lowTypeName}은 ${Number(lowestAvg.avgTotal).toFixed(1)}점으로 낮아 유형별 편차가 보입니다.`
      : `${highTypeName} 중심으로 평균 ${Number(highestAvg.avgTotal).toFixed(1)}점 수준의 학습 성과가 확인됩니다.`

  const majorDifficulty = highFailTypes.length
    ? `${highFailTypeNames}에서 실패율이 높아 해당 유형을 우선 보강할 필요가 있습니다.`
    : `현재 유형별 실패율은 50% 미만이며, 가장 높은 실패율 유형은 ${String(topFail?.type || '미확인')} (${(Number(topFail?.failRate || 0) * 100).toFixed(1)}%)입니다.`

  const misconception =
    lowTypeName.includes('유사')
      ? `${lowTypeName}에서 점수가 낮아 응용 전환(문장 -> 식 변환 또는 조건 해석) 과정의 오개념 가능성이 보입니다.`
      : `${lowTypeName}에서 평균 점수가 가장 낮아 핵심 개념 정리와 풀이 절차 점검이 필요해 보입니다.`

  const teachingGuide =
    highFailTypes.length > 0
      ? `수업에서는 ${highFailTypes[0].type}을 먼저 짧게 재설명한 뒤, 유사 문항을 단계별로 제시해 실패 원인을 바로 교정하는 흐름을 권장합니다.`
      : `전체적으로 실패율은 안정적이므로, 낮은 점수 유형 중심으로 핵심 개념 확인 -> 짧은 확인 문제 -> 개별 피드백 순서로 지도해 주세요.`

  const recommendedActivities =
    highFailTypes.length > 0
      ? `${highFailTypes[0].type} 유형 반복 2~3문항, 오답 원인 말로 설명하기, 같은 개념의 난이도 하-중 문항 재도전을 추천합니다.`
      : `${lowTypeName} 보강용 유사문제 풀이와 풀이 과정을 설명하는 활동을 통해 개념을 안정화하는 것을 추천합니다.`

  return { learningTrend, majorDifficulty, misconception, teachingGuide, recommendedActivities }
}
