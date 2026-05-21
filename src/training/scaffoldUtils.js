import { normalizeTrainingPedagogyFields } from './trainingProblemMeta.js'

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

function normalizeKoreanNumberWords(text) {
  let out = (text ?? '').toString()
  const replacements = [
    ['하나', '1'],
    ['한', '1'],
    ['일', '1'],
    ['둘', '2'],
    ['두', '2'],
    ['이', '2'],
    ['셋', '3'],
    ['세', '3'],
    ['삼', '3'],
    ['넷', '4'],
    ['네', '4'],
    ['사', '4'],
    ['다섯', '5'],
    ['오', '5'],
    ['여섯', '6'],
    ['육', '6'],
    ['일곱', '7'],
    ['칠', '7'],
    ['여덟', '8'],
    ['팔', '8'],
    ['아홉', '9'],
    ['구', '9'],
    ['열', '10'],
    ['십', '10'],
  ]
  for (const [word, digit] of replacements) {
    out = out.replace(new RegExp(word, 'g'), digit)
  }
  return out
}

/** 「십의 자리 숫자」↔「십의 자리수」 등 자릿수 표현 통일 */
function canonicalizeDigitPlacePhrasing(text) {
  return String(text ?? '').replace(/자리숫자/g, '자리수')
}

function normalizeSemanticAnswer(raw) {
  const base = normalizeKoreanNumberWords(raw)
    .toLowerCase()
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '')
  const withoutParticles = base.replace(
    /(의|은|는|이|가|를|을|에|에서|에게|으로|로|와|과|도|만|까지|부터)/g,
    ''
  )
  return canonicalizeDigitPlacePhrasing(
    withoutParticles.replace(/[^0-9a-z가-힣]/g, ''),
  )
}

function extractCoreKeywords(raw) {
  const tokens = (raw ?? '')
    .toString()
    .toLowerCase()
    .match(/[0-9a-z가-힣]+/g) || []
  const normalized = tokens
    .map((token) => normalizeSemanticAnswer(token))
    .filter((token) => token.length >= 2)
  return [...new Set(normalized)]
}

function diceSimilarity(a, b) {
  const left = (a ?? '').toString()
  const right = (b ?? '').toString()
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0

  const toBigrams = (s) => {
    const map = new Map()
    for (let i = 0; i < s.length - 1; i += 1) {
      const bg = s.slice(i, i + 2)
      map.set(bg, (map.get(bg) || 0) + 1)
    }
    return map
  }

  const aBigrams = toBigrams(left)
  const bBigrams = toBigrams(right)
  let intersection = 0
  for (const [bg, cntA] of aBigrams.entries()) {
    const cntB = bBigrams.get(bg) || 0
    intersection += Math.min(cntA, cntB)
  }
  const total = (left.length - 1) + (right.length - 1)
  return total > 0 ? (2 * intersection) / total : 0
}

function parseNumericExpressionValue(raw) {
  const text = (raw || '').toString().trim()
  if (!text) return NaN
  const sanitized = text
    .replace(/[−–]/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[^\d+\-*/().]/g, '')
    .trim()
  if (!sanitized) return NaN
  if (!/^[\d+\-*/().]+$/.test(sanitized)) return NaN
  if (!/[./]/.test(sanitized)) return NaN
  try {
    const fn = new Function(`return (${sanitized});`)
    const value = Number(fn())
    return Number.isFinite(value) ? value : NaN
  } catch {
    return NaN
  }
}

/** 비계1·2 빈칸 전용 — 조사 제거·띄어쓰기 등 유연 비교 (포함 매칭 없음, '14'⊃'1' 오판 방지) */
function areEquivalentAnswers(lhs, rhs) {
  const nu = numericEquivalenceWithOptionalUnits(lhs, rhs)
  if (nu !== null) return nu

  const left = normalizeLooseAnswer(lhs)
  const right = normalizeLooseAnswer(rhs)
  if (!left || !right) return false
  if (left === right) return true

  const stripParens = (t) => t.replace(/[()]/g, '')
  if (stripParens(left) === stripParens(right)) return true

  const lNum = parseNumericExpressionValue(left)
  const rNum = parseNumericExpressionValue(right)
  if (Number.isFinite(lNum) && Number.isFinite(rNum) && Math.abs(lNum - rNum) < 1e-9) return true

  return isFlexibleCorrect(lhs, rhs)
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
    if (!got || !areEquivalentAnswers(got, expected)) return false
  }
  return true
}

