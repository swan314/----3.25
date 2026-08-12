import { getTrainingStageHintOrder } from './trainingStageConfig'
import { normalizeTrainingKind } from './trainingRowSelect'

/** 힌트 CSV 본문이 버튼·표시 대상인지 (비어 있거나 skip 제외) */
export function isUsableTrainingHintBody(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return false
  return text.toLowerCase() !== 'skip'
}

export function findTrainingHintForStep(row, stepIdx, hintsData) {
  if (!row || !Array.isArray(hintsData)) return null
  const stage = String(row.__poolStage ?? row['단계'] ?? '').trim()
  const type = String(row['유형'] ?? '').trim().toUpperCase()
  const trainingType = normalizeTrainingKind(row?.type) || '본문제'
  const stepOrder = getTrainingStageHintOrder(stepIdx)
  return (
    hintsData.find(
      (h) =>
        h.단계 === stage &&
        h.유형 === type &&
        h.type === trainingType &&
        h.단계_순서 === stepOrder
    ) ?? null
  )
}

export function isTrainingHintAvailableForStep(row, stepIdx, hintsData) {
  // 5단계(index 4): 일반 힌트 CSV 미사용 (추후 스캐폴딩 연결 예정)
  if (stepIdx === 4) return false
  const matched = findTrainingHintForStep(row, stepIdx, hintsData)
  return isUsableTrainingHintBody(matched?.힌트내용)
}
