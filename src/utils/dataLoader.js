import Papa from 'papaparse'

const DEFAULT_TRAINING_CSV_PATH = '/data/training_problems_with_similar_v2.csv'
const DEFAULT_MATH_CARDS_CSV_PATH = '/data/math_cards.csv'
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

function attachKeywordFromLastColumn(row, fields, rawRow) {
  const next = { ...(row || {}) }
  const keywordKey = Object.keys(next).find((k) => String(k || '').trim().toLowerCase() === 'keyword')
  if (keywordKey) {
    next.keyword = String(next[keywordKey] ?? '').trim()
    return next
  }
  const extra = rawRow?.__parsed_extra
  if (Array.isArray(extra) && extra.length) {
    const lastExtra = extra[extra.length - 1]
    next.keyword = String(lastExtra ?? '').trim()
    return next
  }
  const orderedFields = Array.isArray(fields) ? fields : []
  const lastFieldRaw = orderedFields.length ? orderedFields[orderedFields.length - 1] : ''
  const lastField = String(lastFieldRaw || '').trim()
  if (!lastField) {
    if (!Object.prototype.hasOwnProperty.call(next, 'keyword')) next.keyword = ''
    return next
  }
  const keywordValue = next[lastField]
  next.keyword = String(keywordValue ?? '').trim()
  return next
}

function buildProblemRowKey(row) {
  const stage = String(row?.['단계'] ?? '').trim()
  const letter = String(row?.['유형'] ?? '').trim().toUpperCase()
  const kind = String(row?.type ?? '').trim()
  if (!stage || !letter || !kind) return ''
  return `${stage}|${letter}|${kind}`
}

function buildKeywordLookupFromParsed(parsed) {
  const fields = parsed?.meta?.fields ?? []
  const rawRows = parsed?.data || []
  const normalizedRows = rawRows.map(normalizeRow)
  const lookup = new Map()
  normalizedRows.forEach((row, idx) => {
    const withKeyword = attachKeywordFromLastColumn(row, fields, rawRows[idx])
    const key = buildProblemRowKey(withKeyword)
    const keyword = String(withKeyword?.keyword ?? '').trim()
    if (key && keyword) lookup.set(key, keyword)
  })
  return lookup
}

async function tryLoadKeywordLookupFromDist(fileName) {
  try {
    const distPath = `/dist/data/${fileName}`
    const res = await fetch(distPath)
    if (!res.ok) return new Map()
    const text = await res.text()
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
    })
    if (parsed.errors?.length) return new Map()
    return buildKeywordLookupFromParsed(parsed)
  } catch {
    return new Map()
  }
}

function normalizeMathCardProblemKey(rawProblem) {
  const text = String(rawProblem ?? '').trim().toUpperCase()
  // 예: "1-a" → "1-A"
  const m = text.match(/^(\d+)-([A-Z])$/)
  if (!m) return text
  return `${m[1]}-${m[2]}`
}

function normalizeMathCardImagePath(rawImage) {
  const text = String(rawImage ?? '').trim().replace(/^\/+/, '')
  if (!text) return ''
  // 요청사항: `${image}`를 그대로 두고 앞에 `/`만 붙여서 사용
  return `/${text}`
}