export function normalizeLooseAnswer(s) {
  const normalized = (s ?? '')
    .toString()
    .trim()
    .replace(/\\left|\\right/g, '')
    .replace(/\\times|\\cdot/g, '*')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g, '')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '')
    .toLowerCase()
    .replace(/\(([-+a-z0-9.]+)\)\/\(([-+a-z0-9.]+)\)/gi, '$1/$2')

  const toStableNumberString = (value) => {
    if (!Number.isFinite(value)) return ''
    return Number(value.toFixed(12)).toString()
  }

  const normalizedFractions = normalized.replace(/(?<![\d.])(\d+)\/(\d+)(?![\d.])/g, (_, a, b) => {
    const numerator = Number(a)
    const denominator = Number(b)
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return `${a}/${b}`
    }
    return toStableNumberString(numerator / denominator)
  })

  return normalizedFractions.replace(/(?<![\d.])(\d+\.\d+)(?![\d.])/g, (_, num) => {
    const parsed = Number(num)
    if (!Number.isFinite(parsed)) return num
    return toStableNumberString(parsed)
  })
}

function normalizeText(input) {
  if (input === null || input === undefined) return ''
  let text = String(input).trim().toLowerCase()
  text = text.replace(/[의은는이가을를에에서와과도만]/g, '')
  text = text.replace(/[\s\.,!?\-_/(){}\[\]:;'"`~]/g, '')
  return text
}

function koreanNumberToDigit(word) {
  const numberWords = {
    영: '0',
    공: '0',
    하나: '1',
    한: '1',
    일: '1',
    둘: '2',
    두: '2',
    이: '2',
    셋: '3',
    세: '3',
    삼: '3',
    넷: '4',
    네: '4',
    사: '4',
    다섯: '5',
    오: '5',
    여섯: '6',
    육: '6',
    일곱: '7',
    칠: '7',
    여덟: '8',
    팔: '8',
    아홉: '9',
    구: '9',
    열: '10',
    십: '10',
    십일: '11',
    열하나: '11',
    열한: '11',
    십이: '12',
    열둘: '12',
    열두: '12',
    십삼: '13',
    열셋: '13',
    열세: '13',
    십사: '14',
    열넷: '14',
    열네: '14',
    십오: '15',
    열다섯: '15',
    십육: '16',
    열여섯: '16',
    십칠: '17',
    열일곱: '17',
    십팔: '18',
    열여덟: '18',
    십구: '19',
    열아홉: '19',
  }
  return numberWords[word] || null
}

function isPureNumber(text) {
  return /^-?\d+(\.\d+)?$/.test(String(text).trim())
}

function normalizeNumericAnswer(input) {
  if (input === null || input === undefined) return null
  const raw = String(input).trim()
  const compactRaw = raw.replace(/\s+/g, '')
  if (isPureNumber(raw)) return raw
  // mixed numeric-korean token is invalid (e.g. "1넷")
  if (/[0-9]/.test(compactRaw) && /[가-힣]/.test(compactRaw)) return null
  const converted = koreanNumberToDigit(compactRaw)
  if (converted !== null) return converted
  return null
}

function extractLeadingSemanticNumber(raw) {
  const sem = normalizeSemanticAnswer(raw)
  const m = sem.match(/^(\d+(?:\.\d+)?)/)
  return m ? m[1] : null
}

const FLEXIBLE_SIMILARITY_THRESHOLD = 0.8

function isFlexibleCorrect(studentAnswer, correctAnswer) {
  const rawStudent = String(studentAnswer ?? '').trim()
  const rawCorrect = String(correctAnswer ?? '').trim()
  if (!rawStudent || !rawCorrect) return false

  if (looksLikeMathExpression(rawCorrect) || looksLikeMathExpression(rawStudent)) {
    return isMathExpressionEquivalent(rawStudent, rawCorrect)
  }

  const stripX = (t) => String(t ?? '').replace(/^x\s*=\s*/i, '').trim()
  const studentNoX = stripX(rawStudent)
  const correctNoX = stripX(rawCorrect)
  if (studentNoX && correctNoX && normalizeLooseAnswer(studentNoX) === normalizeLooseAnswer(correctNoX)) {
    return true
  }

  if (isPureNumber(rawCorrect) || isPureNumber(correctNoX)) {
    const target = isPureNumber(rawCorrect) ? rawCorrect : correctNoX
    const normalizedStudentNumber = normalizeNumericAnswer(rawStudent) ?? normalizeNumericAnswer(studentNoX)
    return normalizedStudentNumber === target
  }

  const student = normalizeText(rawStudent)
  const correct = normalizeText(rawCorrect)
  if (!student || !correct) return false
  if (student === correct) return true

  const semStudent = normalizeSemanticAnswer(rawStudent)
  const semCorrect = normalizeSemanticAnswer(rawCorrect)
  if (semStudent && semCorrect && semStudent === semCorrect) return true

  if (semCorrect.length >= 2 && semStudent.length >= 2) {
    if (semCorrect.includes(semStudent)) return true
    if (semStudent.includes(semCorrect)) return true
  }

  const keywords = extractCoreKeywords(rawCorrect)
  if (keywords.length > 0) {
    const haystack = semStudent || student
    if (keywords.every((kw) => haystack.includes(kw))) return true
  }

  const correctCoreNum = extractLeadingSemanticNumber(rawCorrect)
  const studentNum = normalizeNumericAnswer(rawStudent) ?? normalizeNumericAnswer(studentNoX)
  if (correctCoreNum && studentNum && studentNum === correctCoreNum) return true

  const simLeft = semStudent || student
  const simRight = semCorrect || correct
  if (simLeft.length >= 3 && simRight.length >= 3) {
    const sim = diceSimilarity(simLeft, simRight)
    if (sim >= FLEXIBLE_SIMILARITY_THRESHOLD) return true
  }

  return false
}

/** 식·변수 포함 정답 → 숫자 부분만으로 맞추지 않음 */
function requiresFullSymbolicMatch(expectedRaw) {
  const t = String(expectedRaw ?? '').trim()
  if (/=/.test(t)) return true
  const compact = t.replace(/\s+/g, '').replace(/[−–]/g, '-')
  const withoutUnits = stripTrailingUnits(compact)
  if (/^-?\d+(?:\.\d+)?$/.test(withoutUnits)) return false
  return /[a-z]/i.test(t)
}

const NUMERIC_EQ_TOLERANCE = 1e-6

/**
 * 긴 단위 접미사부터 제거 (cm 전에 m만 지우는 오류 방지).
 * 채점: 정답이 "10cm"일 때 학생이 "10"만 적어도 숫자 일치로 인정.
 */
const TRAILING_UNIT_SUFFIXES_LONGEST_FIRST = [
  'km²',
  'm²',
  'cm²',
  'mm²',
  'dm²',
  'cm',
  'mm',
  'km',
  'dm',
  'nm',
  'kg',
  'mg',
  'ml',
  'mL',
  'dl',
  'cl',
  '만원',
  '시간',
  '자루',
  '마리',
  '명',
  '개',
  '살',
  '권',
  '원',
  '년',
  '분',
  '초',
  't',
  'm',
  'g',
  'L',
]

function stripTrailingUnits(raw) {
  let s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[−–]/g, '-')
  let prev = ''
  while (s !== prev) {
    prev = s
    const lower = s.toLowerCase()
    for (let i = 0; i < TRAILING_UNIT_SUFFIXES_LONGEST_FIRST.length; i += 1) {
      const u = TRAILING_UNIT_SUFFIXES_LONGEST_FIRST[i]
      const ul = u.toLowerCase()
      if (lower.endsWith(ul)) {
        s = s.slice(0, -u.length)
        break
      }
    }
  }
  return s
}

/** 숫자 직후부터 문자열 끝까지 (단위 후보) */
function unitSuffixAfterLeadingNumber(compact) {
  const m = String(compact ?? '').match(/^(-?\d+(?:\.\d+)?)(.*)$/)
  return m && m[2] ? m[2] : ''
}

function normalizeUnitSuffix(u) {
  return String(u || '').toLowerCase()
}

/**
 * 정답이 숫자+선택 단위일 때: 학생 숫자만 → 인정.
 * 학생도 단위를 붙이면 숫자 일치 + 단위 일치해야 함 (10m ≠ 10cm).
 * 해당 패턴이 아니면 null (기존 로직으로).
 * @returns {boolean|null}
 */
function numericEquivalenceWithOptionalUnits(studentRaw, expectedRaw) {
  const exp = String(expectedRaw ?? '').trim()
  const stud = String(studentRaw ?? '').trim()
  if (!exp || !stud) return null

  const expC = exp.replace(/\s+/g, '').replace(/[−–]/g, '-')
  const studC = stud.replace(/\s+/g, '').replace(/[−–]/g, '-')

  const expCore = stripTrailingUnits(expC)
  if (!/^-?\d+(?:\.\d+)?$/.test(expCore)) return null

  const vExp = Number(expCore)
  if (!Number.isFinite(vExp)) return null

  // 학생 답이 숫자만 → 정답 숫자와 같으면 정답 (단위 생략 허용)
  if (/^-?\d+(?:\.\d+)?$/.test(studC)) {
    return Math.abs(Number(studC) - vExp) <= NUMERIC_EQ_TOLERANCE
  }

  const studCore = stripTrailingUnits(studC)
  if (!/^-?\d+(?:\.\d+)?$/.test(studCore)) return null
  if (Math.abs(Number(studCore) - vExp) > NUMERIC_EQ_TOLERANCE) return false

  const uExp = unitSuffixAfterLeadingNumber(expC)
  const uStud = unitSuffixAfterLeadingNumber(studC)

  // 정답에 단위 없음인데 학생이 단위만 덧붙인 경우: 숫자만 같으면 인정
  if (!uExp && uStud) {
    return Math.abs(Number(studCore) - vExp) <= NUMERIC_EQ_TOLERANCE
  }

  if (!uStud) return true
  if (!uExp) return null
  return normalizeUnitSuffix(uExp) === normalizeUnitSuffix(uStud)
}

/** 쉼표로 구분된 수식 목록 (순서 유지) */
function splitCommaSeparatedExpressions(raw) {
  return String(raw ?? '')
    .split(',')
    .map((part) => stripAnswerChoiceMarkers(part.trim()))
    .filter(Boolean)
}

function hasMultipleAnswerTokens(raw) {
  return splitCommaSeparatedExpressions(raw).length >= 2
}

function looksLikeOrderedCommaMathList(parts) {
  if (!parts.length) return false
  return parts.every((part) => looksLikeMathExpression(part))
}

function gcdBigInt(a, b) {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function parseFractionToken(raw) {
  const text = String(raw ?? '').trim()
  const m = text.match(/^(-?\d+)\/(-?\d+)$/)
  if (!m) return null
  const n = BigInt(m[1])
  const dRaw = BigInt(m[2])
  if (dRaw === 0n) return null
  const sign = dRaw < 0n ? -1n : 1n
  let num = n * sign
  let den = dRaw < 0n ? -dRaw : dRaw
  const g = gcdBigInt(num, den)
  num /= g
  den /= g
  const value = Number(num) / Number(den)
  if (!Number.isFinite(value)) return null
  return { kind: 'fraction', numerator: num, denominator: den, value }
}

function isFiniteDecimalFraction(fraction) {
  if (!fraction || fraction.kind !== 'fraction') return false
  let den = fraction.denominator < 0n ? -fraction.denominator : fraction.denominator
  while (den % 2n === 0n) den /= 2n
  while (den % 5n === 0n) den /= 5n
  return den === 1n
}

function hasRepeatingDecimalPattern(raw) {
  const text = String(raw ?? '').trim()
  const m = text.match(/^-?\d+\.(\d+)$/)
  if (!m) return false
  const frac = m[1]
  if (frac.length < 4) return false
  if (/^(\d)\1{3,}$/.test(frac)) return true
  if (frac.length >= 6 && /^(\d{2})\1{2,}$/.test(frac)) return true
  return false
}

/** 정답·학생 각각 대표 숫자 추출 (정수/유한소수/분수/순 우리말 수) */
function extractComparableNumber(raw) {
  let body = String(raw ?? '').trim()
  if (!body) return NaN

  body = stripTrailingUnits(body)

  const fraction = parseFractionToken(body)
  if (fraction) return fraction

  if (isPureNumber(body)) {
    return {
      kind: body.includes('.') ? 'decimal' : 'integer',
      value: Number(body),
      raw: body,
    }
  }

  const kor = normalizeNumericAnswer(body)
  if (kor && isPureNumber(kor)) {
    return {
      kind: 'integer',
      value: Number(kor),
      raw: kor,
    }
  }

  const lead = body.match(/^(-?\d+(?:\.\d+)?)/)
  if (lead) {
    return {
      kind: lead[1].includes('.') ? 'decimal' : 'integer',
      value: Number(lead[1]),
      raw: lead[1],
    }
  }

  return NaN
}

function strictNumericEquivalence(studentRaw, expectedRaw) {
  // 다중 정답(예: "28, 29")은 숫자값 단일 동치 비교로 맞추지 않는다.
  // 이 케이스는 전체 문자열/쌍 비교 로직에서만 통과해야 한다.
  if (hasMultipleAnswerTokens(studentRaw) || hasMultipleAnswerTokens(expectedRaw)) return false

  const unitEq = numericEquivalenceWithOptionalUnits(studentRaw, expectedRaw)
  if (unitEq !== null) return unitEq

  if (requiresFullSymbolicMatch(expectedRaw)) return false
  if (requiresFullSymbolicMatch(studentRaw)) return false

  const ne = extractComparableNumber(expectedRaw)
  const ns = extractComparableNumber(studentRaw)

  if (!ne || typeof ne !== 'object' || !Number.isFinite(ne.value)) return false
  if (!ns || typeof ns !== 'object' || !Number.isFinite(ns.value)) return false

  if (ne.kind === 'fraction' && ns.kind === 'fraction') {
    return ne.numerator === ns.numerator && ne.denominator === ns.denominator
  }

  const oneIsFraction = ne.kind === 'fraction' || ns.kind === 'fraction'
  if (oneIsFraction) {
    const decimalSide = ne.kind === 'fraction' ? ns : ne
    const fractionSide = ne.kind === 'fraction' ? ne : ns

    // 무한소수(반복형 표현)는 분수와 동치 처리하지 않음 (예: 0.3333 vs 1/3)
    if (decimalSide.kind === 'decimal' && hasRepeatingDecimalPattern(decimalSide.raw)) return false
    if (!isFiniteDecimalFraction(fractionSide)) return false
  }

  return Math.abs(ns.value - ne.value) <= NUMERIC_EQ_TOLERANCE
}

/**
 * 쉼표로 구분된 복수 수식 — 항목별 정규화 후 같은 순서로 모두 일치해야 정답.
 * @returns {boolean|null} null이면 단일 수식 비교로 위임
 */
function tryMatchesOrderedCommaExpressions(studentRaw, expectedRaw, options = {}) {
  const studentParts = splitCommaSeparatedExpressions(studentRaw)
  const expectedParts = splitCommaSeparatedExpressions(expectedRaw)
  const studentHasComma = String(studentRaw ?? '').includes(',')
  const expectedHasComma = String(expectedRaw ?? '').includes(',')
  if (!studentHasComma && !expectedHasComma) return null
  if (studentParts.length !== expectedParts.length) return false
  if (studentParts.length < 2) return false
  if (
    !looksLikeOrderedCommaMathList(studentParts) &&
    !looksLikeOrderedCommaMathList(expectedParts)
  ) {
    return null
  }
  return studentParts.every((studentPart, index) =>
    matchesSingleExpressionStrict(studentPart, expectedParts[index], options)
  )
}

/**
 * 비계3~6 — 공백·표기 통일 후 전체 일치 또는 (비식 형태 아닐 때만) 숫자값 동치.
 * 포함 비교·부분 숫자 일치 금지.
 */
function matchesSingleExpressionStrict(studentRaw, expectedRaw, options = {}) {
  const {
    allowSwappedEquationSides = false,
    allowUnorderedPair = false,
    mathEquivalentMode = 'auto',
  } = options

  const exp = normalizeLooseAnswer(expectedRaw)
  const st = normalizeLooseAnswer(studentRaw)
  if (!st) return false
  if (exp === st) return true

  const tryMath =
    mathEquivalentMode === 'auto'
      ? looksLikeMathExpression(studentRaw) || looksLikeMathExpression(expectedRaw)
      : mathEquivalentMode === 'addition'
        ? !exp.includes('=') && !st.includes('=')
        : mathEquivalentMode === 'equation'
          ? exp.includes('=') && st.includes('=')
          : false
  if (tryMath && isMathExpressionEquivalent(studentRaw, expectedRaw)) return true

  if (allowUnorderedPair && isUnorderedPairMatch(studentRaw, expectedRaw)) return true

  if (allowSwappedEquationSides && isSwappedEquationMatch(studentRaw, expectedRaw)) return true

  const stripXeq = (t) => t.replace(/^x\s*=\s*/i, '')
  if (stripXeq(st) === stripXeq(exp)) return true

  if (strictNumericEquivalence(studentRaw, expectedRaw)) return true

  if (isFlexibleCorrect(studentRaw, expectedRaw)) return true

  return false
}

function matchesScaffoldStrict(studentRaw, expectedRaw, options = {}) {
  const ordered = tryMatchesOrderedCommaExpressions(studentRaw, expectedRaw, options)
  if (ordered !== null) return ordered
  return matchesSingleExpressionStrict(studentRaw, expectedRaw, options)
}

/**
 * 비계1·2 빈칸 외 문자열 입력이 생기면 유연 규칙 적용 (현재는 거의 빈칸만 사용).
 */
function matchesSingleExpressionFlexible(studentRaw, expectedRaw, options = {}) {
  const { allowSwappedEquationSides = false, allowUnorderedPair = false } = options
  const exp = normalizeLooseAnswer(expectedRaw)
  const st = normalizeLooseAnswer(studentRaw)
  if (!st) return false
  if (exp === st) return true

  if (looksLikeMathExpression(studentRaw) || looksLikeMathExpression(expectedRaw)) {
    if (isMathExpressionEquivalent(studentRaw, expectedRaw)) return true
  }

  if (allowUnorderedPair && isUnorderedPairMatch(studentRaw, expectedRaw)) return true

  if (allowSwappedEquationSides && isSwappedEquationMatch(studentRaw, expectedRaw)) return true

  const stripXeq = (t) => t.replace(/^x\s*=\s*/i, '')
  if (stripXeq(st) === stripXeq(exp)) return true

  const unitEqFlex = numericEquivalenceWithOptionalUnits(studentRaw, expectedRaw)
  if (unitEqFlex !== null) return unitEqFlex

  const lNum = parseNumericExpressionValue(normalizeLooseAnswer(studentRaw))
  const rNum = parseNumericExpressionValue(normalizeLooseAnswer(expectedRaw))
  if (Number.isFinite(lNum) && Number.isFinite(rNum) && Math.abs(lNum - rNum) < 1e-9) return true

  return isFlexibleCorrect(studentRaw, expectedRaw)
}

function matchesScaffoldFlexible(studentRaw, expectedRaw, options = {}) {
  const ordered = tryMatchesOrderedCommaExpressions(studentRaw, expectedRaw, options)
  if (ordered !== null) return ordered
  return matchesSingleExpressionFlexible(studentRaw, expectedRaw, options)
}

const ANSWER_CHOICE_MARKERS_RE = /[①②③④⑤⑥⑦⑧⑨⑩]/g

/** 정답 셀·학생 입력에서 ①②③④ 등 선택 번호 기호 제거 (숫자 정답 앞자리는 제거하지 않음) */
export function stripAnswerChoiceMarkers(raw) {
  return String(raw ?? '')
    .replace(ANSWER_CHOICE_MARKERS_RE, '')
    .replace(/^\s*([1-9])[.)、)]\s+/, '')
    .trim()
}

