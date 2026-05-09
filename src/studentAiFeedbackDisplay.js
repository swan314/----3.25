/**
 * AI 피드백 원문(시트·콘솔과 동일한 문자열)을 학생 화면 표시용으로만 다듬습니다.
 * 저장·POST·GAS 로직은 변경하지 않습니다.
 */

/** 수학 힌트 + 응원(조금 길게)까지 포함 */
const MAX_LEN = 220

/** 마지막 응원 문장이 없을 때만 사용 — 문장을 길게 해 지루함 완화 */
const FALLBACK_CHEERS = [
  '점점 나아지고 있어. 오늘도 수고했어!',
  '한 걸음씩 더 좋아지고 있어. 계속 가보자!',
  '흐름 잘 타고 있어. 넌 할 수 있어!',
  '실수도 배움이야. 다음엔 더 빛날 거야. 화이팅!',
  '집중하는 모습이 보여. 그 감각 그대로 가보자!',
  '역시 너다! 아자아자!',
  '곧 MATH MASTER 느낌 나. 오늘도 고생했어!',
  '대단해! 오늘도 의미 있는 하루였어!',
  '최고야! 다음 문제도 너답게 가보자!',
  '멋져! 응원할게, 화이팅!',
  '뇌가 살아있어. 계속 이대로만!',
  '다음에 또 보자! 오늘도 수고했어!',
]

/** 문장·절 단위로 제외: 문제상황·목표·틀림·단계·절차 등 */
const EXCLUDE_LINE =
  /문제\s*상황|상황\s*분석|문제를\s*읽|주어진\s*상황|우리의\s*목표|목표는|구하려는|구하는\s*것|틀린|틀렸|잘못|오류|부족|비계|단계\s*\d|\d\s*단계|단계별|비계\d|다음\s*문제|다음에\s*는|절차|차근차근\s*풀|한\s*번\s*더\s*해보|검산까지|다음\s*문제도|먼저\s*세우고|조건을\s*차례로/gi

/** LaTeX 스타일 구분자 제거: \( ... \), \[ ... \], $ ... $ → 안쪽 수식만 남김 */
function stripLatexDelimiters_(text) {
  let t = String(text || '')
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, '$1')
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, '$1')
  t = t.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, '$1')
  t = t.replace(/\\\\([(){}\[\]])/g, '$1')
  t = t.replace(/\\([\\{}_\^])/g, '')
  t = t.replace(/\\/g, '')
  return t.replace(/\s+/g, ' ').trim()
}

