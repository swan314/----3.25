import { nextProblemLogic } from './nextProblemLogic'
import { normalizeTrainingKind } from './trainingRowSelect'

/** 구글 시트 등에서 받은 레코드가 「수련완료」만 인정할 때 통과 여부 */
export function isTrainingCompletedSheetRecord(record) {
  if (!record || typeof record !== 'object') return false
  const raw =
    record.status ??
    record.__status ??
    record?.상태 ??
    ''
  const normalized = String(raw || '').trim()
  if (!normalized) return false
  if (normalized === 'training_completed') return true
  if (normalized === '수련완료') return true
  if (normalized === 'completed') return true
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
  const total = Number.isFinite(Number(record?.total)) ? Number(record.total) : 0

  const { nextType, nextProblem } = nextProblemLogic(kind, total, problem, {
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
