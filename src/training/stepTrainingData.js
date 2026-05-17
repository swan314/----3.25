import Papa from 'papaparse'

export const DEFAULT_STEP_TRAINING_CSV_PATH = '/data/step_training.csv'

export const STEP_TRAINING_TYPES = ['explanation', 'example', 'practice']

function normalizeStepTrainingRow(row) {
  return {
    training_key: String(row?.training_key ?? '').trim(),
    type: String(row?.type ?? '').trim().toLowerCase(),
    content: String(row?.content ?? '').trim(),
    answer: String(row?.answer ?? '').trim(),
  }
}

function emptyBucket() {
  return {
    explanation: [],
    example: [],
    practice: [],
  }
}

/**
 * @param {Array<{ training_key: string, type: string, content: string, answer: string }>} rows
 * @returns {Record<string, { explanation: object[], example: object[], practice: object[] }>}
 */
export function groupStepTrainingRowsByKey(rows) {
  const grouped = {}
  for (const raw of rows || []) {
    const row = normalizeStepTrainingRow(raw)
    const key = row.training_key
    if (!key) continue
    if (!grouped[key]) grouped[key] = emptyBucket()
    const type = row.type
    if (!STEP_TRAINING_TYPES.includes(type)) {
      console.warn('[step-training] unknown type, skipped:', { key, type: row.type })
      continue
    }
    grouped[key][type].push(row)
  }
  return grouped
}

/** @type {Record<string, { explanation: object[], example: object[], practice: object[] }>} */
let stepTrainingByKeyCache = {}
let stepTrainingLoaded = false

export async function loadStepTrainingCsvRows(
  csvPath = DEFAULT_STEP_TRAINING_CSV_PATH,
) {
  const res = await fetch(csvPath)
  if (!res.ok) {
    throw new Error(`step_training CSV 로드 실패 (${res.status}): ${csvPath}`)
  }
  const text = await res.text()
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors?.length) {
    throw new Error(parsed.errors[0]?.message || 'step_training CSV 파싱 오류')
  }
  return (parsed.data || []).map(normalizeStepTrainingRow).filter((r) => r.training_key)
}

/**
 * 앱 시작 시 호출 — training_key별 explanation / example / practice 묶음 + console.log
 */
export async function loadStepTrainingDataByKey(
  csvPath = DEFAULT_STEP_TRAINING_CSV_PATH,
) {
  const rows = await loadStepTrainingCsvRows(csvPath)
  stepTrainingByKeyCache = groupStepTrainingRowsByKey(rows)
  stepTrainingLoaded = true

  const keys = Object.keys(stepTrainingByKeyCache).sort()
  console.log('[step-training] loaded file:', csvPath.replace(/^\//, 'public/'))
  console.log('[step-training] training_keys:', keys)
  console.log('[step-training] by training_key:', stepTrainingByKeyCache)

  return stepTrainingByKeyCache
}

export function isStepTrainingDataLoaded() {
  return stepTrainingLoaded
}

/** @returns {Record<string, { explanation: object[], example: object[], practice: object[] }>} */
export function getStepTrainingDataByKey() {
  return stepTrainingByKeyCache
}

/**
 * @param {string} trainingKey
 * @returns {{ explanation: object[], example: object[], practice: object[] } | null}
 */
export function getStepTrainingBucketByKey(trainingKey) {
  const key = String(trainingKey ?? '').trim()
  if (!key) return null
  return stepTrainingByKeyCache[key] ?? null
}
