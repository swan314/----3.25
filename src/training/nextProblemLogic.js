function normalizeType(rawType) {
  const text = String(rawType || '').trim().replace(/\s+/g, '')
  if (!text) return ''
  if (text === '본문제' || text === '유사문제1') return text
  return text
}

function parseProblemCode(problem) {
  const text = String(problem || '').trim().toUpperCase()
  const match = text.match(/^(\d+)-([A-Z])$/)
  if (!match) return null
  return {
    stage: Number(match[1]),
    code: match[2],
  }
}

function bumpProblemCode(problem) {
  const parsed = parseProblemCode(problem)
  if (!parsed) return String(problem || '')
  const currentCode = parsed.code.charCodeAt(0)
  const nextCode = String.fromCharCode(currentCode + 1)
  return `${parsed.stage}-${nextCode}`
}

const MAIN_FAIL_THRESHOLD = 2

/**
 * @param {number} failCount 실패 단계 수 (새 규칙). 레거시 호출은 total(성공 횟수)로 넘어올 수 있음.
 */
export function nextProblemLogic(type, failCountOrLegacyTotal, problem = '', options = {}) {
  const normalizedType = normalizeType(type)
  const normalizedProblem = String(problem || '').trim().toUpperCase()
  const useSimilarProblems = options?.useSimilarProblems !== false

  let failCount = Number(failCountOrLegacyTotal)
  if (!Number.isFinite(failCount)) failCount = 0
  if (options?.legacySuccessTotal === true) {
    failCount = Math.max(0, 6 - failCount)
  }

  if (!useSimilarProblems) {
    return {
      nextType: '본문제',
      nextProblem: bumpProblemCode(normalizedProblem),
    }
  }

  if (normalizedType === '본문제') {
    if (failCount < MAIN_FAIL_THRESHOLD) {
      return {
        nextType: '본문제',
        nextProblem: bumpProblemCode(normalizedProblem),
      }
    }
    return {
      nextType: '유사문제1',
      nextProblem: normalizedProblem,
    }
  }
  if (normalizedType === '유사문제1') {
    return {
      nextType: '본문제',
      nextProblem: bumpProblemCode(normalizedProblem),
    }
  }
  return {
    nextType: '본문제',
    nextProblem: bumpProblemCode(normalizedProblem),
  }
}

export function normalizeProblemType(type) {
  const text = String(type ?? '').trim().replace(/\s+/g, '')
  if (text === '본문제' || text === '유사문제1') return text
  return normalizeType(type)
}
