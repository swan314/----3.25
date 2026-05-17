/** 학생 데이터 테이블·학생 상세 요약 공통 열 정의 */
export const ADMIN_STUDENT_SUMMARY_COLUMNS = [
  { key: 'nickname', label: '닉네임' },
  { key: 'level', label: '레벨' },
  { key: 'diagnosticScore', label: '진단점수' },
  { key: 'mathCardCount', label: '매쓰카드 수' },
  { key: 'mainSuccessCount', label: '성공한 본문제 수' },
  { key: 'mainFailCount', label: '실패한 본문제 수' },
  { key: 'similarSuccessCount', label: '성공한 유사문제 수' },
  { key: 'similarFailCount', label: '실패한 유사문제 수' },
  { key: 'lastActivity', label: '최근 활동 시간' },
]

function formatDiagnosticScore(source, pending) {
  const ds = source?.diagnosticScore ?? source?.diag_score
  if (pending && (ds === undefined || ds === null || ds === '')) return '—'
  if (typeof ds === 'number' && Number.isFinite(ds)) return String(ds)
  if (ds !== '' && ds != null && String(ds).trim() !== '' && Number.isFinite(Number(ds))) {
    return String(Math.round(Number(ds)))
  }
  return pending ? '—' : '—'
}

function formatCount(value, pending) {
  if (pending) return '—'
  const n = Number(value)
  return String(Number.isFinite(n) ? n : 0)
}

/**
 * roster 행 또는 computeAdminStudentSummary 결과 → 표시용 문자열 맵
 * @param {object | null | undefined} source
 * @param {{ pending?: boolean }} [options]
 */
export function formatAdminStudentSummaryCells(source, { pending = false } = {}) {
  const s = source || {}
  return {
    nickname: String(s.nickname ?? '—'),
    level: String(s.level ?? '—') || '—',
    diagnosticScore: formatDiagnosticScore(s, pending),
    mainSuccessCount: formatCount(s.mainSuccessCount, pending),
    mainFailCount: formatCount(s.mainFailCount, pending),
    similarSuccessCount: formatCount(s.similarSuccessCount, pending),
    similarFailCount: formatCount(s.similarFailCount, pending),
    mathCardCount: formatCount(s.mathCardCount, pending),
    lastActivity: pending
      ? '—'
      : String(s.lastActivityDisplay ?? s.lastActivity ?? '—') || '—',
  }
}
