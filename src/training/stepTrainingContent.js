import { plainToDisplayLatex } from './mathTextDisplay'
import { getStepTrainingBucketByKey } from './stepTrainingData'
import { parseTrainingKeysFromCsvCell } from './trainingStageConfig'

export const STEP_TRAINING_TYPE_LABELS = {
  explanation: '설명',
  example: '예제',
  practice: '연습',
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * CSV에서 음수 계수를 (-2)x 로 적었을 때 화면에는 -2x 로 표시.
 * (-2+x) 같은 괄호식은 그대로 둠 (바로 뒤가 문자일 때만).
 */
export function normalizeCoeffParenForDisplay(text) {
  return String(text || '').replace(
    /\(\s*(-?\d+(?:\.\d+)?)\s*\)(?=[a-zA-Z])/g,
    '$1',
  )
}

/** step_training content → 힌트와 동일 규칙(red[], 분수) */
export function formatStepTrainingContentHtml(raw) {
  return escapeHtml(normalizeCoeffParenForDisplay(raw))
    .replace(/red\[([^\]]+)\]/gi, '<span style="color:#dc2626;font-weight:700">$1</span>')
    .replace(/\[RED:\s*([^\]]+)\]/gi, '<span style="color:#dc2626;font-weight:700">$1</span>')
    .replace(
      /\(([^()]+)\)\/\(([^()]+)\)|([0-9a-zA-Z.]+\/[0-9a-zA-Z.]+)/g,
      (token) =>
        `<math-field read-only class="mm-inline-math" value="${escapeHtml(
          plainToDisplayLatex(token),
        )}"></math-field>`,
    )
    .replace(/\n/g, '<br/>')
}

const EXAMPLE_LINE_MARKER_RE = /(?=①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩)/

/** 예제 content·answer를 ①②… 또는 줄바꿈 기준으로 짝지음 */
export function pairExampleContentAndAnswer(content, answer) {
  const splitLines = (text) => {
    const raw = String(text || '').trim()
    if (!raw) return []
    const marked = raw
      .split(EXAMPLE_LINE_MARKER_RE)
      .map((part) => part.trim())
      .filter(Boolean)
    if (marked.length > 1) return marked
    return raw
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
  }

  const contentLines = splitLines(content)
  const answerLines = splitLines(answer)
  if (!contentLines.length && !answerLines.length) {
    const c = String(content || '').trim()
    const a = String(answer || '').trim()
    if (!c && !a) return []
    return [{ problem: c, answer: a }]
  }

  const count = Math.max(contentLines.length, answerLines.length)

  const pairs = []
  for (let i = 0; i < count; i += 1) {
    pairs.push({
      problem: contentLines[i] || '',
      answer: answerLines[i] || '',
    })
  }
  return pairs
}

function mapTrainingRows(rows) {
  return (rows || [])
    .map((row) => ({
      content: String(row?.content ?? '').trim(),
      answer: String(row?.answer ?? '').trim(),
    }))
    .filter((row) => row.content)
}

/**
 * CSV training_key 순서대로, 키별 explanation / example / practice 묶음.
 * @param {string} trainingKeyRaw
 * @returns {Array<{
 *   trainingKey: string,
 *   explanations: Array<{ content: string, answer: string }>,
 *   examples: Array<{ content: string, answer: string }>,
 *   practices: Array<{ content: string, answer: string }>,
 * }>}
 */
export function collectStepTrainingConceptBundles(trainingKeyRaw) {
  const keys = parseTrainingKeysFromCsvCell(trainingKeyRaw)
  const bundles = []

  for (const trainingKey of keys) {
    const bucket = getStepTrainingBucketByKey(trainingKey)
    if (!bucket) continue

    const explanations = mapTrainingRows(bucket.explanation)
    const examples = mapTrainingRows(bucket.example)
    const practices = mapTrainingRows(bucket.practice)

    if (!explanations.length && !examples.length && !practices.length) continue

    bundles.push({ trainingKey, explanations, examples, practices })
  }

  return bundles
}

/** practice 행 중 하나를 무작위로 선택 (팝업 열릴 때 1회) */
export function pickRandomStepPractice(practices) {
  const list = practices || []
  if (!list.length) return null
  return list[Math.floor(Math.random() * list.length)]
}

/** @deprecated collectStepTrainingConceptBundles 사용 */
export function collectStepTrainingExplanations(trainingKeyRaw) {
  return collectStepTrainingConceptBundles(trainingKeyRaw).flatMap(({ trainingKey, explanations }) =>
    explanations.map((row) => ({
      trainingKey,
      content: row.content,
    })),
  )
}
