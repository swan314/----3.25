import {
  normalizeCollapsedFractionWithVariable,
  plainToDisplayLatex,
  preprocessFractionDisplayText,
} from './mathTextDisplay'

const EXAMPLE_MARKER_RE = /^([①②③④⑤⑥⑦⑧⑨⑩]\s*)/
const RED_SPAN_STYLE = 'color:#dc2626;font-weight:700'
const FRACTION_TOKEN_RE =
  /\(([^()]+)\)\/\(([^()]+)\)|([0-9a-zA-Z.]+\/[0-9a-zA-Z.]+)/g
const HANGUL_RE = /[\uAC00-\uD7A3]/
const MATHISH_RE = /^[+\-×=()\d.x\s]+$/

function normalizeCoeffParenForDisplay(text) {
  return String(text || '').replace(
    /\(\s*(-?\d+(?:\.\d+)?)\s*\)(?=[a-zA-Z])/g,
    '$1',
  )
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 수식 표시용 LaTeX — x는 MathLive 수학 모드에서 italic */
export function plainMathExprToLatex(expr) {
  const raw = String(expr ?? '').trim()
  if (!raw) return ''
  let s = preprocessFractionDisplayText(normalizeCollapsedFractionWithVariable(raw))
  s = normalizeCoeffParenForDisplay(s)
  s = s.replace(/×/g, '\\times ')
  return plainToDisplayLatex(s)
}

function formatMathFieldHtml(expr) {
  const latex = plainMathExprToLatex(expr)
  if (!latex) return escapeHtml(expr)
  return `<math-field read-only class="mm-inline-math step-example-math" value="${escapeHtml(latex)}"></math-field>`
}

function splitExampleMarker(line) {
  const match = String(line || '').match(EXAMPLE_MARKER_RE)
  if (!match) return { marker: '', body: String(line || '') }
  return { marker: match[1], body: line.slice(match[0].length) }
}

export function parseExampleBlockIntoLines(blockText) {
  const parts = String(blockText || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!parts.length) return { head: '', steps: [] }
  return { head: parts[0], steps: parts.slice(1) }
}

function parseStepLineAlignment(stepText) {
  const trimmed = String(stepText || '').trim()
  if (!trimmed) return { kind: 'empty' }
  if (/^red\[/i.test(trimmed)) return { kind: 'text', text: trimmed }
  if (trimmed.startsWith('=')) {
    return { kind: 'eq-leading', body: trimmed.slice(1).trim() }
  }
  const eqIndex = trimmed.indexOf('=')
  if (eqIndex > 0) {
    return {
      kind: 'eq-inner',
      prefix: trimmed.slice(0, eqIndex).trim(),
      body: trimmed.slice(eqIndex + 1).trim(),
    }
  }
  return { kind: 'text', text: trimmed }
}

function formatFractionToken(token) {
  return formatMathFieldHtml(token)
}

function splitTopLevelPlus(expr) {
  const terms = []
  let depth = 0
  let start = 0
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === '+' && depth === 0 && i > start) {
      terms.push(expr.slice(start, i))
      start = i + 1
    }
  }
  terms.push(expr.slice(start))
  return terms.map((t) => t.trim()).filter(Boolean)
}

/** 분배법칙 2번째 줄 — × 앞 계수만 빨간색 (예: 2×2x, (-2)×x) */
function formatDistributiveDistributionBody(body) {
  const terms = splitTopLevelPlus(String(body || '').trim())
  if (!terms.length) return formatExampleBodyHtml(body)

  return `&nbsp;${terms
    .map((term) => {
      const match = term.match(/^(\(-?\d+\)|-?\d+)(×)(.+)$/)
      if (!match) return formatExampleBodyHtml(term)
      const [, coeff, times, rest] = match
      const coeffHtml = `<span style="${RED_SPAN_STYLE}">${escapeHtml(coeff)}</span>`
      const restHtml = /[x]/i.test(rest) ? formatMathFieldHtml(rest.trim()) : escapeHtml(rest.trim())
      return `${coeffHtml}${escapeHtml(times)}${restHtml}`
    })
    .join('+')}`
}

