import { normalizeTrainingKind } from './trainingRowSelect'

function failCountFromRecord(record) {
  if (record == null) return null
  const raw = record.fail_count ?? record.failCount
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export const SHEET_STATUS = {
  DIAGNOSTIC: '진단완료',
  SUCCESS: '성공',
  FAIL: '실패',
}

const LEGACY_TRAINING_DONE = new Set([
  'training_completed',
  '수련완료',
  'completed',
])

/** 시트·API status 문자열 → 표준값(진단완료|성공|실패) */
export function normalizeSheetStatus(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  if (text === 'diagnostic_completed' || text === SHEET_STATUS.DIAGNOSTIC) {
    return SHEET_STATUS.DIAGNOSTIC
  }
  if (LEGACY_TRAINING_DONE.has(text)) return 'legacy_training_completed'
  if (text === SHEET_STATUS.SUCCESS || text.toLowerCase() === 'success') {
    return SHEET_STATUS.SUCCESS
  }
  if (text === SHEET_STATUS.FAIL || text.toLowerCase() === 'fail') {
    return SHEET_STATUS.FAIL
  }
  return text
}

export function isDiagnosticSheetStatus(status) {
  return normalizeSheetStatus(status) === SHEET_STATUS.DIAGNOSTIC
}

export function isTrainingSuccessStatus(status) {
  return normalizeSheetStatus(status) === SHEET_STATUS.SUCCESS
}

export function isTrainingFailStatus(status) {
  return normalizeSheetStatus(status) === SHEET_STATUS.FAIL
}

/** 수련 시도 행(성공·실패·레거시 수련완료) */
export function isTrainingAttemptSheetStatus(status) {
  const norm = normalizeSheetStatus(status)
  return (
    norm === SHEET_STATUS.SUCCESS ||
    norm === SHEET_STATUS.FAIL ||
    norm === 'legacy_training_completed'
  )
}

function finiteNumber(raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** 저장 시 본문제·유사문제1 규칙에 따른 status */
export function resolveTrainingSaveStatus(trainingType, failCount) {
  const kind = normalizeTrainingKind(trainingType) || '본문제'
  if (kind === '유사문제1') return SHEET_STATUS.SUCCESS
  return finiteNumber(failCount) >= 2 ? SHEET_STATUS.FAIL : SHEET_STATUS.SUCCESS
}

/** 레거시 training_completed 행 → 성공/실패 추정 */
export function resolveStatusFromLegacyTrainingRecord(record) {
  const kind = normalizeTrainingKind(record?.type ?? record?.trainingType ?? record?.유형)
  if (kind === '유사문제1') return SHEET_STATUS.SUCCESS
  const fc = failCountFromRecord(record)
  if (fc == null) return SHEET_STATUS.SUCCESS
  return fc >= 2 ? SHEET_STATUS.FAIL : SHEET_STATUS.SUCCESS
}

/** 시트 행 하나의 표준 status */
export function resolveRecordSheetStatus(record) {
  const raw =
    record?.status ??
    record?.상태 ??
    record?.P ??
    record?.p ??
    record?.['P열'] ??
    record?.['status(P)'] ??
    ''
  const norm = normalizeSheetStatus(raw)
  if (norm === 'legacy_training_completed') {
    return resolveStatusFromLegacyTrainingRecord(record)
  }
  return norm
}

/** API·시트 응답용 문항 코드 배열 정규화 */
export function normalizeProblemCodeList(list) {
  const out = []
  const seen = new Set()
  if (!Array.isArray(list)) return out
  for (const raw of list) {
    const code = String(raw || '').trim().toUpperCase()
    if (!/^\d+-[A-Z]$/.test(code) || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

/** 전체 수련 기록에서 status === 성공 인 problem 코드(중복 제거) */
export function collectSuccessProblemCodesFromRecords(records) {
  const codes = new Set()
  if (!Array.isArray(records)) return codes
  for (const r of records) {
    const prob = String(r?.problem ?? r?.문항번호 ?? '')
      .trim()
      .toUpperCase()
    if (!/^\d+-[A-Z]$/.test(prob)) continue
    if (resolveRecordSheetStatus(r) === SHEET_STATUS.SUCCESS) {
      codes.add(prob)
    }
  }
  return codes
}

/** 성공 이력이 없고 status === 실패 인 problem 코드(중복 제거) */
export function collectFailedProblemCodesFromRecords(records) {
  const success = collectSuccessProblemCodesFromRecords(records)
  const failed = new Set()
  if (!Array.isArray(records)) return []
  for (const r of records) {
    const prob = String(r?.problem ?? r?.문항번호 ?? '')
      .trim()
      .toUpperCase()
    if (!/^\d+-[A-Z]$/.test(prob)) continue
    if (resolveRecordSheetStatus(r) === SHEET_STATUS.FAIL && !success.has(prob)) {
      failed.add(prob)
    }
  }
  return [...failed]
}

export function isProblemProgressSuccess(entry) {
  if (!entry) return false
  if (entry.sheetOutcome === 'completed') return true
  return entry.status === SHEET_STATUS.SUCCESS
}