/**
 * 줄바꿈·번호 기호로 구분된 복수 정답 후보 (OR). 쉼표 구분 수식 목록은 제외.
 * @returns {string[]}
 */
export function parseExpectedAnswerAlternatives(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  const hasMarkers = /[①②③④⑤⑥⑦⑧⑨⑩]/.test(text)
  if (hasMarkers) {
    return text
      .split(/[\n,]+/)
      .map((p) => stripAnswerChoiceMarkers(p))
      .filter(Boolean)
  }
  if (/\n/.test(text)) {
    return text
      .split(/\n+/)
      .map((p) => stripAnswerChoiceMarkers(p))
      .filter(Boolean)
  }
  const single = stripAnswerChoiceMarkers(text)
  return single ? [single] : []
}

/**
 * 계수×괄호 암시 곱만 명시: 2(3x+2) → 2*(3x+2)
 * (3x+2)2 처럼 괄호 뒤 숫자는 변환하지 않음 (오답 유지)
 */
function insertCoefficientBeforeParenthesisMultiplication(s) {
  return String(s ?? '').replace(/(\d)\(/g, '$1*(')
}

function normalizeEquationSide(t) {
  let s = normalizeLooseAnswer(t).replace(/[{}[\]]/g, '').replace(/×/g, '*')
  s = insertCoefficientBeforeParenthesisMultiplication(s)
  s = s.replace(/(\d)([a-z])/gi, '$1*$2')
  return s
}

function stripOuterParens(raw) {
  let text = String(raw ?? '').trim()
  while (text.startsWith('(') && text.endsWith(')')) {
    const inner = text.slice(1, -1).trim()
    if (!inner) break
    text = inner
  }
  return text
}

function removeCoefficientOneParentheses(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '(') {
      out += ch
      i += 1
      continue
    }

    const prev = out[out.length - 1] ?? ''
    // 직전이 숫자/문자/닫는괄호면 계수 또는 곱으로 본다.
    // 단, 직전 숫자 토큰이 정확히 "1"인 경우는 괄호 제거 허용: 1(x+2) -> x+2
    if (/[0-9a-z.)]/i.test(prev)) {
      let k = out.length - 1
      while (k >= 0 && /[0-9]/.test(out[k])) k -= 1
      const numericToken = out.slice(k + 1)
      const hasDigitToken = numericToken.length > 0
      const isUnitCoeff = hasDigitToken && Number(numericToken) === 1
      const isAlphaOrClose = /[a-z.)]/i.test(prev)
      if (isAlphaOrClose || (hasDigitToken && !isUnitCoeff)) {
        out += ch
        i += 1
        continue
      }
      // hasDigitToken && isUnitCoeff 인 경우는 아래로 진행(괄호 제거)
    }

    if (!/[0-9a-z.)]/i.test(prev)) {
      // no-op: fallthrough for plain "( ... )"
    } else if (/[0-9]/.test(prev)) {
      // 직전 "1"은 제거 허용이므로 숫자 '1' 토큰 자체도 제거
      let k = out.length - 1
      while (k >= 0 && /[0-9]/.test(out[k])) k -= 1
      const numericToken = out.slice(k + 1)
      if (numericToken && Number(numericToken) === 1) {
        out = out.slice(0, k + 1)
      }
    } else {
      out += ch
      i += 1
      continue
    }

    let depth = 1
    let j = i + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '(') depth += 1
      else if (text[j] === ')') depth -= 1
      j += 1
    }
    if (depth !== 0) {
      out += ch
      i += 1
      continue
    }

    // 앞 계수가 없는 괄호: ( ... ) -> ...
    out += text.slice(i + 1, j - 1)
    i = j
  }
  return out
}

