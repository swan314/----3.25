import {
  TRAINING_SHEET_STEP_KEYS,
  TRAINING_STAGE_COUNT,
} from './trainingStageConfig'

function resultMapFromCompleted(completedSteps) {
  const map = {}
  for (const item of completedSteps || []) {
    const idx = Number(item.stepNumber) - 1
    if (!Number.isFinite(idx) || idx < 0 || idx >= TRAINING_STAGE_COUNT) continue
    map[idx] = Number(item.processResult) > 0 ? 1 : 0
  }
  return map
}

function cellValueForStage(resultByIndex, stageIndex, activeSet) {
  if (!activeSet.has(stageIndex)) return ''
  if (resultByIndex[stageIndex] === undefined) return ''
  return resultByIndex[stageIndex]
}

/**
 * 단계별 고정 슬롯(step5_1·5_2·5_3 분리) + activeSteps 기준 total/fail_count.
 * @returns {{
 *   stepResults: Record<string, number|''>,
 *   step1: number|'',
 *   step2: number|'',
 *   step3: number|'',
 *   step4: number|'',
 *   step5_1: number|'',
 *   step5_2: number|'',
 *   step5_3: number|'',
 *   step6: number|'',
 *   scores: Array<number|'',
 *   failCount: number,
 *   successCount: number,
 *   activeStepCount: number,
 * }}
 */
export function buildActiveStepSheetPayload(completedSteps, activeStageIndices) {
  const indices = Array.isArray(activeStageIndices) ? activeStageIndices : []
  const activeSet = new Set(indices)
  const resultByIndex = resultMapFromCompleted(completedSteps)

  const stepResults = {}
  for (let stageIndex = 0; stageIndex < TRAINING_STAGE_COUNT; stageIndex += 1) {
    const key = TRAINING_SHEET_STEP_KEYS[stageIndex]
    stepResults[key] = cellValueForStage(resultByIndex, stageIndex, activeSet)
  }

  const activeScores = indices.map((idx) => resultByIndex[idx] ?? 0)
  const failCount = activeScores.filter((v) => Number(v) === 0).length
  const successCount = activeScores.filter((v) => Number(v) > 0).length

  return {
    stepResults,
    ...stepResults,
    scores: TRAINING_SHEET_STEP_KEYS.map((key) => stepResults[key]),
    failCount,
    successCount,
    activeStepCount: indices.length,
  }
}

export function buildLegacySheetStepsFromCompleted(completedSteps, activeStageIndices = null) {
  return buildActiveStepSheetPayload(completedSteps, activeStageIndices)
}

export function countFailCountFromCompletedSteps(completedSteps, activeStageIndices = null) {
  return buildActiveStepSheetPayload(completedSteps, activeStageIndices).failCount
}

export function extractScoresFromRecord(record) {
  if (!record || typeof record !== 'object') return []
  if (Array.isArray(record.scores) && record.scores.length >= TRAINING_STAGE_COUNT) {
    return record.scores.slice(0, TRAINING_STAGE_COUNT)
  }
  return TRAINING_SHEET_STEP_KEYS.map((key) => {
    if (record[key] === 0) return 0
    if (record[key] === '' || record[key] == null) return ''
    const n = Number(record[key])
    return Number.isFinite(n) ? n : ''
  })
}

/** 활성(0/1 기록된) 단계만 — skip·미진행은 제외 */
export function listActiveStepKeysFromRecord(record) {
  const scores = extractScoresFromRecord(record)
  return TRAINING_SHEET_STEP_KEYS.filter((key, i) => {
    const v = scores[i]
    return v === 0 || v === 1 || v === '0' || v === '1'
  })
}

export function countPackedScoresLength(scores) {
  const fromRecord = listActiveStepKeysFromRecord({ scores })
  if (fromRecord.length) return fromRecord.length
  const arr = Array.isArray(scores) ? scores : []
  let n = 0
  for (let i = 0; i < TRAINING_STAGE_COUNT && i < arr.length; i += 1) {
    const v = arr[i]
    if (v === '' || v === null || v === undefined) continue
    if (v === 0 || v === 1 || v === '0' || v === '1') n += 1
  }
  return n
}

export function countFailCountFromPackedScores(scores) {
  const arr = extractScoresFromRecord({ scores })
  let fail = 0
  for (let i = 0; i < TRAINING_STAGE_COUNT && i < arr.length; i += 1) {
    const v = arr[i]
    if (v === '' || v === null || v === undefined) continue
    if (Number(v) === 0) fail += 1
  }
  return fail
}

export function countSuccessFromPackedScores(scores) {
  const arr = extractScoresFromRecord({ scores })
  let ok = 0
  for (let i = 0; i < TRAINING_STAGE_COUNT && i < arr.length; i += 1) {
    const v = arr[i]
    if (v === '' || v === null || v === undefined) continue
    if (Number(v) > 0) ok += 1
  }
  return ok
}
