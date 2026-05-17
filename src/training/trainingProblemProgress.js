import { normalizeTrainingKind } from './trainingRowSelect'
import {
  countFailCountFromPackedScores,
  countPackedScoresLength,
  extractScoresFromRecord,
} from './trainingSheetSteps'
import {
  SHEET_STATUS,
  collectSuccessProblemCodesFromRecords,
  isProblemProgressSuccess,
  normalizeProblemCodeList,
  resolveRecordSheetStatus,
  resolveTrainingSaveStatus,
} from './trainingStatus'

/** 본문제 fail_count >= 2 → 유사문제1 유도 */
const MAIN_FAIL_THRESHOLD = 2

function finiteNumber(raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** 시트 행에서 fail_count 우선, 없으면 패킹된 step에서 0 개수 */
export function resolveFailCountFromRecord(record) {
  if (record == null) return null
  if (record.fail_count != null && record.fail_count !== '') {
    return finiteNumber(record.fail_count)
  }
  if (record.failCount != null && record.failCount !== '') {
    return finiteNumber(record.failCount)
  }
  const scores = extractScoresFromRecord(record)
  const packedFail = countFailCountFromPackedScores(scores)
  if (countPackedScoresLength(scores) > 0) {
    return packedFail
  }
  const total = record.total
  if (total != null && total !== '' && Number.isFinite(Number(total))) {
    const success = finiteNumber(total)
    return Math.max(0, 6 - success)
  }
  return null
}

function buildProgressEntryFromLatestByType(latestByType, problemSucceeded) {
  const main = latestByType['본문제']
  const s1 = latestByType['유사문제1']
  let nextKind = '본문제'

  if (problemSucceeded) {
    nextKind = '본문제'
  } else if (main?.status === SHEET_STATUS.FAIL && !s1) {
    nextKind = '유사문제1'
  } else if (main?.status === SHEET_STATUS.FAIL && s1) {
    nextKind = '본문제'
  }

  const status = problemSucceeded
    ? SHEET_STATUS.SUCCESS
    : main?.status === SHEET_STATUS.FAIL
      ? SHEET_STATUS.FAIL
      : 'not_started'

  return {
    status,
    nextKind,
    latestByType,
    isComplete: problemSucceeded,
  }
}

export function deriveProblemCardState(latestByType = {}, problemSucceeded = false) {
  const entry = buildProgressEntryFromLatestByType(latestByType, problemSucceeded)
  return {
    isComplete: entry.isComplete,
    nextKind: entry.nextKind,
  }
}

/**
 * @returns {'none' | 'retry_similar1'}
 */
function problemCodeSetFromList(list) {
  if (list instanceof Set) return list
  return new Set(normalizeProblemCodeList(list))
}

/** 시트 failedProblems 목록 우선 — latestTrainingRecord 단일 행에 의존하지 않음 */
export function resolveCardChallengeHintPhase(progressEntry, problemCode, failedProblemCodes) {
  const code = String(problemCode || '').trim().toUpperCase()
  if (code && problemCodeSetFromList(failedProblemCodes).has(code)) {
    return 'retry_similar1'
  }
  return getCardChallengeHintPhase(progressEntry)
}

/** 시트 completedProblems 목록 우선 */
export function isProblemCardComplete(progressEntry, problemCode, completedProblemCodes) {
  const code = String(problemCode || '').trim().toUpperCase()
  if (code && problemCodeSetFromList(completedProblemCodes).has(code)) {
    return true
  }
  return isProblemProgressSuccess(progressEntry)
}

export function getCardChallengeHintPhase(progressEntry) {
  if (!progressEntry) return 'none'
  if (isProblemProgressSuccess(progressEntry)) return 'none'
  if (progressEntry.sheetOutcome === 'failed') return 'retry_similar1'
  const nextKind = normalizeTrainingKind(progressEntry.nextKind) || '본문제'
  const latestByType = progressEntry.latestByType || {}
  const main = latestByType['본문제']
  const s1 = latestByType['유사문제1']
  if (!main) return 'none'
  if (
    main.status === SHEET_STATUS.FAIL &&
    nextKind === '유사문제1' &&
    !s1
  ) {
    return 'retry_similar1'
  }
  return 'none'
}

/**
 * Sheet2 전체 수련 기록 → 문항별 progress (성공 문항은 누적).
 */
export function computeTrainingProblemProgressByCode(trainingRecords) {
  if (!Array.isArray(trainingRecords) || !trainingRecords.length) return {}

  const successProblems = collectSuccessProblemCodesFromRecords(trainingRecords)
  const buckets = {}

  for (const r of trainingRecords) {
    const rowStatus = resolveRecordSheetStatus(r)
    if (rowStatus !== SHEET_STATUS.SUCCESS && rowStatus !== SHEET_STATUS.FAIL) {
      continue
    }
    const prob = String(r.problem ?? r.문항번호 ?? '').trim().toUpperCase()
    if (!/^\d+-[A-Z]$/.test(prob)) continue
    const kindRaw = r.type ?? r.trainingType ?? r.유형
    let kind = normalizeTrainingKind(kindRaw)
    if (kind !== '본문제' && kind !== '유사문제1') {
      kind = '본문제'
    }

    const ts = Number(r.__timestamp || 0)
    const failCount = resolveFailCountFromRecord(r)
    const sheetRow = Number(r.sheetRow)
    const rowOrder = Number.isFinite(sheetRow) ? sheetRow : -1
    const status =
      rowStatus === SHEET_STATUS.SUCCESS || rowStatus === SHEET_STATUS.FAIL
        ? rowStatus
        : resolveTrainingSaveStatus(kind, failCount)

    if (!buckets[prob]) buckets[prob] = {}
    const prev = buckets[prob][kind]
    const prevTs = prev ? Number(prev.ts || 0) : -1
    const prevRow = prev && Number.isFinite(Number(prev.sheetRow)) ? Number(prev.sheetRow) : -1
    if (!prev || ts > prevTs || (ts === prevTs && rowOrder >= prevRow)) {
      buckets[prob][kind] = {
        fail_count: failCount != null ? failCount : 0,
        status,
        ts,
        sheetRow: rowOrder,
      }
    }
  }

  const out = {}
  const allProbs = new Set([...Object.keys(buckets), ...successProblems])
  for (const prob of allProbs) {
    const latestByType = buckets[prob] || {}
    const problemSucceeded = successProblems.has(prob)
    out[prob] = buildProgressEntryFromLatestByType(latestByType, problemSucceeded)
  }
  return out
}

/**
 * 시트·API에서 누적한 completedProblems / failedProblems 로 카드 상태 덮어쓰기.
 */
export function applySheetProblemOutcomeLists(
  progressMap,
  completedProblems,
  failedProblems,
) {
  const completedSet = new Set(normalizeProblemCodeList(completedProblems))
  const failedSet = new Set(normalizeProblemCodeList(failedProblems))
  const out = { ...(progressMap || {}) }

  for (const code of completedSet) {
    const prev = out[code]
    const latestByType = prev?.latestByType || {}
    out[code] = {
      ...buildProgressEntryFromLatestByType(
        {
          ...latestByType,
          본문제: latestByType['본문제'] || {
            status: SHEET_STATUS.SUCCESS,
            fail_count: 0,
            ts: 0,
          },
        },
        true,
      ),
      sheetOutcome: 'completed',
    }
  }

  for (const code of failedSet) {
    if (completedSet.has(code)) continue
    const prev = out[code]
    const prevMain = prev?.latestByType?.['본문제']
    out[code] = {
      ...buildProgressEntryFromLatestByType(
        {
          ...(prev?.latestByType || {}),
          본문제: {
            status: SHEET_STATUS.FAIL,
            fail_count: prevMain?.fail_count != null ? prevMain.fail_count : MAIN_FAIL_THRESHOLD,
            ts: prevMain?.ts ?? 0,
            sheetRow: prevMain?.sheetRow,
          },
        },
        false,
      ),
      sheetOutcome: 'failed',
    }
  }

  return out
}

export function computeTrainingProgressMapByProblem(trainingProblemProgressByCode) {
  const src = trainingProblemProgressByCode || {}
  return Object.fromEntries(
    Object.entries(src).map(([code, v]) => [
      code,
      { status: v?.status || 'not_started' },
    ]),
  )
}

export function countCompletedProblemsForMathCards(trainingProblemProgressByCode) {
  if (!trainingProblemProgressByCode || typeof trainingProblemProgressByCode !== 'object') return 0
  return Object.values(trainingProblemProgressByCode).filter((v) =>
    isProblemProgressSuccess(v),
  ).length
}

function mergeLatestByTypeForProblem(prevEntry, remoteEntry) {
  const merged = { ...(prevEntry?.latestByType || {}) }
  for (const [kind, rec] of Object.entries(remoteEntry?.latestByType || {})) {
    const prevRec = merged[kind]
    const prevTs = prevRec ? Number(prevRec.ts || 0) : -1
    const nextTs = Number(rec?.ts || 0)
    const prevRow = prevRec && Number.isFinite(Number(prevRec.sheetRow)) ? Number(prevRec.sheetRow) : -1
    const nextRow = Number.isFinite(Number(rec?.sheetRow)) ? Number(rec.sheetRow) : -1
    if (!prevRec || nextTs > prevTs || (nextTs === prevTs && nextRow >= prevRow)) {
      merged[kind] = rec
    }
  }
  const completed =
    prevEntry?.sheetOutcome === 'completed' ||
    remoteEntry?.sheetOutcome === 'completed' ||
    isProblemProgressSuccess(prevEntry) ||
    isProblemProgressSuccess(remoteEntry) ||
    Object.values(merged).some((rec) => rec?.status === SHEET_STATUS.SUCCESS)
  const entry = buildProgressEntryFromLatestByType(merged, completed)
  if (completed) {
    return { ...entry, sheetOutcome: 'completed' }
  }
  const failed =
    prevEntry?.sheetOutcome === 'failed' || remoteEntry?.sheetOutcome === 'failed'
  if (failed) {
    return { ...entry, sheetOutcome: 'failed' }
  }
  return entry
}

export function mergeTrainingProblemProgressMaps(...maps) {
  const out = {}
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue
    for (const [rawCode, remoteEntry] of Object.entries(map)) {
      const code = String(rawCode || '').trim().toUpperCase()
      if (!/^\d+-[A-Z]$/.test(code)) continue
      const prevEntry = out[code]
      out[code] = prevEntry
        ? mergeLatestByTypeForProblem(prevEntry, remoteEntry)
        : mergeLatestByTypeForProblem({ latestByType: {} }, remoteEntry)
    }
  }
  return out
}

