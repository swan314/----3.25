function normalizeType(rawType) {
  const text = String(rawType || '').trim().replace(/\s+/g, '')
  if (!text) return ''
  if (text === '본문제' || text === '유사문제1' || text === '유사문제2') return text
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

export function nextProblemLogic(type, total, problem = '', options = {}) {
  const normalizedType = normalizeType(type)
  const normalizedTotal = Number.isFinite(Number(total)) ? Number(total) : 0
  const normalizedProblem = String(problem || '').trim().toUpperCase()
  const useSimilarProblems = options?.useSimilarProblems !== false

  if (!useSimilarProblems) {
    return {
      nextType: '본문제',
      nextProblem: bumpProblemCode(normalizedProblem),
    }
  }

  if (normalizedType === '본문제') {
    if (normalizedTotal >= 5) {
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
    if (normalizedTotal >= 5) {
      return {
        nextType: '본문제',
        nextProblem: bumpProblemCode(normalizedProblem),
      }
    }
    return {
      nextType: '유사문제2',
      nextProblem: normalizedProblem,
    }
  }
  if (normalizedType === '유사문제2') {
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
  if (text === '본문제' || text === '유사문제1' || text === '유사문제2') return text
  return normalizeType(type)
}
