import { parseExpectedAnswerAlternatives } from './scaffoldUtils.js'

/** @typedef {'T1'|'T2'|'T3'|'T4'|'T5'|'T6'|'T7_odd'|'T7_consecutive'|'T8_rect'|'T8_change'|'T8_length'|'T9_distance'|'T9_speed'|'T10'|'T11'|'T12'|'generic'} Step2AnswerType */

const PARTICLE_RE = /(의|은|는|이|가|를|을|에|에서|에게|으로|로|와|과|도|만|까지|부터)/g

const COUNT_SYNONYMS = ['수', '개수', '명', '인원', '개', '마리수', '일수', '날수']
const SMALL_SYNONYMS = ['작', '작은', '더작', '더작은', '작은쪽']
const LARGE_SYNONYMS = ['큰', '더큰', '큰쪽']
const TIME_SYNONYMS = ['시간', '기간', '개월', '일수', '날수', '날']
const DISTANCE_SYNONYMS = ['거리']
const AGE_SYNONYMS = ['나이']

function normalizeKoreanNumberWords(text) {
  let out = String(text ?? '')
  const replacements = [
    ['하나', '1'],
    ['한', '1'],
    ['둘', '2'],
    ['두', '2'],
    ['셋', '3'],
    ['세', '3'],
    ['넷', '4'],
    ['네', '4'],
    ['다섯', '5'],
    ['여섯', '6'],
    ['일곱', '7'],
    ['여덟', '8'],
    ['아홉', '9'],
    ['열', '10'],
  ]
  for (const [word, digit] of replacements) {
    out = out.replace(new RegExp(word, 'g'), digit)
  }
  return out
}

/** 2단계 의미 정규화 — 세로·두 자리 등 일반 단어 보호 */
export function normalizeStep2Text(raw) {
  let text = String(raw ?? '')
    .toLowerCase()
    .replace(/[−–]/g, '-')
  text = text.replace(/세로/g, '\u0000SEVERO\u0000')
  text = text.replace(/두\s*자리/g, '\u0000DUDIGIT\u0000')
  text = text.replace(/두\s*사람/g, '\u0000DUPEOPLE\u0000')
  text = text.replace(/두\s*홀수/g, '\u0000DUODD\u0000')
  text = normalizeKoreanNumberWords(text)
  text = text
    .replace(/\u0000SEVERO\u0000/g, '세로')
    .replace(/\u0000DUDIGIT\u0000/g, '두자리')
    .replace(/\u0000DUPEOPLE\u0000/g, '두사람')
    .replace(/\u0000DUODD\u0000/g, '두홀수')
    .replace(/\s+/g, '')
  const withoutParticles = text.replace(PARTICLE_RE, '')
  return withoutParticles
    .replace(/자리숫자/g, '자리수')
    .replace(/[^0-9a-z가-힣]/g, '')
}

function includesAny(raw, variants) {
  const normalized = normalizeStep2Text(raw)
  if (!normalized) return false
  return variants.some((variant) => {
    const token = normalizeStep2Text(variant)
    return token.length >= 1 && normalized.includes(token)
  })
}

function isBareTimeWordOnly(student) {
  const s = normalizeStep2Text(student)
  return s === '시간' || s === '기간' || s === '개월'
}

/** T5 만남 시간 — 형·동생 출발 후 만남 (5-D) */
function isT5SiblingDepartureMeetingExpected(raw) {
  return /(?:형|누나)/.test(raw) && /출발/.test(raw) && /만날|만나/.test(raw)
}

function matchesT5SiblingDepartureMeeting(student, expectedRaw) {
  if (isBareTimeWordOnly(student)) return false
  if (!includesAny(student, ['시간', '걸린', '걸리'])) return false

  const olderTokens = /누나/.test(expectedRaw) ? ['누나'] : ['형']
  const hasOlder = includesAny(student, olderTokens)
  const hasYounger = includesAny(student, ['동생'])

  if (hasYounger && !hasOlder) return false
  if (hasOlder) return true

  if (includesAny(student, ['만날', '만나', '만나는', '출발'])) {
    return hasOlder
  }
  return false
}

/** T5 만남 시간 — 두 사람 만남·재만남 (6-A, 6-B) */
function isT5TwoPeopleMeetingExpected(raw) {
  return /두\s*사람/.test(raw) && /만날|만나/.test(raw) && /시간/.test(raw)
}

