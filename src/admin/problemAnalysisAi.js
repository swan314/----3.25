/**
 * 관리자 대시보드 — 문제별 학습 통계 기반 분석.
 * Apps Script `admin_problem_analysis` 성공 시 AI JSON, 실패 시 createProblemAnalysisDraft 폴백.
 */

import {
  compactAdminAnalysisSections,
  createProblemAnalysisDraftMemo,
} from './adminProblemAnalysisTone.js'
import {
  ADMIN_PROBLEM_ANALYSIS_ACTION,
  ADMIN_PROBLEM_ANALYSIS_PAYLOAD_VERSION,
  extractAnalysisFromAppsScriptResponse,
} from './problemAnalysisContract.js'
import { resolveGasWebhookPostUrl } from '../sheets.js'

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
 * Web App POST — Apps Script 3단계에서 `action: admin_problem_analysis` 처리 시 성공.
 *
 * @param {ReturnType<typeof buildProblemAnalysisAiPayload>} payload
 * @returns {Promise<{ ok: boolean, analysis?: object, reason?: string }>}
 */
export async function generateProblemAnalysisFeedback(payload) {
  const url = resolveGasWebhookPostUrl()
  if (!url) {
    console.warn('[admin problem AI] missing VITE_API_URL')
    return { ok: false, reason: 'missing_api_url' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: ADMIN_PROBLEM_ANALYSIS_ACTION,
        v: ADMIN_PROBLEM_ANALYSIS_PAYLOAD_VERSION,
        data: payload,
      }),
    })
    const rawText = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(rawText)
    } catch {
      parsed = null
    }
    const analysis = extractAnalysisFromAppsScriptResponse(parsed)
    if (analysis) {
      return { ok: true, analysis: compactAdminAnalysisSections(analysis) }
    }
    console.warn('[admin problem AI] unexpected response', res.status, String(rawText || '').slice(0, 400))
    return { ok: false, reason: 'bad_response' }
  } catch (err) {
    console.warn('[admin problem AI]', err)
    return { ok: false, reason: 'network_error' }
  }
}

/**
 * API 우선, 실패·미구현 시 통계 초안.
 *
 * @param {ReturnType<typeof buildProblemAnalysisAiPayload>} payload
 * @returns {Promise<{ source: 'api' | 'stats', sections: ReturnType<typeof createProblemAnalysisDraft> }>}
 */
export async function fetchProblemAnalysisWithFallback(payload) {
  const apiRes = await generateProblemAnalysisFeedback(payload)
  if (apiRes.ok && apiRes.analysis) {
    return { source: 'api', sections: compactAdminAnalysisSections(apiRes.analysis) }
  }
  return { source: 'stats', sections: createProblemAnalysisDraft(payload) }
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
  return createProblemAnalysisDraftMemo(payload)
}
