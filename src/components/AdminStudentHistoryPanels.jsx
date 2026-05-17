import {
  formatAdminHistoryNumericCell,
  formatAdminHistoryTableTimestamp,
  readRecordStatus,
  sheetStatusLabelForAdmin,
} from '../sheets'

/** 관리자 수련 상세: 8단계 (신규 수련 구조) */
const ADMIN_TRAINING_STEP_DEF = [
  { key: 'step1', label: '1단계' },
  { key: 'step2', label: '2단계' },
  { key: 'step3', label: '3단계' },
  { key: 'step4', label: '4단계' },
  { key: 'step5_1', label: '5-1' },
  { key: 'step5_2', label: '5-2' },
  { key: 'step5_3', label: '5-3' },
  { key: 'step6', label: '6단계' },
]

export function adminHistoryCategoryLabel(record) {
  const ns = readRecordStatus(record)
  if (ns === '진단완료' || ns === 'diagnostic_completed') return '진단평가'
  const prob = String(record.problem || '').trim()
  const typ = String(record.type || '').trim()
  if (prob && typ) return `${prob} ${typ}`.trim()
  if (prob) return prob
  if (typ) return typ
  return '수련'
}

function isAdminTrainingStepEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** 1=성공, 0=실패, 빈칸=해당 문제에 단계 없음 */
function adminTrainingStepResultLabel(v) {
  if (isAdminTrainingStepEmpty(v)) return '단계없음'
  const n = Number(v)
  if (!Number.isFinite(n)) return '단계없음'
  if (n === 1) return '성공'
  if (n === 0) return '실패'
  return n > 0 ? '성공' : '실패'
}

const ADMIN_STEP_RESULT_CHIP_BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight tracking-tight sm:px-2 sm:py-0.5 sm:text-[11px]'

function adminTrainingStepChipClass(label) {
  if (label === '단계없음') return 'bg-slate-200 text-slate-700 ring-1 ring-slate-300/80'
  if (label === '성공') return 'bg-emerald-600 text-white ring-1 ring-emerald-700/40'
  if (label === '실패') return 'bg-rose-600 text-white ring-1 ring-rose-700/40'
  return 'bg-amber-500 text-white ring-1 ring-amber-600/40'
}

/** 진단평가 시트 행 */
export function AdminDiagnosticHistoryDetail({ record }) {
  const ds = record.diag_score
  const scoreDisplay =
    typeof ds === 'number' && Number.isFinite(ds)
      ? ds
      : ds !== '' && ds != null && String(ds).trim() !== '' && Number.isFinite(Number(ds))
        ? Math.round(Number(ds))
        : '—'
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">진단평가 전체 기록</p>
        <p className="mt-1 text-sm text-emerald-950">
          레벨 결과와 진단 점수는 아래와 같이 시트에 저장된 값입니다.
        </p>
      </div>
      <dl className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-slate-500">레벨</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">{String(record.level || '—')}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">진단 점수</dt>
          <dd className="mt-0.5 text-sm tabular-nums font-semibold text-slate-900">{scoreDisplay}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">진단 시간</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{formatAdminHistoryTableTimestamp(record)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">상태</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{sheetStatusLabelForAdmin(record)}</dd>
        </div>
      </dl>
    </div>
  )
}

/** 수련 완료 행 — 8단계 + total / fail_count / status / timestamp */
export function AdminTrainingHistoryDetail({ record }) {
  const prob = String(record.problem || '').trim()
  const typ = String(record.type || '').trim()
  const headline = [prob, typ].filter(Boolean).join(' · ') || '수련'
  const aiSheetText = String(record.ai ?? '').trim()

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/90 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-800">수련 기록 (관리자)</p>
        <p className="mt-1 font-mono text-sm font-bold text-blue-950">{headline}</p>
      </div>

      <dl className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-slate-500">total</dt>
          <dd className="mt-0.5 text-sm tabular-nums font-semibold text-slate-900">
            {formatAdminHistoryNumericCell(record.total)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">fail_count</dt>
          <dd className="mt-0.5 text-sm tabular-nums font-semibold text-slate-900">
            {formatAdminHistoryNumericCell(record.fail_count ?? record.failCount)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">status</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{sheetStatusLabelForAdmin(record)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">timestamp</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{formatAdminHistoryTableTimestamp(record)}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-xl border border-blue-100 bg-slate-50/80">
        <table className="min-w-full text-center text-xs sm:text-sm">
          <tbody>
            <tr className="border-b border-blue-100 bg-blue-50/90 text-slate-700">
              <th className="whitespace-nowrap px-2 py-2 text-left font-semibold sm:px-3">단계</th>
              {ADMIN_TRAINING_STEP_DEF.map(({ key, label }) => (
                <th key={key} className="min-w-[3.25rem] px-1.5 py-2 font-semibold text-slate-800 sm:px-2">
                  {label}
                </th>
              ))}
            </tr>
            <tr className="bg-white">
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-semibold text-slate-700 sm:px-3">
                결과
              </th>
              {ADMIN_TRAINING_STEP_DEF.map(({ key }) => {
                const resultLabel = adminTrainingStepResultLabel(record[key])
                return (
                  <td key={key} className="px-1 py-2 sm:px-1.5">
                    <span
                      className={[ADMIN_STEP_RESULT_CHIP_BASE, adminTrainingStepChipClass(resultLabel)].join(
                        ' ',
                      )}
                    >
                      {resultLabel}
                    </span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
        <p className="border-t border-blue-100 px-3 py-2 text-[11px] text-slate-500">
          시트 저장값: 1=성공, 0=실패, 빈칸=단계없음
        </p>
      </div>

      {aiSheetText ? (
        <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">
            AI 피드백 (참고 · 품질 점검 전)
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{aiSheetText}</p>
        </details>
      ) : null}
    </div>
  )
}

export function isDiagnosticHistoryRecord(record) {
  const st = readRecordStatus(record)
  return st === '진단완료' || st === 'diagnostic_completed'
}