function matchesT5TwoPeopleMeeting(student) {
  if (isBareTimeWordOnly(student)) return false
  if (!includesAny(student, ['시간', '걸린', '걸리'])) return false
  return includesAny(student, ['만날', '만나', '만나는', '만날때', '다시'])
}

function matchesT5VariableAnswer(student, expectedRaw) {
  const raw = String(expectedRaw ?? '').trim()
  if (isT5SiblingDepartureMeetingExpected(raw)) {
    return matchesT5SiblingDepartureMeeting(student, raw)
  }
  if (isT5TwoPeopleMeetingExpected(raw)) {
    return matchesT5TwoPeopleMeeting(student)
  }
  const groupSets = buildStep2RequiredGroupSets(raw, 'T5')
  return anyGroupSetMatches(student, groupSets)
}

function allGroupsMatch(raw, groups) {
  if (!groups.length) return false
  return groups.every((group) => includesAny(raw, group))
}

function anyGroupSetMatches(raw, groupSets) {
  return groupSets.some((groups) => allGroupsMatch(raw, groups))
}

function pickComparisonSynonyms(expected) {
  const n = normalizeStep2Text(expected)
  if (SMALL_SYNONYMS.some((s) => n.includes(normalizeStep2Text(s)))) return SMALL_SYNONYMS
  if (LARGE_SYNONYMS.some((s) => n.includes(normalizeStep2Text(s)))) return LARGE_SYNONYMS
  return [...SMALL_SYNONYMS, ...LARGE_SYNONYMS]
}

function extractLocationTokens(expected) {
  const raw = String(expected ?? '')
  const tokens = []
  const untilRe = /(?:에서|부터)\s*([가-힣]+)\s*까지/g
  let m
  while ((m = untilRe.exec(raw)) !== null) {
    tokens.push(m[1])
  }
  const betweenRe = /([가-힣]+)\s*과\s*([가-힣]+)\s*사이/g
  while ((m = betweenRe.exec(raw)) !== null) {
    tokens.push(m[1], m[2])
  }
  const schoolLike = raw.match(/(학교|도서관|공원|체육관|집)/g)
  if (schoolLike) tokens.push(...schoolLike)
  return [...new Set(tokens.filter(Boolean))]
}

function extractSpeedTokens(expected) {
  const raw = String(expected ?? '')
  const tokens = []
  const kmMatch = raw.match(/(\d+)\s*km/i)
  if (kmMatch) {
    tokens.push(`${kmMatch[1]}km`, kmMatch[1])
  }
  if (/시속/i.test(raw)) tokens.push('시속', '시속6km', '6km')
  return [...new Set(tokens)]
}

function extractNamedPerson(expected) {
  const m = String(expected ?? '').match(/([가-힣]{2,3})가\s*일한/)
  return m ? [m[1]] : []
}

function extractSubjectBeforeCount(expected) {
  const raw = String(expected ?? '')
  if (/전체\s*학생/.test(raw)) return ['전체', '학생']
  if (/작년\s*남학생/.test(raw)) return ['작년', '남학생']
  if (/남학생/.test(raw)) return ['남학생']
  if (/[23]점\s*슛/.test(raw)) {
    const pt = raw.match(/([23])점\s*슛/)?.[1]
    return pt ? [`${pt}점`, `${pt}점슛`, '슛'] : ['슛']
  }
  if (/볼펜/.test(raw)) return ['볼펜']
  if (/연필/.test(raw)) return ['연필']
  if (/사탕/.test(raw)) return ['사탕', '받은학생', '학생']
  if (/초콜릿/.test(raw)) return ['초콜릿', '받은학생', '학생']
  return []
}

function extractAgePerson(expected) {
  const raw = String(expected ?? '')
  if (/동생/.test(raw) && /나이/.test(raw) && !/주는/.test(raw)) return ['동생']
  if (/올해\s*아들/.test(raw)) return ['아들', '올해아들', '올해']
  if (/올해\s*딸/.test(raw)) return ['딸', '올해딸', '올해']
  if (/아들/.test(raw)) return ['아들']
  if (/딸/.test(raw)) return ['딸']
  return []
}

