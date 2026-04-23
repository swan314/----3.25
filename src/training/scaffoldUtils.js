/** @param {string} cell */
export function unquoteCsvCell(cell) {
  let s = (cell ?? '').toString().trim()
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"')
  }
  return s
}

/**
 * 한 줄을 CSV 규칙(RFC 간략)으로 분리합니다. 필드 내부 줄바꿈은 없다고 가정합니다.
 */
export function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map(unquoteCsvCell)
}

/**
 * @param {string} text
 * @returns {{ type: 'text' | 'blank', value?: string, expected?: string }[]}
 */
export function splitByParentheses(text) {
  const raw = text ?? ''
  const parts = []
  let i = 0
  while (i < raw.length) {
    const open = raw.indexOf('(', i)
    if (open === -1) {
      if (i < raw.length) parts.push({ type: 'text', value: raw.slice(i) })
      break
    }
    if (open > i) parts.push({ type: 'text', value: raw.slice(i, open) })
    const close = raw.indexOf(')', open + 1)
    if (close === -1) {
      parts.push({ type: 'text', value: raw.slice(open) })
      break
    }
    const inner = raw.slice(open + 1, close)
    parts.push({ type: 'blank', expected: inner })
    i = close + 1
  }
  if (!parts.length) parts.push({ type: 'text', value: '' })
  return parts
}

export function hasBlanks(text) {
  return splitByParentheses(text).some((p) => p.type === 'blank')
}

/**
 * 괄호 빈칸이 있으면 모두 정답인지 검사합니다.
 * @param {string} sourceText
 * @param {Record<string, string>} keyedValues key: `${stageIndex}-${blankIndex}`
 */
export function blanksAllCorrect(sourceText, keyedValues, stageIndex) {
  const parts = splitByParentheses(sourceText)
  let bi = 0
  for (let p = 0; p < parts.length; p += 1) {
    const part = parts[p]
    if (part.type !== 'blank') continue
    const key = `${stageIndex}-${bi}`
    bi += 1
    const expected = (part.expected ?? '').trim()
    const got = (keyedValues[key] ?? '').trim()
    if (!got || got !== expected) return false
  }
  return true
}

export function normalizeLooseAnswer(s) {
  return (s ?? '')
    .toString()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '')
    .toLowerCase()
}

/**
 * 비계3~6 정답 비교 — 공백·대소문자·유니코드 마이너스 무시, = 주변 완화.
 */
export function matchesScaffoldExpected(studentRaw, expectedRaw) {
  const exp = normalizeLooseAnswer(expectedRaw)
  const st = normalizeLooseAnswer(studentRaw)
  if (!st) return false
  if (exp === st) return true

  const stripXeq = (t) => t.replace(/^x\s*=\s*/i, '')
  if (stripXeq(st) === stripXeq(exp)) return true

  const numOnly = (t) => t.replace(/[^\d./-]/g, '')
  if (numOnly(st) && numOnly(exp) && numOnly(st) === numOnly(exp)) return true

  const dig = (t) => t.match(/\d+/g)?.join('') ?? ''
  if (dig(st) && dig(st) === dig(exp) && /살|명|개|자루|마리/.test(exp)) return true

  return false
}

/**
 * @param {string} csvText
 */
export function parseLevel1Csv(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) return []
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return []

  const header = parseCsvLine(lines[0])
  const rows = []
  for (let li = 1; li < lines.length; li += 1) {
    const cols = parseCsvLine(lines[li])
    if (cols.every((c) => c === '')) continue
    /** @type {Record<string, string>} */
    const row = {}
    header.forEach((h, i) => {
      row[h] = cols[i] ?? ''
    })
    if (!(row['문제 텍스트'] || row['유형'])) continue
    rows.push(row)
  }
  return rows
}