/** depth 0에서 +/− 존재 여부 (연산 우선순위: 덧셈이 나눗셈·곱셈보다 낮음) */
function hasTopLevelAddSub(text) {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === '+' || ch === '-')) {
      if (i === 0) continue
      return true
    }
  }
  return false
}

/** depth 0에서 이항 연산자로 분리 */
function splitTopLevelBinaryOp(raw, opChar) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === opChar && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * 수식 정규화: 덧셈 항 정렬, 곱셈 인수 정렬, 분수 분자·분모 재귀 정규화.
 * (480+x)/36 ↔ (x+480)/36, 2*x*480 ↔ 480*2*x 등
 */
function canonicalizeMathExpression(raw) {
  let s = normalizeEquationSide(raw)
  if (!s) return ''

  if (hasTopLevelAddSub(s)) {
    return splitTopLevelSignedTerms(s)
      .map((term) => canonicalizeMathExpression(term))
      .filter(Boolean)
      .sort()
      .join('+')
  }

  const divParts = splitTopLevelBinaryOp(s, '/')
  if (divParts.length >= 2) {
    let acc = canonicalizeMathExpression(divParts[0])
    for (let i = 1; i < divParts.length; i += 1) {
      acc = `D(${acc},${canonicalizeMathExpression(divParts[i])})`
    }
    return acc
  }

  const mulParts = splitTopLevelBinaryOp(s, '*')
  if (mulParts.length >= 2) {
    return mulParts
      .map((part) => canonicalizeMathExpression(part))
      .filter(Boolean)
      .sort()
      .join('*')
  }

  const inner = stripOuterParens(s)
  if (inner !== s) return canonicalizeMathExpression(inner)

  const reduced = removeCoefficientOneParentheses(s)
  if (reduced && reduced !== s) return canonicalizeMathExpression(reduced)
  return s
}

