/**
 * 유형별 평균 점수·실패율 — Recharts 미설치 시 CSS 막대그래프
 * @param {{ rows: Array<{ type: string, avgTotal: number, failRate: number }> }} props
 */
function AdminProblemTypeBarCharts({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : []
  if (safeRows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/90 px-4 py-4 text-center text-sm text-slate-600">
        그래프로 표시할 학습 기록이 없습니다.
      </p>
    )
  }

  const chartData = safeRows.map((r) => ({
    type: String(r.type ?? '—').trim() || '—',
    avgTotal: Number.isFinite(Number(r.avgTotal)) ? Number(r.avgTotal) : 0,
    failPct: Number.isFinite(Number(r.failRate)) ? Number(r.failRate) * 100 : 0,
  }))

  const maxAvg = Math.max(1e-6, ...chartData.map((d) => d.avgTotal), 6)

  return (
    <div className="grid gap-5 border-b border-indigo-100 bg-indigo-50/30 px-3 py-4 sm:gap-6 sm:px-4 lg:grid-cols-2">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wide text-indigo-900">유형별 평균 점수</h4>
        <p className="mt-0.5 text-[11px] text-slate-500">본문제, 유사문제1, 유사문제2의 평균 점수를 비교합니다.</p>
        <div className="mt-3 flex h-44 items-end justify-center gap-2 sm:gap-4" role="img" aria-label="유형별 평균 점수 막대 그래프">
          {chartData.map((d) => {
            const isZeroAvg = d.avgTotal <= 0
            const hAvg = isZeroAvg ? 0 : Math.min(100, (d.avgTotal / maxAvg) * 100)
            return (
              <div key={`avg-${d.type}`} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-bold tabular-nums text-indigo-950">{d.avgTotal.toFixed(1)}</span>
                <div
                  className="flex h-32 w-full max-w-[4.5rem] flex-col justify-end rounded-t-md bg-white/80 shadow-inner shadow-slate-200/80"
                  title={isZeroAvg ? `${d.type}: 0점` : `${d.type}: ${d.avgTotal.toFixed(1)}점`}
                >
                  {isZeroAvg ? (
                    <span className="sr-only">{`${d.type} 평균 0점`}</span>
                  ) : (
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-indigo-400 transition-all"
                      style={{ height: `${hAvg}%` }}
                    />
                  )}
                </div>
                <span className="max-w-full truncate text-center text-[11px] font-semibold text-slate-800" title={d.type}>
                  {d.type}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wide text-indigo-900">유형별 실패율</h4>
        <p className="mt-0.5 text-[11px] text-slate-500">5점 미만을 받은 학생의 비율을 유형별로 비교합니다.</p>
        <div className="mt-3 flex h-44 items-end justify-center gap-2 sm:gap-4" role="img" aria-label="유형별 실패율 막대 그래프">
          {chartData.map((d) => {
            const pctLabel = `${Math.round(d.failPct * 10) / 10}%`
            const isZero = d.failPct <= 0
            const hFail = isZero
              ? 0
              : Math.min(100, Math.max(4, d.failPct))
            return (
              <div key={`fail-${d.type}`} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-bold tabular-nums text-amber-950">{pctLabel}</span>
                <div
                  className="flex h-32 w-full max-w-[4.5rem] flex-col justify-end rounded-t-md bg-white/80 shadow-inner shadow-slate-200/80"
                  title={isZero ? `${d.type}: 0%` : `${d.type}: ${pctLabel}`}
                >
                  {isZero ? (
                    <span className="sr-only">{`${d.type} 실패율 0%`}</span>
                  ) : (
                    <div
                      className={`w-full rounded-t-md transition-all ${d.failPct >= 40 ? 'bg-gradient-to-t from-amber-700 to-amber-500' : 'bg-gradient-to-t from-slate-500 to-slate-400'}`}
                      style={{ height: `${hFail}%` }}
                    />
                  )}
                </div>
                <span className="max-w-full truncate text-center text-[11px] font-semibold text-slate-800" title={d.type}>
                  {d.type}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * 관리자 대시보드 — 선택한 문제에 대해 유형별 수련 통계
 * @param {{ selectedProblem: string, rows: Array<{ type: string, participantCount: number, avgTotal: number, failRate: number, avgHint: number, recordCount?: number }>, hasAnyTrainingRecords?: boolean }} props
 */
export function AdminProblemStatsTable({ selectedProblem, rows, hasAnyTrainingRecords }) {
  if (hasAnyTrainingRecords === false) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-600">
        이 클래스에서 수련을 완료한 기록이 아직 없습니다. 학생들이 수련을 마치면 여기에서 집계됩니다.
      </p>
    )
  }

  if (!selectedProblem) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-600">
        위에서 분석할 문제를 선택해 주세요.
      </p>
    )
  }

  const hasRows = Array.isArray(rows) && rows.length > 0

  if (!hasRows) {
    return (
      <div className="overflow-x-auto rounded-xl border border-indigo-200/80 bg-white shadow-sm shadow-indigo-500/5">
        <p className="border-b border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm font-bold text-indigo-950">
          문제: <span className="font-mono">{selectedProblem}</span>
        </p>
        <AdminProblemTypeBarCharts rows={[]} />
        <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
          <thead className="bg-indigo-50/95 text-xs font-bold uppercase tracking-wide text-indigo-900">
            <tr>
              <th className="border-b border-indigo-200 px-3 py-2.5">유형</th>
              <th className="border-b border-indigo-200 px-3 py-2.5">참여 학생</th>
              <th className="border-b border-indigo-200 px-3 py-2.5">평균 점수</th>
              <th className="border-b border-indigo-200 px-3 py-2.5">실패율</th>
              <th className="border-b border-indigo-200 px-3 py-2.5">평균 힌트</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="border-b border-slate-100 px-4 py-8 text-center text-sm text-slate-500">
                선택한 문제에 대한 집계가 없습니다. 다른 문제를 선택해 보세요.
              </td>
            </tr>
          </tbody>
        </table>
        <p className="border-t border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[11px] text-slate-600">
          실패율은 6단계 중 5점 미만을 받은 학생의 비율입니다. 평균 점수와 평균 힌트는 해당 문제를 완료한 학생의 기록을
          기준으로 계산됩니다.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-indigo-200/80 bg-white shadow-sm shadow-indigo-500/5">
      <p className="border-b border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm font-bold text-indigo-950">
        문제: <span className="font-mono">{selectedProblem}</span>
      </p>
      <AdminProblemTypeBarCharts rows={rows} />
      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-indigo-50/95 text-xs font-bold uppercase tracking-wide text-indigo-900 backdrop-blur-sm">
          <tr>
            <th className="border-b border-indigo-200 px-3 py-2.5">유형</th>
            <th className="border-b border-indigo-200 px-3 py-2.5">참여 학생</th>
            <th className="border-b border-indigo-200 px-3 py-2.5">평균 점수</th>
            <th className="border-b border-indigo-200 px-3 py-2.5">실패율</th>
            <th className="border-b border-indigo-200 px-3 py-2.5">평균 힌트</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const failRate = Number(row.failRate)
            const highFail = Number.isFinite(failRate) && failRate >= 0.4
            const avgTotal = Number(row.avgTotal)
            const avgHint = Number(row.avgHint)
            const pc = Number(row.participantCount)
            return (
              <tr
                key={`prob-stat-${String(row.type)}-${idx}`}
                className={
                  highFail
                    ? 'border-b border-red-200 bg-red-50 text-red-950'
                    : 'border-b border-slate-100 odd:bg-white even:bg-slate-50/70'
                }
              >
                <td className="px-3 py-2 font-semibold text-slate-900">{String(row.type ?? '—')}</td>
                <td className="px-3 py-2 tabular-nums text-slate-800">{Number.isFinite(pc) ? `${pc}명` : '—'}</td>
                <td className="px-3 py-2 tabular-nums text-slate-800">
                  {Number.isFinite(avgTotal) ? avgTotal.toFixed(1) : '—'}
                </td>
                <td
                  className={[
                    'px-3 py-2 tabular-nums font-semibold',
                    highFail ? 'text-red-700' : 'text-slate-800',
                  ].join(' ')}
                >
                  {Number.isFinite(failRate) ? `${Math.round(failRate * 1000) / 10}%` : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-800">
                  {Number.isFinite(avgHint) ? avgHint.toFixed(1) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[11px] text-slate-600">
        실패율은 6단계 중 5점 미만을 받은 학생의 비율입니다. 평균 점수와 평균 힌트는 해당 문제를 완료한 학생의 기록을
        기준으로 계산됩니다.
      </p>
    </div>
  )
}