function formatExampleBodyHtml(body) {
  let text = String(body || '')
  if (!text) return ''
  const redSlots = []
  text = text.replace(/red\[([^\]]+)\]/gi, (_, inner) => {
    redSlots.push(`<span style="${RED_SPAN_STYLE}">${escapeHtml(inner)}</span>`)
    return `\x00RED${redSlots.length - 1}\x00`
  })

  const fracSlots = []
  text = text.replace(FRACTION_TOKEN_RE, (token) => {
    fracSlots.push(formatFractionToken(token))
    return `\x00FRAC${fracSlots.length - 1}\x00`
  })

  const restoreSlots = (html) =>
    html
      .replace(/\x00RED(\d+)\x00/g, (_, index) => redSlots[Number(index)] ?? '')
      .replace(/\x00FRAC(\d+)\x00/g, (_, index) => fracSlots[Number(index)] ?? '')

  if (!HANGUL_RE.test(text) && !text.includes('\x00RED') && /[x=\d]/.test(text)) {
    const compact = text.replace(/\s+/g, '')
    if (MATHISH_RE.test(compact) || /^[\d().x+\-×=]+$/.test(compact)) {
      return restoreSlots(formatMathFieldHtml(text.trim()))
    }
  }

  const chunks = text.split(/(\x00(?:RED|FRAC)\d+\x00|[\uAC00-\uD7A3]+|\s→\s|→|←)/g).filter(Boolean)
  const html = chunks
    .map((chunk) => {
      if (/^\x00(?:RED|FRAC)\d+\x00$/.test(chunk)) return chunk
      if (HANGUL_RE.test(chunk) || chunk === '→' || chunk === '←' || chunk.trim() === '→') {
        return escapeHtml(chunk)
      }
      const trimmed = chunk.trim()
      if (!trimmed) return chunk.includes('\n') ? escapeHtml(chunk) : ''
      const compact = trimmed.replace(/\s+/g, '')
      if ((MATHISH_RE.test(compact) || /^[\d().x+\-×=]+$/.test(compact)) && /[x=\d]/.test(trimmed)) {
        return formatMathFieldHtml(trimmed)
      }
      return escapeHtml(chunk)
    })
    .join('')

  return restoreSlots(html)
}

function formatExampleStepHtml(stepText, { highlightDistributiveDistribution = false } = {}) {
  const aligned = parseStepLineAlignment(stepText)
  if (aligned.kind === 'empty') return ''
  if (aligned.kind === 'eq-leading') {
    const bodyHtml = highlightDistributiveDistribution
      ? formatDistributiveDistributionBody(aligned.body)
      : formatExampleBodyHtml(aligned.body)
    return `<div class="step-example-step step-example-step--eq-leading"><span class="step-example-eq" aria-hidden="true">=</span><span class="step-example-body">${bodyHtml}</span></div>`
  }
  if (aligned.kind === 'eq-inner') {
    return `<div class="step-example-step step-example-step--eq-inner"><span class="step-example-prefix">${formatExampleBodyHtml(aligned.prefix)}</span><span class="step-example-eq" aria-hidden="true">=</span><span class="step-example-body">${formatExampleBodyHtml(aligned.body)}</span></div>`
  }
  return `<div class="step-example-step step-example-step--text">${formatExampleBodyHtml(aligned.text)}</div>`
}

/**
 * 예제 블록(①/②) — 첫 줄 + 들여쓰기·등호 정렬된 계산 단계
 * CSV 원문은 변경하지 않고 표시만 구조화합니다.
 */
export function formatStepTrainingExampleBlockHtml(blockText, trainingKey = '') {
  const { head, steps } = parseExampleBlockIntoLines(blockText)
  if (!head && !steps.length) return ''

  const { marker, body } = splitExampleMarker(head)
  const headHtml = `<div class="step-example-head"><span class="step-example-marker">${escapeHtml(marker)}</span><span class="step-example-head-body">${formatExampleBodyHtml(body)}</span></div>`

  let distributiveEqStepSeen = false
  const stepsHtml = steps
    .map((step) => {
      const aligned = parseStepLineAlignment(step)
      const highlightDistribution =
        trainingKey === 'distributive' &&
        aligned.kind === 'eq-leading' &&
        !distributiveEqStepSeen
      if (highlightDistribution) distributiveEqStepSeen = true
      return formatExampleStepHtml(step, {
        highlightDistributiveDistribution: highlightDistribution,
      })
    })
    .join('')

  return `<div class="step-example-block">${headHtml}${stepsHtml ? `<div class="step-example-steps">${stepsHtml}</div>` : ''}</div>`
}