/** 덧셈·뺄셈 최상위 항 분리 (교환·결합법칙 정규화용) */
function splitTopLevelSignedTerms(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  const out = []
  let sign = '+'
  let cur = ''
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === '+' || ch === '-') && depth === 0) {
      if (i === 0 && ch === '-') {
        sign = '-'
        continue
      }
      if (i === 0 && ch === '+') continue
      if (cur) out.push(`${sign === '-' ? '-' : ''}${cur}`)
      sign = ch
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) out.push(`${sign === '-' ? '-' : ''}${cur}`)
  return out
}

function canonicalizeAdditionExpression(raw) {
  const normalized = normalizeEquationSide(removeCoefficientOneParentheses(raw))
  if (!normalized) return ''
  const terms = splitTopLevelSignedTerms(normalized)
    .map((v) => stripOuterParens(removeCoefficientOneParentheses(v)))
    .map((v) => v.trim())
    .filter(Boolean)
    .sort()
  return terms.join('+')
}

/** 정규화된 덧셈식의 모든 항 부호 반전 (예: 1000*x+4000 → -1000*x+-4000) */
function negateCanonicalAdditionExpression(canonical) {
  if (!canonical) return ''
  return splitTopLevelSignedTerms(canonical)
    .map((term) => {
      if (term.startsWith('-')) {
        const body = term.slice(1)
        return body || ''
      }
      return `-${term}`
    })
    .filter(Boolean)
    .sort()
    .join('+')
}