/** 키워드 카드·보관함: status === 성공 문항 코드 */
export function collectCompletedProblemCodes(trainingProblemProgressByCode) {
  const codes = []
  for (const [rawCode, meta] of Object.entries(trainingProblemProgressByCode || {})) {
    const code = String(rawCode || '').trim().toUpperCase()
    if (!/^\d+-[A-Z]$/.test(code)) continue
    if (isProblemProgressSuccess(meta)) codes.push(code)
  }
  return codes
}

export { collectSuccessProblemCodesFromRecords, isProblemProgressSuccess, SHEET_STATUS }

export function mergeTrainingProgressAfterSave(prevMap, problemCode, trainingType, failCount) {
  const prob = String(problemCode || '').trim().toUpperCase()
  const kind = normalizeTrainingKind(trainingType) || '본문제'
  const rowStatus = resolveTrainingSaveStatus(trainingType, failCount)
  const prevEntry = prevMap?.[prob] || { latestByType: {} }
  const latestByType = {
    ...prevEntry.latestByType,
    [kind]: {
      fail_count: finiteNumber(failCount),
      status: rowStatus,
      ts: Date.now(),
    },
  }
  const hadSuccess = isProblemProgressSuccess(prevEntry)
  const problemSucceeded = hadSuccess || rowStatus === SHEET_STATUS.SUCCESS
  return mergeTrainingProblemProgressMaps(prevMap, {
    [prob]: buildProgressEntryFromLatestByType(latestByType, problemSucceeded),
  })
}