/**
 * @param {string} expected
 * @returns {Step2AnswerType}
 */
export function classifyStep2Expected(expected) {
  const raw = String(expected ?? '').trim()
  const n = normalizeStep2Text(raw)

  if (/홀수/.test(raw) && /작|큰/.test(raw)) return 'T7_odd'
  if (/연속/.test(raw) && /자연수/.test(raw) && /작|큰/.test(raw)) return 'T7_consecutive'
  if (/마리수/.test(raw)) return 'T3'
  if (/원가/.test(raw)) return 'T12'
  if (/일한/.test(raw) && /날|수/.test(raw)) return 'T11'
  if (/시속/.test(raw) && /거리/.test(raw)) return 'T9_speed'
  if (/거리/.test(raw) && !/길이/.test(raw)) return 'T9_distance'
  if (/기차/.test(raw) && /길이/.test(raw)) return 'T8_length'
  if (/cm/.test(raw) && /늘린/.test(raw)) return 'T8_change'
  if (/직사각형/.test(raw) && /세로/.test(raw)) return 'T8_rect'
  if (/자리/.test(raw) && /숫자|수/.test(raw)) return 'T6'
  if (/기간|개월\s*수|걸린\s*시간|만날|다시\s*만날|같아질\s*때까지/.test(raw)) return 'T5'
  if (/주는\s*(?:우표|구슬)|우표\s*개수|구슬\s*개수/.test(raw)) return 'T4'
  if (/배정.*방|방의\s*개수/.test(raw)) return 'T10'
  if (/나이/.test(raw) && !/기간|배가\s*되는|배가되/.test(raw)) return 'T1'
  if (/전체\s*학생/.test(raw)) return 'T2'
  if (/학생/.test(raw) && /수|개수/.test(raw)) return 'T2'
  if (/슛|볼펜|연필/.test(raw)) return 'T2'
  if (/남학생/.test(raw)) return 'T2'
  return 'generic'
}

/**
 * @param {string} expected
 * @param {Step2AnswerType} type
 * @returns {string[][][]}
 */