function negateSignedTerm(term) {
  const t = String(term ?? '').trim()
  if (!t) return ''
  if (t.startsWith('-')) return t.slice(1) || ''
  return `-${t}`
}

/**
 * 좌변−우변을 한쪽으로 모은 표준형 (이항 동치).
 * 90x=60x+900 ↔ 90x-60x=900 → 동일 키
 */
function equationStandardFormSignature(leftRaw, rightRaw) {
  const leftTerms = splitTopLevelSignedTerms(
    removeCoefficientOneParentheses(stripOuterParens(leftRaw)),
  )
  const rightTerms = splitTopLevelSignedTerms(
    removeCoefficientOneParentheses(stripOuterParens(rightRaw)),
  )
  const combined = [...leftTerms, ...rightTerms.map(negateSignedTerm)]
    .map((v) => stripOuterParens(removeCoefficientOneParentheses(v)).trim())
    .filter(Boolean)
    .sort()
    .join('+')
  return combined
}

/** 표준형과 양변 부호 반전(×−1) 후보 */
function equationMovedTermsSignatures(leftRaw, rightRaw) {
  const form = equationStandardFormSignature(leftRaw, rightRaw)
  if (!form) return []
  const neg = negateCanonicalAdditionExpression(form)
  const keys = [form]
  if (neg && neg !== form) keys.push(neg)
  return keys
}

