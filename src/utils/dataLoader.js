import Papa from 'papaparse'

const DEFAULT_TRAINING_CSV_PATH = '/data/training_problems_with_similar_v2.csv'
const DEFAULT_LEVEL_KEY = '단계'

function normalizeRow(row) {
  const next = {}
  for (const [key, value] of Object.entries(row || {})) {
    const cleanKey = (key || '').toString().trim()
    if (!cleanKey) continue
    next[cleanKey] = typeof value === 'string' ? value.trim() : value
  }
  return next
}

export async function loadTrainingCsvRows(csvPath = DEFAULT_TRAINING_CSV_PATH) {
  const res = await fetch(csvPath)
  if (!res.ok) throw new Error(`CSV 로드 실패 (${res.status})`)
  const text = await res.text()
  const fileName = csvPath.split(/[/\\]/).pop() || csvPath
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors?.length) {
    throw new Error(parsed.errors[0]?.message || 'CSV 파싱 중 오류가 발생했습니다.')
  }
  if (/training_problems/i.test(fileName)) {
    console.log('[training-csv] loaded file:', fileName)
    console.log('[training-csv] headers:', parsed.meta?.fields ?? [])
  }
  return (parsed.data || []).map(normalizeRow)
}

export function groupTrainingRowsByLevel(rows, levelKey = DEFAULT_LEVEL_KEY) {
  const grouped = {}
  for (const row of rows || []) {
    const level = (row?.[levelKey] || '').toString().trim()
    if (!level) continue
    if (!grouped[level]) grouped[level] = []
    grouped[level].push(row)
  }
  return grouped
}

export async function loadGroupedTrainingData(csvPath = DEFAULT_TRAINING_CSV_PATH, levelKey = DEFAULT_LEVEL_KEY) {
  const rows = await loadTrainingCsvRows(csvPath)
  return groupTrainingRowsByLevel(rows, levelKey)
}
