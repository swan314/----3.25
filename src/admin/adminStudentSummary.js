import {
  adminHistoryRowTimeMsForSort,
  fetchAdminStudentLearningHistory,
  formatAdminSeoulSheetTimestamp,
  isAdminKoreanSheetTimestampString,
} from '../sheets'
import { normalizeTrainingKind } from '../training/trainingRowSelect'
import {
  collectSuccessProblemCodesFromRecords,
  isDiagnosticSheetStatus,
  isTrainingFailStatus,
  isTrainingSuccessStatus,
  normalizeProblemCodeList,
  resolveRecordSheetStatus,
} from '../training/trainingStatus'

/** @param {unknown} record */
function problemCodeFromRecord(record) {
  const prob = String(record?.problem ?? record?.문항번호 ?? '')
    .trim()
    .toUpperCase()
  return /^\d+-[A-Z]$/.test(prob) ? prob : ''
}

/** @param {unknown} record */
function isTrainingHistoryRecord(record) {
  return !isDiagnosticSheetStatus(resolveRecordSheetStatus(record))
}

/**
 * @param {unknown[]} records
 * @param {(record: unknown) => boolean} matches
 */
function countUniqueProblems(records, matches) {
  const codes = new Set()
  for (const r of records) {
    if (!isTrainingHistoryRecord(r)) continue
    if (!matches(r)) continue
    const code = problemCodeFromRecord(r)
    if (code) codes.add(code)
  }
  return codes.size
}

function resolveDiagnosticScore(rosterRow, records) {
  const fromRoster = rosterRow?.diag_score
  if (typeof fromRoster === 'number' && Number.isFinite(fromRoster)) {
    return Math.round(fromRoster)
  }
  if (
    fromRoster !== '' &&
    fromRoster != null &&
    String(fromRoster).trim() !== '' &&
    Number.isFinite(Number(fromRoster))
  ) {
    return Math.round(Number(fromRoster))
  }
  for (const r of records) {
    if (!isDiagnosticSheetStatus(resolveRecordSheetStatus(r))) continue
    const ds = r.diag_score
    if (typeof ds === 'number' && Number.isFinite(ds)) return Math.round(ds)
    if (ds !== '' && ds != null && String(ds).trim() !== '' && Number.isFinite(Number(ds))) {
      return Math.round(Number(ds))
    }
  }
  return null
}

function resolveLevel(rosterRow, records) {
  const fromRoster = String(rosterRow?.level ?? rosterRow?.diagnosticTier ?? '').trim()
  if (fromRoster) return fromRoster
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i]
    if (!isDiagnosticSheetStatus(resolveRecordSheetStatus(r))) continue
    const lv = String(r?.level ?? '').trim()
    if (lv) return lv
  }
  return ''
}

/**
 * @param {{
 *   records?: unknown[],
 *   rosterRow?: object | null,
 *   completedProblems?: unknown[],
 * }} input
 */
export function computeAdminStudentSummary({ records, rosterRow, completedProblems }) {
  const list = Array.isArray(records) ? records : []

  const mainSuccessCount = countUniqueProblems(
    list,
    (r) =>
      normalizeTrainingKind(r?.type) === '본문제' &&
      isTrainingSuccessStatus(resolveRecordSheetStatus(r)),
  )

  const mainFailCount = countUniqueProblems(
    list,
    (r) =>
      normalizeTrainingKind(r?.type) === '본문제' &&
      isTrainingFailStatus(resolveRecordSheetStatus(r)),
  )

  const similarSuccessCount = countUniqueProblems(
    list,
    (r) =>
      normalizeTrainingKind(r?.type) === '유사문제1' &&
      isTrainingSuccessStatus(resolveRecordSheetStatus(r)),
  )

  const similarFailCount = countUniqueProblems(
    list,
    (r) =>
      normalizeTrainingKind(r?.type) === '유사문제1' &&
      isTrainingFailStatus(resolveRecordSheetStatus(r)),
  )

  const normalizedCompleted = normalizeProblemCodeList(completedProblems)
  let mathCardCount = 0
  if (normalizedCompleted.length > 0) {
    mathCardCount = normalizedCompleted.length
  } else {
    const trainingRows = list.filter(isTrainingHistoryRecord)
    mathCardCount = collectSuccessProblemCodesFromRecords(trainingRows).size
  }

  let lastActivityMs = 0
  for (const r of list) {
    const ms = adminHistoryRowTimeMsForSort(r)
    if (ms > lastActivityMs) lastActivityMs = ms
  }

  const rosterLastActivity = String(rosterRow?.lastActivity ?? '').trim()
  let lastActivityDisplay = '—'
  if (isAdminKoreanSheetTimestampString(rosterLastActivity)) {
    lastActivityDisplay = rosterLastActivity
  } else if (lastActivityMs > 0) {
    lastActivityDisplay = formatAdminSeoulSheetTimestamp(lastActivityMs)
  } else if (rosterLastActivity) {
    lastActivityDisplay = formatAdminSeoulSheetTimestamp(rosterLastActivity)
  }

  const nickname = String(
    rosterRow?.nickname ?? rosterRow?.닉네임 ?? rosterRow?.Nickname ?? rosterRow?.name ?? '',
  ).trim()

  return {
    nickname,
    level: resolveLevel(rosterRow, list) || '—',
    diagnosticScore: resolveDiagnosticScore(rosterRow, list),
    mainSuccessCount,
    mainFailCount,
    similarSuccessCount,
    similarFailCount,
    mathCardCount,
    lastActivityMs,
    lastActivityDisplay,
  }
}

/**
 * 학생 목록 행에 상세 요약과 동일한 집계를 붙입니다 (student_history + computeAdminStudentSummary).
 * @param {object[]} rosterRows
 * @param {string} classCode
 */
export async function enrichAdminRosterWithSummaries(rosterRows, classCode) {
  const rows = Array.isArray(rosterRows) ? rosterRows : []
  const cc = String(classCode ?? '').trim()
  if (!rows.length || !cc) return rows

  return Promise.all(
    rows.map(async (row) => {
      const nick = String(row?.nickname ?? row?.닉네임 ?? '').trim()
      if (!nick) return row
      try {
        const hist = await fetchAdminStudentLearningHistory(nick, cc)
        if (!hist.ok) return row
        const summary = computeAdminStudentSummary({
          records: hist.records,
          rosterRow: row,
          completedProblems: hist.completedProblems,
        })
        return {
          ...row,
          mainSuccessCount: summary.mainSuccessCount,
          mainFailCount: summary.mainFailCount,
          similarSuccessCount: summary.similarSuccessCount,
          similarFailCount: summary.similarFailCount,
          mathCardCount: summary.mathCardCount,
          lastActivity:
            summary.lastActivityDisplay !== '—' ? summary.lastActivityDisplay : row.lastActivity,
        }
      } catch {
        return row
      }
    }),
  )
}