export function buildStep2RequiredGroupSets(expected, type) {
  const raw = String(expected ?? '').trim()
  const comparison = pickComparisonSynonyms(raw)

  switch (type) {
    case 'T1': {
      const person = extractAgePerson(raw)
      return [person.length ? [person, AGE_SYNONYMS] : [AGE_SYNONYMS]]
    }

    case 'T2': {
      const subject = extractSubjectBeforeCount(raw)
      if (/전체\s*학생/.test(raw)) {
        return [[['전체'], ['학생'], COUNT_SYNONYMS]]
      }
      if (subject.length) {
        return [[subject, COUNT_SYNONYMS]]
      }
      return [[['수'], COUNT_SYNONYMS]]
    }

    case 'T3': {
      const animal = /소/.test(raw) ? ['소'] : /양/.test(raw) ? ['양'] : []
      return [[animal.length ? animal : ['소', '양'], ['마리', '마리수']]]
    }

    case 'T4': {
      const giver = /누나/.test(raw) ? ['누나'] : ['형']
      const item = /구슬/.test(raw) ? ['구슬'] : ['우표']
      return [[giver, ['동생'], item, COUNT_SYNONYMS]]
    }

    case 'T5': {
      const groups = []
      if (/어머니|아버지/.test(raw)) {
        groups.push(/어머니/.test(raw) ? ['어머니'] : ['아버지'])
      }
      if (/아들|딸/.test(raw)) {
        groups.push(/아들/.test(raw) ? ['아들'] : ['딸'])
      }
      if (/저금/.test(raw)) {
        groups.push(['저금', '저금액'])
        groups.push(['2배', '두배', '2'])
      }
      if (/꽃|별/.test(raw) && /같아질/.test(raw)) {
        groups.push(/꽃/.test(raw) ? ['꽃'] : ['별'])
        groups.push(['같아', '같'])
      }
      if (/세\s*배|3\s*배|네\s*배|4\s*배/.test(raw)) {
        groups.push(['배', '3배', '4배', '세배', '네배'])
      }
      if (/개월/.test(raw)) {
        groups.push(['개월', '개월수'])
      }
      groups.push(TIME_SYNONYMS.filter((t) => t !== '날'))
      return [groups]
    }

    case 'T6': {
      const asksTens = /십의\s*자리\s*(?:의\s*)?(?:숫자|수)/.test(raw)
      const asksOnes = /일의\s*자리\s*(?:의\s*)?(?:숫자|수)/.test(raw) && !asksTens
      if (asksTens) return [[['십의자리', '십의']]]
      if (asksOnes) return [[['일의자리', '일의']]]
      return [[['숫자', '자리수', '자연수']]]
    }

    case 'T7_odd':
      return [[['홀수'], comparison]]

    case 'T7_consecutive':
      return [[['연속', '자연수'], comparison]]

    case 'T8_rect':
      return [
        [['직사각형'], ['세로']],
        [['세로'], ['길이']],
      ]

    case 'T8_change': {
      const cm = raw.match(/(\d+)\s*cm/i)?.[1]
      const cmTokens = cm ? [`${cm}cm`, cm, 'cm'] : ['cm']
      return [[cmTokens, ['늘린', '늘어', '늘어난'], ['세로']]]
    }

    case 'T8_length':
      return [[['기차'], ['길이']]]

    case 'T9_distance': {
      const locations = extractLocationTokens(raw)
      const locGroup =
        locations.length >= 2 ?
          locations
        : locations.length === 1 ?
          [...locations, '까지']
        : ['거리']
      return [[locGroup, DISTANCE_SYNONYMS]]
    }

    case 'T9_speed': {
      const speedTokens = extractSpeedTokens(raw)
      return [[speedTokens.length ? speedTokens : ['6km', '시속'], DISTANCE_SYNONYMS]]
    }

    case 'T10': {
      const event = /캠프/.test(raw) ? ['캠프'] : ['수련회']
      return [[event, ['방'], COUNT_SYNONYMS]]
    }

    case 'T11': {
      const person = extractNamedPerson(raw)
      return [[person.length ? person : ['은지', '수진'], ['일한', '일'], ['날', '일수', ...COUNT_SYNONYMS]]]
    }

    case 'T12':
      return [[['원가']]]

    default: {
      const chunks = raw
        .split(/[\s,]+/)
        .map((part) => normalizeStep2Text(part))
        .filter((part) => part.length >= 2)
      const genericStop = new Set(['수', '개수', '개', '것', '때', '데'])
      const specific = chunks.filter((part) => !genericStop.has(part))
      if (specific.length >= 2) {
        return [specific.map((part) => [part])]
      }
      return [chunks.map((part) => [part])]
    }
  }
}

/** 단일 그룹 세트 — 테스트·디버그용 */
export function buildStep2RequiredGroups(expected, type) {
  return buildStep2RequiredGroupSets(expected, type)[0] ?? []
}

function isExactOrFullSemanticMatch(student, expected) {
  const s = normalizeStep2Text(student)
  const e = normalizeStep2Text(expected)
  if (!s || !e) return false
  if (s === e) return true
  if (s.length >= 4 && e.length >= 4 && (s.includes(e) || e.includes(s))) {
    const shorter = s.length <= e.length ? s : e
    const longer = s.length <= e.length ? e : s
    const ratio = shorter.length / longer.length
    // 짧은 부분 답(예: "직사각형"만)이 긴 정답에 포함되어도 ratio 미달이면 불인정
    if (ratio >= 0.72) return true
  }
  return false
}

/**
 * 2단계(x 정하기) 전용 채점 — 필수 의미 그룹 AND / 그룹 내 OR
 * @param {string} studentRaw
 * @param {string} expectedRaw
 */
export function matchesStep2VariableAnswer(studentRaw, expectedRaw) {
  const student = String(studentRaw ?? '').trim()
  if (!student) return false

  const alternatives = parseExpectedAnswerAlternatives(expectedRaw)
  if (!alternatives.length) return false

  return alternatives.some((expected) => {
    const exp = String(expected ?? '').trim()
    if (!exp) return false
    if (isExactOrFullSemanticMatch(student, exp)) return true

    const type = classifyStep2Expected(exp)
    if (type === 'T5') {
      return matchesT5VariableAnswer(student, exp)
    }
    const groupSets = buildStep2RequiredGroupSets(exp, type)
    return anyGroupSetMatches(student, groupSets)
  })
}