function normalizeMathCardRow(row) {
  const code = String(row?.code ?? '').trim()
  const problem = normalizeMathCardProblemKey(row?.problem)
  const term = String(row?.term ?? '').trim()
  const name = String(row?.name ?? '').trim()
  const description = String(row?.description ?? '').trim()
  const rarityNum = Number(row?.rarity)
  const rarity = Number.isFinite(rarityNum) ? rarityNum : String(row?.rarity ?? '').trim()
  const image = normalizeMathCardImagePath(row?.image)

  return { code, problem, term, name, description, rarity, image }
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
  const rawRows = parsed.data || []
  const normalizedRows = rawRows.map(normalizeRow)
  if (/training_problems/i.test(fileName)) {
    const fields = parsed.meta?.fields ?? []
    let rowsWithKeyword = normalizedRows.map((row, idx) =>
      attachKeywordFromLastColumn(row, fields, rawRows[idx])
    )
    const hasAnyKeyword = rowsWithKeyword.some((row) => String(row?.keyword ?? '').trim())
    if (!hasAnyKeyword) {
      const distKeywordLookup = await tryLoadKeywordLookupFromDist(fileName)
      if (distKeywordLookup.size) {
        rowsWithKeyword = rowsWithKeyword.map((row) => {
          const key = buildProblemRowKey(row)
          const keyword = key ? distKeywordLookup.get(key) : ''
          if (!keyword) return row
          return { ...row, keyword: String(keyword).trim() }
        })
      }
    }
    return rowsWithKeyword
  }
  return normalizedRows
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

/** CSV `단계`+`유형` → 문제 코드 (예: 1-A). 관리자 문제 드롭다운용. */
export async function loadTrainingProblemCodesFromCsv(csvPath = DEFAULT_TRAINING_CSV_PATH) {
  const rows = await loadTrainingCsvRows(csvPath)
  const ids = new Set()
  for (const row of rows || []) {
    const stage = String(row?.단계 ?? '').trim()
    const letter = String(row?.유형 ?? '').trim()
    if (stage && letter) ids.add(`${stage}-${letter}`)
  }
  return [...ids].sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true }))
}

// ---------------------------
// math_cards.csv 전용 로더/조회
// ---------------------------
/** @type {Array<{code:string, problem:string, term:string, name:string, description:string, rarity:number|string, image:string}>} */
let mathCardsCache = []
/** @type {Map<string, typeof mathCardsCache>} */
let mathCardsByProblemIndex = new Map()
let mathCardsLoaded = false

function rebuildMathCardsIndex(cards) {
  const nextIndex = new Map()
  for (const c of cards || []) {
    const key = normalizeMathCardProblemKey(c?.problem)
    if (!key) continue
    if (!nextIndex.has(key)) nextIndex.set(key, [])
    nextIndex.get(key).push(c)
  }
  mathCardsByProblemIndex = nextIndex
}

/**
 * `public/data/math_cards.csv` 로드 후 카드 데이터를 배열로 캐싱합니다.
 *
 * 이미지 경로 규칙:
 * - CSV `image` 예: `card/equal.png`
 * - 사용 경로: `/card/equal.png`
 */
export async function loadMathCardsCsvRows(csvPath = DEFAULT_MATH_CARDS_CSV_PATH) {
  const res = await fetch(csvPath)
  if (!res.ok) throw new Error(`math_cards CSV 로드 실패 (${res.status})`)

  const text = await res.text()
  const fileName = csvPath.split(/[/\\]/).pop() || csvPath

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
  })

  if (parsed.errors?.length) {
    throw new Error(parsed.errors[0]?.message || 'math_cards CSV 파싱 중 오류가 발생했습니다.')
  }

  const cards = (parsed.data || [])
    .map(normalizeRow)
    .map(normalizeMathCardRow)
    .filter((c) => c?.problem && c?.code)

  mathCardsCache = cards
  mathCardsLoaded = true
  rebuildMathCardsIndex(cards)

  // 요청사항: console.log로 카드 데이터 확인 가능하게 출력
  console.log('[math-cards-csv] loaded file:', fileName)
  console.log('[math-cards-csv] cards:', mathCardsCache)

  return mathCardsCache
}

/** 캐시된 카드 배열을 반환합니다. (아직 로드하지 않았다면 빈 배열) */
export function getMathCardsArray() {
  return mathCardsCache
}

/** 캐시 기반 동기 조회. */
export function getMathCardsByProblemSync(problem) {
  const key = normalizeMathCardProblemKey(problem)
  if (!key) return []
  return mathCardsByProblemIndex.get(key) || []
}

/**
 * `problem` 기준 카드 조회 (필요 시 math_cards.csv를 먼저 로드합니다).
 * 예: `getMathCardsByProblem('1-A')`
 */
export async function getMathCardsByProblem(problem, csvPath = DEFAULT_MATH_CARDS_CSV_PATH) {
  if (!mathCardsLoaded) {
    await loadMathCardsCsvRows(csvPath)
  }
  return getMathCardsByProblemSync(problem)
}
