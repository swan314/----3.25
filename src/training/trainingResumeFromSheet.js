import {
  resolveCanonicalDiagnosticTier,
  TIER_TERMINAL_TRAINING_PROBLEM_CODE,
} from '../levelConfig'
import { nextProblemLogic } from './nextProblemLogic'
import { resolveFailCountFromRecord } from './trainingProblemProgress'
import { normalizeTrainingKind } from './trainingRowSelect'
import { resolveRecordSheetStatus, SHEET_STATUS } from './trainingStatus'

/** 수련 시도 행(성공·실패·레거시 수련완료) */
export function isTrainingCompletedSheetRecord(record) {
  if (!record || typeof record !== 'object') return false
  const st = resolveRecordSheetStatus(record)
  return st === SHEET_STATUS.SUCCESS || st === SHEET_STATUS.FAIL
}

/**
 * 해당 티어 수련을 끝까지 마친 상태인지(마지막 문항 완료 저장 행).
 * 재입장 시 `resolveNextTrainingRowIndex === -1` 과 동일 조건을 시트 필드만으로 판별.
 */
export function isLatestRecordAtTierCurriculumEnd(record, tierKeyRaw) {
  if (!record || typeof record !== 'object') return false
  const tier = resolveCanonicalDiagnosticTier(tierKeyRaw)
  const terminal = TIER_TERMINAL_TRAINING_PROBLEM_CODE[tier]
  if (!terminal) return false
  const problem = String(record.problem ?? record.문항번호 ?? '').trim().toUpperCase()
  if (problem !== terminal) return false
  const st = resolveRecordSheetStatus(record)
  if (st !== SHEET_STATUS.SUCCESS) return false
  const kind = normalizeTrainingKind(record.type ?? record.trainingType ?? record.유형)
  if (kind === '유사문제1') return true
  if (kind === '본문제') {
    const fc = resolveFailCountFromRecord(record)
    return fc != null && fc < 2
  }
  return false
}

/**
 * 마지막으로 시트에 「수련완료」로 저장된 한 건을 기준으로,
 * 그 직후에 풀어야 할 문제(학습 진행 규칙 동일)의 trainingPlan 재개 필드를 계산합니다.
 *
 * 반드시 isTrainingCompletedSheetRecord(record) === true 일 때만 호출하세요.
 */
export function computeResumeTargetAfterSheetCompletion(record) {
  const problem = String(record?.problem ?? record?.문항번호 ?? '').trim().toUpperCase()
  let kind = normalizeTrainingKind(record?.type ?? record?.trainingType)
  if (!kind) kind = '본문제'
  const failCount = resolveFailCountFromRecord(record) ?? 0

  const { nextType, nextProblem } = nextProblemLogic(kind, failCount, problem, {
    useSimilarProblems: true,
  })

  const normalizedNext = String(nextProblem || '').trim().toUpperCase()
  const m = normalizedNext.match(/^(\d+)-([A-Z])$/)

  const resumeStage = m ? Number(m[1]) : 1
  const resumeProblemNumber = m ? Math.max(m[2].charCodeAt(0) - 'A'.charCodeAt(0) + 1, 1) : 1

  return {
    resumeProblemCode: normalizedNext,
    resumeStage,
    resumeProblemNumber,
    resumeType: nextType,
  }
}
