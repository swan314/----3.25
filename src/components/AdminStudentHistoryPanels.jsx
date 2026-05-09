import {
  formatAdminSeoulSheetTimestamp,
  readRecordStatus,
  sheetStatusLabelForAdmin,
} from '../sheets'

/** TrainingMode STAGE_DEF 와 동일한 단계 라벨 (수련 결과 카드와 형식 맞춤) */
const TRAINING_STAGE_LABELS = [
  '비계1(구하고자 하는 것은 무엇인가요?)',
  '비계2(미지수를 정해보자)',
  '비계3(수학적 의미 찾기)',
  '비계4(방정식 세우기)',
  '비계5(방정식 풀기)',
  '비계6(답 구하기)',
]

export function adminHistoryCategoryLabel(record) {
  const ns = readRecordStatus(record)
  if (ns === 'diagnostic_completed') return '진단평가'
  const prob = String(record.problem || '').trim()
  const typ = String(record.type || '').trim()
  if (prob && typ) return `${prob} ${typ}`.trim()
  if (prob) return prob
  if (typ) return typ
  return '수련'
}

/** 관리자 수련 상세: 시트 값 그대로 — 1=성공, 0=실패, 빈칸=미기록 */
function adminTrainingStepLabel(v) {
  const empty =
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '')
  if (empty) return '미기록'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n > 0) return '성공'
  return '실패'
}

/** 진단평가 시트 행 — 학습자 마지막 화면과 유사한 정보 밀도 */
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
          <dd className="mt-0.5 text-sm text-slate-800">{formatAdminSeoulSheetTimestamp(record.diag_time)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">상태</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{sheetStatusLabelForAdmin(record)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-slate-500">기록 시각</dt>
          <dd className="mt-0.5 text-sm text-slate-800">
            {formatAdminSeoulSheetTimestamp(record.timestamp ?? record.completionDate ?? record.completedAt)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-slate-500">AI 피드백</dt>
          <dd className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            진단평가 AI 피드백은 추후 제공 예정입니다.
          </dd>
        </div>
      </dl>
    </div>
  )
}

/** 수련 완료 행 — 관리자 전용: 시트 필드 요약 + step1~6 (학습자 TrainingMode UI 미사용) */
export function AdminTrainingHistoryDetail({ record }) {
  const steps = [record.step1, record.step2, record.step3, record.step4, record.step5, record.step6]
  const prob = String(record.problem || '').trim()
  const typ = String(record.type || '').trim()
  const headline = [prob, typ].filter(Boolean).join(' · ') || '수련'
  const totalDisp =
    record.total === undefined || record.total === null || record.total === '' ? '—' : String(record.total)
  const hintDisp =
    record.hint === undefined || record.hint === null || record.hint === '' ? '—' : String(record.hint)
  const statusDisp = sheetStatusLabelForAdmin(record)
  const tsDisp = formatAdminSeoulSheetTimestamp(record.timestamp)
  const aiSheetText = String(record.ai ?? '').trim()

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/90 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-800">수련 기록 (관리자)</p>
        <p className="mt-1 font-mono text-sm font-bold text-blue-950">{headline}</p>
      </div>

      <dl className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-slate-500">문제번호</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">{prob || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">유형</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">{typ || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">total</dt>
          <dd className="mt-0.5 text-sm tabular-nums font-semibold text-slate-900">{totalDisp}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">hint</dt>
          <dd className="mt-0.5 text-sm tabular-nums text-slate-900">{hintDisp}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">status</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{statusDisp}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">timestamp</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{tsDisp}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-indigo-600">AI 피드백</dt>
          <dd className="mt-2 whitespace-pre-wrap rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-2.5 text-sm leading-relaxed text-slate-800">
            {aiSheetText || '아직 AI 피드백이 없습니다.'}
          </dd>
          <p className="mt-1 text-[11px] text-slate-500">시트 R열(ai) 저장값</p>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-xl border border-blue-100 bg-slate-50/80">
        <table className="min-w-full text-left text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-blue-100 bg-blue-50/90 text-slate-700">
              <th className="px-2 py-2 font-semibold">단계</th>
              {TRAINING_STAGE_LABELS.map((label, i) => (
                <th key={`h-${i}`} className="min-w-[7rem] px-2 py-2 font-semibold">
                  <span className="block text-[10px] uppercase text-slate-500">step{i + 1}</span>
                  <span className="block text-[11px] font-normal leading-tight text-slate-600">{label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-blue-50 bg-white">
              <td className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700">결과</td>
              {steps.map((raw, i) => {
                const lbl = adminTrainingStepLabel(raw)
                const chipClass =
                  lbl === '미기록'
                    ? 'bg-slate-100 text-slate-600'
                    : lbl === '성공'
                      ? 'bg-emerald-100 text-emerald-800'
                      : lbl === '실패'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-50 text-amber-800'
                return (
                  <td key={`c-${i}`} className="px-2 py-2">
                    <span className={['inline-flex rounded-full px-2 py-0.5 text-xs font-bold', chipClass].join(' ')}>
                      {lbl}
                    </span>
                    <span className="ml-1 tabular-nums text-[10px] text-slate-400">
                      ({lbl === '미기록' ? '—' : String(raw ?? '—')})
                    </span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
        <p className="border-t border-blue-100 px-3 py-2 text-[11px] text-slate-500">
          시트 저장값 (그대로 표시): 1=성공, 0=실패, 빈칸=미기록
        </p>
      </div>
    </div>
  )
}

export function isDiagnosticHistoryRecord(record) {
  return readRecordStatus(record) === 'diagnostic_completed'
}