/** 학생 화면용 문구만 치환 (저장·콘솔 원문과 무관) */
function applyStudentFacingPhrasePolish_(s) {
  return String(s || '')
    .replace(/올바른\s*방정식은/g, '맞는 방정식은')
    .replace(/나타냅니다/g, '나타내')
    .replace(/이\s*단계에서/g, '')
    .replace(/중요합니다/g, '중요해')
    .replace(/이었어야\s*합니다/g, '이야')
    .replace(/이었어야\s*해/g, '이야')
    .replace(/이었어야해/g, '이야')
    .replace(/하지만\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 첫 번째로/단계 표현 제거, 실패 지적 → 제안형, 교사체 → 친구 말투
 */
function softenFriendSuggestionTone_(s) {
  let t = String(s || '')
  t = t.replace(/(?:첫|두|세|네|다섯|여섯)\s*번째로,?\s*/gi, '')
  t = t.replace(/제\s*\d+\s*번째로,?\s*/gi, '')
  /** 첫째·둘째·셋째 … 순서 나열 (친구 말투에서 제거) */
  t = t.replace(
    /(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)\s*째(?:로)?,?\s*/gi,
    ''
  )
  t = t.replace(/['\u2018\u2019]{1,4}\s*단계에서\s*/gi, '')
  t = t.replace(/["\u201c\u201d]{1,4}\s*단계에서\s*/gi, '')
  t = t.replace(/비계\s*\d\s*단계에서\s*/gi, '')
  t = t.replace(/\d\s*\/\s*\d\s*단계에서\s*/gi, '')
  t = t.replace(/\s*단계에서\s*/g, ' ')

  t = t.replace(
    /올바르게\s*설정하지\s*않았고/gi,
    '식 맞추는 걸 이렇게 바꿔보면 어떨까? 그러면'
  )
  t = t.replace(/설정하지\s*않았고/gi, '여기 한번 더 짚어보면 좋아. 그러면')
  t = t.replace(/올바르게\s*하지\s*않았/gi, '이렇게 해보면 어떨까')
  t = t.replace(/하지\s*않았고/gi, '한번 더 살펴보면 좋아. 그러면')

  t = t.replace(
    /관계를\s*명확히\s*해야\s*해/gi,
    '가로랑 세로가 어떻게 묶이는지 말로 먼저 정리해보면 좋아'
  )
  t = t.replace(/명확히\s*해야\s*해/gi, '먼저 말로 정리해보면 좋아')
  t = t.replace(/반드시\s*해야\s*해/gi, '해 보면 좋아')

  t = t.replace(
    /이는\s*방정식을\s*세우는\s*데에도\s*영향을\s*미쳤어\.?/gi,
    '방정식 세울 때도 같이 보면 좋아.'
  )
  t = t.replace(/영향을\s*미쳤어/gi, '같이 보면 좋아')
  t = t.replace(/영향을\s*미쳤/gi, '같이 보면 좋아')

  t = t.replace(/\s{2,}/g, ' ').trim()
  t = t.replace(/^그러면\s*그러면/gi, '그러면')
  return t.replace(/\s{2,}/g, ' ').trim()
}

/** 수식·관계 기호가 있는 문장인지 (미지수 같은 단어만 있으면 수학 문장으로 치지 않음) */
function hasStructuralMath_(sentence) {
  return /[=＝]|10\s*x|\d+\s*x\s*[+\-]|x\s*\+\s*\d|x\s*\+\s*x|\([^)]*x[^)]*\)|\d+\s*\+\s*\d+|방정식\s*은|관계식/i.test(
    String(sentence || '')
  )
}

/**
 * 3인칭 평가 문장(학생은 … 이해했다 등)만 있는 줄은 친구 피드백에 어색해 제거.
 * 수식/방정식이 같은 문장에 있으면 유지 후 friendPeerVoice_에서 너는 로 바꿈.
 */
function dropEvaluatorOnlySentences_(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  const parts = t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)
  const kept = parts.filter((p) => {
    const thirdPerson = /학생은|학생이|학생의|학생들은/.test(p)
    if (!thirdPerson) return true
    return hasStructuralMath_(p)
  })
  if (kept.length === 0) return ''
  return kept.join(' ').replace(/\s+/g, ' ').trim()
}

/** 평가자·교사 시점 → 옆집 친구 반말 시점 */
function friendPeerVoice_(s) {
  return String(s || '')
    .replace(/먼저,?\s*학생은\s*/g, '너는 ')
    .replace(/먼저,?\s*학생이\s*/g, '너가 ')
    .replace(/\b학생은\s*/g, '너는 ')
    .replace(/\b학생이\s*/g, '너가 ')
    .replace(/\b학생의\s*/g, '네 ')
    .replace(/\b학생들은\s*/g, '너희는 ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 단계·비계 라벨 제거 (GAS stripTrainingStageLabels_ 와 유사) */
function stripTrainingStageLabels_(s) {
  return String(s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/첫\s*번째\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/두\s*번째\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/세\s*번째\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/다음\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/그\s*다음\s*단계(?:인|에서)?\s*/gi, '')
    .replace(/제\s*\d+\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/\d\s*\/\s*6\s*(?:단계)?(?:에서|의|,)?\s*/gi, '')
    .replace(/비계\s*\d\s*(?:에서|의)?\s*/gi, '')
    .replace(/미지수\s*설정(?:에서|을|를|인)?\s*/gi, '')
    .replace(/(?:문제\s*상황을\s*식으로\s*표현|식\s*표현)(?:에서|을|를|인)?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 정답 식 노출 완화 (연속 홀수 등) — problemSnippet 있으면 정확도 ↑ */
function softenAnswerLeakHints_(text, problemSnippet) {
  let t = String(text || '')
  const body = `${problemSnippet || ''} ${t}`
  const talksOddPair = /연속[^.]{0,12}홀수|두\s*홀수|홀수\s*두|연속하는\s*두\s*홀수/i.test(body)
  if (talksOddPair) {
    t = t.replace(
      /큰\s*[^\s.!?]{0,14}\s*(를|을)\s*x\s*\+\s*2\s*로\s*나타내(야|야\s*했|는|면)?[^.!?]*/gi,
      '큰 쪽은 작은 쪽보다 2만큼 크니까, 그 차이를 식으로 어떻게 쓸지 생각해봐'
    )
    t = t.replace(
      /작은\s*[^\s.!?]{0,14}\s*(를|을)\s*x\s*로\s*(두|설정|잡)[^.!?]*/gi,
      '한쪽을 미지수로 잡았다면, 다른 쪽은 그보다 몇만큼 큰 수인지 먼저 말로 정리해봐'
    )
    t = t.replace(/\bx\s*\+\s*2\b(?:\s*로)?(?:\s*나타내|\s*써|\s*표현|\s*적어)[^.!?]*/gi, 'x보다 2큰 수를 식으로 어떻게 나타낼지 생각해봐')
  }
  t = t.replace(
    /정답\s*(은|는|이|가)?\s*x\s*[=＝]\s*[^.!?]+/gi,
    '미지수에 넣을 값은 직접 말하지 않을게, 식만 다시 세워봐'
  )
  return t.replace(/\s+/g, ' ').trim()
}

function informalizeKorean_(s) {
  let t = String(s || '')
  const ordered = [
    [/없었습니다/g, '없어'],
    [/없습니다/g, '없어'],
    [/있었습니다/g, '있었어'],
    [/있습니다/g, '있어'],
    [/되었습니다/g, '됐어'],
    [/됐습니다/g, '됐어'],
    [/했습니다/g, '했어'],
    [/해야\s*합니다/g, '해야 해'],
    [/됩니다/g, '돼'],
    [/합니다/g, '해'],
    [/습니다/g, '어'],
    [/입니다/g, '야'],
    [/것입니다/g, '거야'],
    [/거예요/g, '거야'],
    [/해요/g, '해'],
    [/세요/g, '어'],
    [/습니다요/g, '어'],
    [/습니까/g, '어'],
  ]
  for (const [re, rep] of ordered) {
    t = t.replace(re, rep)
  }
  return t.replace(/\s+/g, ' ').trim()
}

function splitIntoChunks_(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return []
  let parts = t.split(/(?<=[.!?])\s+|[\n]+/)
  if (parts.length === 1 && parts[0].length > 90) {
    parts = parts[0].split(/\s+(?:그리고|또한|그래서|하지만|다음으로)\s+/i)
  }
  return parts
    .map((s) => s.replace(/^[\s\-•]+/, '').trim())
    .filter(Boolean)
}

function extractMathSnippets_(text) {
  const t = String(text || '')
  const found = []
  const res = [
    /10\s*x\s*\+\s*[a-z가-힣0-9]/gi,
    /\d+\s*x\s*[+\-＝=]/g,
    /[xy]\s*[+\-＝=]\s*[\d가-힣]/gi,
    /방정식[^.!\n]{2,35}/g,
    /관계식[^.!\n]{2,35}/g,
    /일차방정식[^.!\n]{2,30}/g,
  ]
  for (const re of res) {
    let m
    const r = new RegExp(re.source, re.flags)
    while ((m = r.exec(t)) !== null) {
      const s = m[0].trim()
      if (s.length >= 4 && !EXCLUDE_LINE.test(s)) found.push(s)
    }
  }
  return [...new Set(found)].slice(0, 2)
}

/** 마지막 한 줄이 모델이 만든 응원인지 (고정 문구 말고 다양한 AI 응원 보존) */
function isLikelyCheerLine_(sentence) {
  const t = String(sentence || '').trim()
  if (t.length > 140) return false
  if (EXCLUDE_LINE.test(t)) return false
  if (/[=＝]\s*[\d\-]+/.test(t) && /x|y/i.test(t)) return false
  return /다시\s*한번|화이팅|아자아자|도전|해보자|해볼까|응원|노력|최고|대단|멋져|짱|굿|좋았|잘했|힘내|수고했|오늘도|내일도|또\s*보자|가보자|이어가|MATH|마스터|살아있|계속|역시|감각/i.test(
    t
  )
}

function mathImportanceScore_(sentence) {
  const s = sentence
  if (EXCLUDE_LINE.test(s)) return -100
  if (isLikelyCheerLine_(s) && s.length < 45) return -50
  let sc = 0
  if (/[0-9]/.test(s)) sc += 2
  if (/[=＝+\-×÷*/()]/.test(s)) sc += 2
  if (/x|y|미지수|방정식|관계식|식으로|등식|배\s*\(|자릿수|10x|연속|두\s*자리/i.test(s)) sc += 4
  if (/어떻게\s*할|왜\s*그런|생각해봐|질문|몇만큼|차이를/i.test(s)) sc += 2
  if (/큰\s*[^\s]{0,10}\s*를\s*x\s*\+\s*2|작은\s*[^\s]{0,10}\s*를\s*x\s*로\s*설정/i.test(s)) sc -= 20
  return sc
}

function pickRandomCheer_() {
  const i = Math.floor(Math.random() * FALLBACK_CHEERS.length)
  return FALLBACK_CHEERS[i] || FALLBACK_CHEERS[0]
}

/** 짧은 한 줄 응원이면 앞에 격려 한 줄을 붙여 조금 길게 */
function expandCheerEncouragement_(cheer) {
  let t = String(cheer || '').trim()
  if (t.length >= 42) return t
  if (/점점\s*나아지|한\s*걸음씩\s*더|흐름\s*잘\s*타/.test(t)) return t
  const prefixes = [
    '점점 나아지고 있어.',
    '한 걸음씩 더 좋아지고 있어.',
    '흐름 잘 타고 있어.',
    '오늘도 의미 있었어.',
  ]
  if (/수고했|화이팅|최고|대단|멋져|아자아자|할\s*수\s*있어|고생했|응원|굿|짱/.test(t)) {
    const pre = prefixes[Math.floor(Math.random() * prefixes.length)]
    return `${pre} ${t}`.replace(/\s+/g, ' ').trim()
  }
  return t
}

function truncateFit_(core, cheer, maxLen) {
  const cheerPart = cheer.replace(/^\s*/, '')
  const room = maxLen - cheerPart.length - (core ? 1 : 0)
  if (room <= 0) return cheerPart.slice(0, maxLen)
  if (!core) return cheerPart.slice(0, maxLen)
  let c = core.slice(0, room).trim()
  if (c.length < core.length) {
    const sp = c.lastIndexOf(' ')
    if (sp > 8) c = c.slice(0, sp).trim()
  }
  const joined = `${c} ${cheerPart}`.trim()
  return joined.length <= maxLen ? joined : cheerPart.slice(0, maxLen)
}

/**
 * @param {string} rawFeedback — 콘솔·저장과 동일한 원문
 * @param {string} [problemSnippet] — 문제 본문 일부 (정답 유출 완화용; 없어도 동작)
 * @returns {string} 학생에게만 보일 문구 (길이 상한 내)
 */
export function formatStudentAiFeedbackForDisplay(rawFeedback, problemSnippet = '') {
  let raw = String(rawFeedback || '').replace(/\s+/g, ' ').trim()
  raw = stripLatexDelimiters_(raw)
  raw = applyStudentFacingPhrasePolish_(raw)
  raw = softenFriendSuggestionTone_(raw)
  raw = dropEvaluatorOnlySentences_(raw)
  raw = friendPeerVoice_(raw)
  raw = stripTrainingStageLabels_(raw)
  raw = softenAnswerLeakHints_(raw, problemSnippet)

  if (!raw) {
    return truncateFit_('', pickRandomCheer_(), MAX_LEN)
  }

  const chunks = splitIntoChunks_(raw)
  let cheerFromModel = ''
  let bodyChunks = chunks

  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]
    if (isLikelyCheerLine_(last)) {
      cheerFromModel = last.trim()
      bodyChunks = chunks.slice(0, -1)
    }
  }

  const scored = bodyChunks
    .map((s) => ({ s, sc: mathImportanceScore_(s) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)

  let coreParts = scored.slice(0, 2).map((x) => x.s)
  if (coreParts.length === 0) {
    const fallback = bodyChunks.filter((s) => !EXCLUDE_LINE.test(s)).slice(0, 1)
    if (fallback.length) {
      coreParts = fallback
    } else {
      const snippets = extractMathSnippets_(raw)
      coreParts = snippets.length ? snippets : ['수학 포인트 잘 짚었어']
    }
  }

  let core = informalizeKorean_(coreParts.join(' '))
  core = applyStudentFacingPhrasePolish_(core)
  core = softenFriendSuggestionTone_(core)
  core = core.replace(EXCLUDE_LINE, '').replace(/\s+/g, ' ').trim()
  core = stripTrainingStageLabels_(core)
  core = softenAnswerLeakHints_(core, problemSnippet)

  if (!core || core.length < 4) {
    core = '수학 포인트 잘 짚었어'
  }

  let cheer = cheerFromModel ? informalizeKorean_(cheerFromModel) : pickRandomCheer_()
  cheer = applyStudentFacingPhrasePolish_(cheer)
  cheer = softenFriendSuggestionTone_(cheer)
  cheer = expandCheerEncouragement_(cheer)
  return truncateFit_(core, cheer, MAX_LEN)
}
