/**
 * 관리자 「문제별 AI 분석」— Apps Script(Web App)와 React 간 계약.
 * buildProblemAnalysisAiPayload() 결과를 그대로 POST body의 data로 넣습니다.
 *
 * 다음 단계에서 구현 예정:
 * - sheets.js: POST 호출 (generate_ai_feedback 와 동일 URL 패턴)
 * - Code.gs: doPost 에서 data.action === ADMIN_PROBLEM_ANALYSIS_ACTION 분기
 */

/** @typedef {{ type: string, participantCount: number, avgTotal: number, failRate: number, avgHint: number }} ProblemAnalysisStatRow */
/** @typedef {{ nickname: string, type: string, total: number|string, hint: number|string, status: string }} ProblemAnalysisRecordSlice */
/** @typedef {{ type: string, failRate: number }} ProblemAnalysisHighFail */
/** @typedef {{ type: string, avgTotal: number }} ProblemAnalysisLowAvg */
/** @typedef {{ type: string, participantCount: number }} ProblemAnalysisMostParticipants */
/** @typedef {{ type: string, summary: string }} ProblemAnalysisTypeSummary */

/**
 * Apps Script POST body의 `data` 필드 — buildProblemAnalysisAiPayload 반환값과 동형.
 *
 * @typedef {{
 *   classCode: string,
 *   problem: string,
 *   stats: ProblemAnalysisStatRow[],
 *   records: ProblemAnalysisRecordSlice[],
 *   highFailRateTypes: ProblemAnalysisHighFail[],
 *   lowestAvgTotalType: ProblemAnalysisLowAvg | null,
 *   mostParticipantsType: ProblemAnalysisMostParticipants | null,
 *   typePatternSummary: ProblemAnalysisTypeSummary[],
 * }} AdminProblemAnalysisPayload
 */

/**
 * OpenAI 등으로 생성한 5개 섹션 — createProblemAnalysisDraft() 결과와 필드명 동일.
 *
 * @typedef {{
 *   learningTrend: string,
 *   majorDifficulty: string,
 *   misconception: string,
 *   teachingGuide: string,
 *   recommendedActivities: string,
 * }} AdminProblemAnalysisSections
 */

/**
 * Apps Script가 반환하는 성공 본문 예시 (generate_ai_feedback 의 result/feedback 패턴과 유사).
 *
 * @typedef {{
 *   result?: string,
 *   ok?: boolean,
 *   analysis?: AdminProblemAnalysisSections,
 *   message?: string,
 * }} AdminProblemAnalysisResponse
 */

/** doPost JSON 최상위 action 값 — Code.gs 에서 동일 문자열로 분기 */
export const ADMIN_PROBLEM_ANALYSIS_ACTION = 'admin_problem_analysis'

/** 선택: 스키마 버전 (스크립트에서 무시해도 됨) */
export const ADMIN_PROBLEM_ANALYSIS_PAYLOAD_VERSION = 1

/**
 * POST 전체 바디 예:
 * {
 *   action: ADMIN_PROBLEM_ANALYSIS_ACTION,
 *   data: AdminProblemAnalysisPayload,
 *   v?: ADMIN_PROBLEM_ANALYSIS_PAYLOAD_VERSION
 * }
 */

const SECTION_KEYS = [
  'learningTrend',
  'majorDifficulty',
  'misconception',
  'teachingGuide',
  'recommendedActivities',
]

/**
 * @param {unknown} raw
 * @returns {raw is AdminProblemAnalysisSections}
 */
export function isCompleteAnalysisSections(raw) {
  if (!raw || typeof raw !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (raw)
  return SECTION_KEYS.every((k) => typeof o[k] === 'string' && String(o[k]).trim().length > 0)
}

/**
 * Apps Script 응답 JSON을 파싱한 객체에서 analysis 객체를 꺼냅니다.
 * @param {unknown} parsed — JSON.parse 결과
 * @returns {AdminProblemAnalysisSections | null}
 */
export function extractAnalysisFromAppsScriptResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const p = /** @type {AdminProblemAnalysisResponse} */ (parsed)
  if (p.analysis && isCompleteAnalysisSections(p.analysis)) {
    return /** @type {AdminProblemAnalysisSections} */ (p.analysis)
  }
  return null
}