function equationsEquivalentByMovedTerms(sLeft, sRight, eLeft, eRight) {
  const studentKeys = new Set(equationMovedTermsSignatures(sLeft, sRight))
  if (!studentKeys.size) return false
  return equationMovedTermsSignatures(eLeft, eRight).some((key) => studentKeys.has(key))
}

/**
 * 등식 동치용 서명: 좌우 교환·양변 부호 동시 반전을 하나의 키로 통일.
 * 1000x=4000, 4000=1000x, -1000x=-4000, -4000=-1000x → 동일
 */
function equationEquivalenceSignature(leftRaw, rightRaw) {
  const left = canonicalizeMathExpression(leftRaw)
  const right = canonicalizeMathExpression(rightRaw)
  if (!left || !right) return ''
  const negLeft = /[D(]|\*/.test(left) ? '' : negateCanonicalAdditionExpression(left)
  const negRight = /[D(]|\*/.test(right) ? '' : negateCanonicalAdditionExpression(right)
  const pairKey = (a, b) => [a, b].sort().join('|')
  const candidates = [pairKey(left, right)]
  if (negLeft && negRight) candidates.push(pairKey(negLeft, negRight))
  return candidates.sort()[0] ?? ''
}

function looksLikeMathExpression(raw) {
  const t = normalizeEquationSide(raw)
  if (!t) return false
  if (t.includes('=')) return true
  return /[+\-*/]/.test(t) && /[a-z0-9]/i.test(t)
}

/**
 * 수학식 동치 비교:
 * - 띄어쓰기·전각 공백 차이는 무시
 * - 덧셈·곱셈·분수식은 교환·결합법칙으로 정규화 후 비교
 * - 2(3x+2), 2*(3x+2), (3x+2)*2 동치 / (3x+2)2 는 비동치
 * - 방정식은 좌우 교환·양변 부호 반전·이항 동치
 * - 포함 비교는 사용하지 않음
 */
export function isMathExpressionEquivalent(studentRaw, expectedRaw) {
  const s = normalizeEquationSide(studentRaw)
  const e = normalizeEquationSide(expectedRaw)
  if (!s || !e) return false
  if (s === e) return true

  const sHasEq = s.includes('=')
  const eHasEq = e.includes('=')
  if (sHasEq !== eHasEq) return false

  if (!sHasEq) {
    return canonicalizeMathExpression(s) === canonicalizeMathExpression(e)
  }

  const [sLeft, sRight, ...sRest] = s.split('=')
  const [eLeft, eRight, ...eRest] = e.split('=')
  if (sRest.length || eRest.length) return false
  if (sLeft == null || sRight == null || eLeft == null || eRight == null) return false

  if (equationsEquivalentByMovedTerms(sLeft, sRight, eLeft, eRight)) return true

  const studentSig = equationEquivalenceSignature(sLeft, sRight)
  const expectedSig = equationEquivalenceSignature(eLeft, eRight)
  return Boolean(studentSig) && studentSig === expectedSig
}

function isSwappedEquationMatch(studentRaw, expectedRaw) {
  const [sLeft, sRight, ...sRest] = (studentRaw ?? '').toString().split('=')
  const [eLeft, eRight, ...eRest] = (expectedRaw ?? '').toString().split('=')
  if (sRest.length || eRest.length) return false
  if (sLeft == null || sRight == null || eLeft == null || eRight == null) return false
  return normalizeEquationSide(sLeft) === normalizeEquationSide(eRight) &&
    normalizeEquationSide(sRight) === normalizeEquationSide(eLeft)
}

function splitNormalizedAnswers(raw) {
  return splitCommaSeparatedExpressions(raw).map((v) => normalizeLooseAnswer(v)).filter(Boolean)
}

function isUnorderedPairMatch(studentRaw, expectedRaw) {
  const studentParts = splitNormalizedAnswers(studentRaw)
  const expectedParts = splitNormalizedAnswers(expectedRaw)
  if (studentParts.length !== 2 || expectedParts.length !== 2) return false
  const [s1, s2] = studentParts
  const [e1, e2] = expectedParts
  return (s1 === e1 && s2 === e2) || (s1 === e2 && s2 === e1)
}

/**
 * 비계별 정답 비교 — `flexible`(비계1·2) 또는 `strict`(비계3~6).
 */
export function matchesScaffoldExpected(studentRaw, expectedRaw, options = {}) {
  const { flexible = false, ...rest } = options
  const student = stripAnswerChoiceMarkers(studentRaw)
  if (!student) return false
  const expected = stripAnswerChoiceMarkers(expectedRaw)
  const matcher = flexible ? matchesScaffoldFlexible : matchesScaffoldStrict

  if (hasMultipleAnswerTokens(student) && hasMultipleAnswerTokens(expected)) {
    const ordered = tryMatchesOrderedCommaExpressions(student, expected, rest)
    if (ordered !== null) return ordered
  }

  const alternatives = parseExpectedAnswerAlternatives(expectedRaw)
  if (!alternatives.length) return false
  return alternatives.some((exp) => matcher(student, exp, rest))
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
    rows.push(normalizeTrainingPedagogyFields(row))
  }
  return rows
}
