import { parseExpectedAnswerAlternatives, stripAnswerChoiceMarkers } from './scaffoldUtils'

const CIRCLED_TO_NUM = { '①': '1', '②': '2', '③': '3', '④': '4' }
const NUM_TO_CIRCLED = { 1: '①', 2: '②', 3: '③', 4: '④' }

/** ①~④ 또는 1~4 → '1'..'4' */
export function normalizeChoiceToken(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (CIRCLED_TO_NUM[s]) return CIRCLED_TO_NUM[s]
  const m = s.match(/^([1-4])[.)、)\s]*$/)
  if (m) return m[1]
  const lead = s.match(/^([①②③④])/)
  if (lead && CIRCLED_TO_NUM[lead[1]]) return CIRCLED_TO_NUM[lead[1]]
  return ''
}

/**
 * 1/6문제 본문에서 선택지 목록 추출.
 * @returns {{ prompt: string, options: Array<{ token: string, label: string, display: string }> }}
 */
export function parseChoiceOptionsFromQuestion(questionText) {
  const raw = String(questionText ?? '')
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const options = []
  const promptLines = []
  const optionRe = /^([①②③④]|[1-4])[.)、)\s]+(.+)$/

  for (const line of lines) {
    const m = line.match(optionRe)
    if (m) {
      const token = normalizeChoiceToken(m[1])
      const label = String(m[2] ?? '').trim()
      if (token) {
        options.push({
          token,
          label,
          display: NUM_TO_CIRCLED[Number(token)] || m[1],
        })
      }
    } else {
      promptLines.push(line)
    }
  }

  return {
    prompt: promptLines.join('\n').trim() || raw.trim(),
    options,
  }
}

/** 1/6 선택지 텍스트 ↔ `1/6정답` 비교용 */
export function normalizeChoiceAnswerText(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * 학생이 고른 선택지와 `1/6정답`·`1/6선택정답` 비교 (엄격 일치).
 * @param {{ studentToken?: string, expectedChoiceToken?: string }} [options]
 */
export function choiceAnswerTextMatch(studentText, expectedText, options = {}) {
  const student = normalizeChoiceAnswerText(stripAnswerChoiceMarkers(studentText))
  const studentToken = normalizeChoiceToken(options.studentToken ?? '')
  const expectedToken = normalizeChoiceToken(options.expectedChoiceToken ?? '')

  if (expectedToken && studentToken && studentToken === expectedToken) return true

  const alternatives = parseExpectedAnswerAlternatives(expectedText)
  const textMatched =
    Boolean(student) &&
    alternatives.some((alt) => {
      const norm = normalizeChoiceAnswerText(stripAnswerChoiceMarkers(alt))
      return Boolean(norm) && student === norm
    })
  if (textMatched) return true

  if (!student && !studentToken) return false
  const markerOnlyExpected = normalizeChoiceToken(expectedText)
  return Boolean(markerOnlyExpected && studentToken && studentToken === markerOnlyExpected)
}
