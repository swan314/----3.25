/**
 * CSV·평문의 a/b, x/4, (8-x)/5, (1/3)x 등을 LaTeX \frac{}{}로 바꿔 MathLive에서 분수로 표시합니다.
 */

/** latexToPlain 과정에서 \frac{14}{x} → (1)/(4)x 로 깨진 경우만 복구 */
export function normalizeCollapsedFractionWithVariable(text) {
  return String(text || '')
    .replace(/\((\d)(\d)\)\/\(([a-zA-Z])\)/g, '($1)/($2)$3')
    .replace(/\b(\d{2,})\/([a-zA-Z])\b/g, '($1)/($2)')
}

/** 표시·토큰 분리 전: 이중 괄호 분수, (1/n)x → x/n */
export function preprocessFractionDisplayText(text) {
  let s = String(text || '')
  s = s.replace(/\(\s*\(([^()]+)\)\s*\)\s*\/\s*\(\s*\(([^()]+)\)\s*\)/g, '($1)/($2)')
  s = s.replace(/\(\s*\(([^()]+)\)\s*\)\s*\/\s*\(\s*(\d+)\s*\)/g, '($1)/$2')
  s = s.replace(/\(\s*\(([^()]+)\)\s*\)\s*\/\s*(\d+)(?!\d)/g, '($1)/$2')
  s = s.replace(/\(\s*1\s*\/\s*(\d+)\s*\)\s*([a-zA-Z])(?=[^a-zA-Z0-9]|$)/g, '$2/$1')
  return s
}

function unwrapOuterParens(part) {
  let t = String(part ?? '').trim()
  while (t.startsWith('(') && t.endsWith(')')) {
    const inner = t.slice(1, -1).trim()
    if (!inner || (inner.match(/\(/g) || []).length !== (inner.match(/\)/g) || []).length) {
      break
    }
    t = inner
  }
  return t
}

export function plainToDisplayLatex(plainText) {
  const raw = preprocessFractionDisplayText(
    normalizeCollapsedFractionWithVariable(plainText),
  ).trim()
  if (!raw) return ''
  let latex = raw.replace(/\*/g, '\\times ')
  latex = latex.replace(/\(\s*\(([^()]+)\)\s*\)\s*\/\s*\(\s*\(([^()]+)\)\s*\)/g, (_, a, b) => {
    return `\\frac{${unwrapOuterParens(a)}}{${unwrapOuterParens(b)}}`
  })
  latex = latex.replace(/\(([^()]+)\)\/\(([^()]+)\)/g, (_, a, b) => {
    return `\\frac{${unwrapOuterParens(a)}}{${unwrapOuterParens(b)}}`
  })
  latex = latex.replace(/\(([^()]+)\)\/(\d+)(?!\d)/g, (_, a, b) => {
    return `\\frac{${unwrapOuterParens(a)}}{${b}}`
  })
  latex = latex.replace(/\((\d+)\/(\d+)\)([a-zA-Z])/g, '\\frac{$1}{$2}$3')
  latex = latex.replace(/\((\d+)\/(\d+)\)/g, '\\frac{$1}{$2}')
  latex = latex.replace(/(\d+)\/(\d+)(?!\d)/g, '\\frac{$1}{$2}')
  latex = latex.replace(/([a-zA-Z])\/(\d+)(?!\d)/g, '\\frac{$1}{$2}')
  latex = latex.replace(/(?<![a-zA-Z0-9])(\d+)\/([a-zA-Z])(?![a-zA-Z0-9])/g, '\\frac{$1}{$2}')
  latex = latex.replace(/\b([a-zA-Z])\/([a-zA-Z])\b/g, '\\frac{$1}{$2}')
  return latex
}

/**
 * 평문에서 분수 조각을 찾습니다 (표시용 math-field 토큰).
 * preprocessFractionDisplayText 적용 후 사용합니다.
 */
export const FRACTION_TOKEN_REGEX =
  /\(([^()]+)\)\/\(([^()]+)\)|\(([^()]+)\)\/(\d+)(?!\d)|\((\d+)\/(\d+)\)(?=[a-zA-Z])|[a-zA-Z]\/\d+(?!\d)|(?<![a-zA-Z0-9])\d+\/[a-zA-Z](?![a-zA-Z0-9])|\d+\/\d+(?!\d)/g

export function latexToPlain(latex) {
  return normalizeCollapsedFractionWithVariable(
    String(latex || '')
      .replace(/\\left|\\right/g, '')
      .replace(/\\text\s*\{([^}]*)\}/g, (_, inner) => String(inner ?? ''))
      .replace(/\\mathrm\s*\{([^}]*)\}/g, (_, inner) => String(inner ?? ''))
      .replace(/\\operatorname\s*\{([^}]*)\}/g, (_, inner) => String(inner ?? ''))
      .replace(/\\,/g, '')
      .replace(/\\times|\\cdot/g, '*')
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
      .replace(/\\frac\s*([0-9a-zA-Z]+)\s*([0-9a-zA-Z]+)/g, '($1)/($2)')
      .replace(/\\/g, '')
      .replace(/[{}]/g, '')
      .replace(/(\d)\s*,\s*([a-z])/gi, '$1$2')
      .replace(/operatorname/gi, '')
      .replace(/mathrm/gi, '')
      .trim(),
  )
}
