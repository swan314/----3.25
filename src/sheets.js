export const API_URL = (import.meta.env.VITE_API_URL || '').toString().trim()

function getNicknameFromHashSafe() {
  try {
    const hashRaw = (window.location.hash || '').replace(/^#/, '')
    const queryIndex = hashRaw.indexOf('?')
    if (queryIndex === -1) return ''
    const query = hashRaw.slice(queryIndex + 1)
    const params = new URLSearchParams(query)
    return (params.get('nickname') || '').trim()
  } catch (_) {
    return ''
  }
}

function normalizeScoresArray(raw) {
  if (!Array.isArray(raw)) return new Array(6).fill(0)
  const normalized = raw.slice(0, 6).map((v) => (Number(v) > 0 ? 1 : 0))
  while (normalized.length < 6) normalized.push(0)
  return normalized
}

function toSheetRowPayload(payload = {}) {
  const scores = normalizeScoresArray(payload?.scores)
  const score = Number.isFinite(Number(payload?.score))
    ? Number(payload.score)
    : Number.isFinite(Number(payload?.totalScore))
      ? Number(payload.totalScore)
      : Number.isFinite(Number(payload?.total))
        ? Number(payload.total)
        : scores.reduce((sum, v) => sum + v, 0)
  const totalHint = Number.isFinite(Number(payload?.totalHint))
    ? Number(payload.totalHint)
    : Number.isFinite(Number(payload?.hint))
      ? Number(payload.hint)
      : Number.isFinite(Number(payload?.힌트_사용_누적_횟수))
        ? Number(payload.힌트_사용_누적_횟수)
        : 0
  const ai = (payload?.ai ?? payload?.aiFeedback ?? '').toString()
  const item = (
    payload?.item ??
    payload?.trainingItemId ??
    payload?.problemNumber ??
    payload?.문제번호 ??
    ''
  ).toString()
  const phase = (
    payload?.phase ??
    payload?.trainingPhase ??
    payload?.modePhase ??
    payload?.stageTitle ??
    payload?.단계 ??
    payload?.수준단계 ??
    ''
  ).toString()
  const stageCode = String(payload?.학습데이터_단계 ?? payload?.단계 ?? payload?.수준단계 ?? '').trim()
  const typeCode = String(payload?.type ?? payload?.유형 ?? '').trim().toUpperCase()
  const problem = (
    payload?.problem ??
    (stageCode && typeCode ? `${stageCode}-${typeCode}` : '')
  ).toString()

  // 수련 저장 전용 매핑:
  // A(nickname), E~O(수련 데이터), P(status=training_completed), Q(ai)
  // B~D(진단 데이터)는 반드시 빈값으로 전송
  return {
    ...payload,
    nickname: (
      payload?.nickname ??
      payload?.닉네임 ??
      getNicknameFromHashSafe() ??
      '익명'
    ).toString(),
    level: '',
    diag_score: '',
    diag_time: '',
    problem,
    item,
    phase,
    scores,
    score,
    totalScore:
      Number.isFinite(Number(payload?.totalScore)) ? Number(payload.totalScore) : score,
    totalHint,
    ai,
    status: 'training_completed',
  }
}

function normalizeTier(raw) {
  const text = (raw || '').toString().trim()
  if (!text) return '하'
  if (text.includes('최상')) return '최상'
  if (text.includes('상')) return '상'
  if (text.includes('중')) return '중'
  return '하'
}

function toFinitePositiveInt(raw, fallback) {
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return Math.floor(n)
  return fallback
}

function parseCombinedProgress(raw) {
  const text = (raw || '').toString().trim()
  if (!text) return null
  if (!text.includes('-') && !text.includes(',')) return null
  const tokens = text
    .split(/[-,]/)
    .map((v) => Number(String(v).replace(/[^\d.-]/g, '')))
    .filter((v) => Number.isFinite(v) && v > 0)
  if (tokens.length < 2) return null
  return { stage: Math.floor(tokens[0]), problem: Math.floor(tokens[1]) }
}

function parseProblemCode(raw) {
  const text = (raw || '').toString().trim().toUpperCase()
  const match = text.match(/^(\d+)-([A-Z])$/)
  if (!match) return null
  const letterIndex = match[2].charCodeAt(0) - 'A'.charCodeAt(0) + 1
  return {
    stage: Number(match[1]),
    code: match[2],
    index: Number.isFinite(letterIndex) && letterIndex > 0 ? letterIndex : 1,
  }
}

function normalizeStatus(raw) {
  const text = (raw ?? '').toString().trim()
  if (!text) return ''
  if (text === 'diagnostic_completed' || text === '진단완료') return 'diagnostic_completed'
  if (text === 'training_completed' || text === '수련완료' || text === 'completed') return 'training_completed'
  if (text === 'in_progress') return 'in_progress'
  return text
}

function readRecordStatus(record) {
  return normalizeStatus(
    record?.status ??
      record?.상태 ??
      record?.P ??
      record?.p ??
      record?.['P열'] ??
      record?.['status(P)'] ??
      ''
  )
}

function toTimestampMs(record, fallbackIndex = 0) {
  const candidates = [
    record?.completionDate,
    record?.completedAt,
    record?.diag_time,
    record?.timestamp,
    record?.createdAt,
    record?.updatedAt,
  ]
  for (const c of candidates) {
    const ms = Date.parse((c ?? '').toString())
    if (Number.isFinite(ms)) return ms
  }
  return fallbackIndex
}

function flattenRecords(raw) {
  const out = []
  const seen = new Set()
  const pushObj = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
    if (seen.has(obj)) return
    seen.add(obj)
    out.push(obj)
  }
  const pushTableRows = (arr) => {
    if (!Array.isArray(arr) || arr.length < 2) return false
    const headerRow = arr[0]
    const dataRows = arr.slice(1)
    if (!Array.isArray(headerRow) || !headerRow.every((h) => typeof h === 'string')) return false
    if (!dataRows.every((row) => Array.isArray(row))) return false
    const headers = headerRow.map((h) => String(h || '').trim())
    dataRows.forEach((row) => {
      const obj = {}
      headers.forEach((h, idx) => {
        obj[h] = row[idx]
      })
      pushObj(obj)
    })
    return true
  }
  const walk = (value, depth = 0) => {
    if (depth > 4 || value == null) return
    if (Array.isArray(value)) {
      if (pushTableRows(value)) return
      value.forEach((entry) => walk(entry, depth + 1))
      return
    }
    if (typeof value !== 'object') return
    pushObj(value)
    Object.values(value).forEach((entry) => walk(entry, depth + 1))
  }
  walk(raw)
  return out
}

function parseJsonLoose(rawText) {
  const text = (rawText || '').toString().trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (_) {
    // Apps Script/Proxy가 앞뒤에 텍스트를 붙이는 경우를 위한 폴백
    const startObj = text.indexOf('{')
    const endObj = text.lastIndexOf('}')
    if (startObj !== -1 && endObj > startObj) {
      const sliced = text.slice(startObj, endObj + 1)
      try {
        return JSON.parse(sliced)
      } catch (_) {
        // noop
      }
    }
    const startArr = text.indexOf('[')
    const endArr = text.lastIndexOf(']')
    if (startArr !== -1 && endArr > startArr) {
      const sliced = text.slice(startArr, endArr + 1)
      try {
        return JSON.parse(sliced)
      } catch (_) {
        // noop
      }
    }
  }
  return {}
}

function getDefaultProgress() {
  return {
    hasRecord: false,
    hasDiagnosticResult: false,
    diagnosticTier: '하',
    diagnosticRecord: { level: '' },
    trainingCompletedCount: 0,
    lastLearningStage: 1,
    lastProblemNumber: 1,
    problem: '',
    status: '',
    type: '',
    hasTrainingCompletion: false,
    total: 0,
  }
}

function pickRecord(data) {
  if (!data || typeof data !== 'object') return {}

  const explicit =
    data.data?.record ||
    data.data?.latest ||
    data.data?.student ||
    data.record ||
    data.latest ||
    data.student ||
    null

  if (explicit && typeof explicit === 'object') {
    return { ...data, ...explicit }
  }

  const wrapped = data.data
  if (wrapped && typeof wrapped === 'object') {
    if (Array.isArray(wrapped)) {
      const first = wrapped[0]
      if (first && typeof first === 'object') return { ...data, ...first }
    } else {
      // 예: { found: true, data: { diagnosticLevel: '중(삼장)', ... } }
      return { ...data, ...wrapped }
    }
  }

  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    return { ...data, ...data[0] }
  }

  return data
}

function hasNumericDiagnosticScore(raw) {
  if (raw === undefined || raw === null || raw === '') return false
  return Number.isFinite(Number(raw))
}

function parseProgressFromData(data) {
  console.log('[student-progress] parsed data', data)
  const records = flattenRecords(data).map((record, idx) => ({
    ...record,
    __status: readRecordStatus(record),
    __timestamp: toTimestampMs(record, idx),
  }))
  console.log('[student-progress] flattened record count', records.length)

  // 진단 여부는 "진단완료 status 존재 여부"만으로 판단한다.
  const diagnosticRecords = records.filter((record) => record.__status === 'diagnostic_completed')
  const trainingRecords = records.filter((record) => record.__status === 'training_completed')
  const latestTrainingRecord = trainingRecords
    .slice()
    .sort((a, b) => Number(a.__timestamp || 0) - Number(b.__timestamp || 0))
    .at(-1)
  const latestDiagnosticRecord = diagnosticRecords
    .slice()
    .sort((a, b) => Number(a.__timestamp || 0) - Number(b.__timestamp || 0))
    .at(-1)

  console.log('[student-progress] diagnostic/training counts', {
    diagnostic: diagnosticRecords.length,
    training: trainingRecords.length,
  })
  const hasDiagnosticResult = diagnosticRecords.length > 0
  console.log('[student-progress] hasDiagnosticResult:', hasDiagnosticResult)
  console.log('[student-progress] latestTraining:', latestTrainingRecord)

  const sourceRecord = latestTrainingRecord || latestDiagnosticRecord || records[0] || {}
  const combinedProgress =
    parseCombinedProgress(sourceRecord.lastProgress) ||
    parseCombinedProgress(sourceRecord.resumePoint) ||
    parseCombinedProgress(sourceRecord.이어하기) ||
    parseCombinedProgress(sourceRecord.progress)
  const parsedProblemCode = parseProblemCode(sourceRecord.problem ?? sourceRecord.문항번호 ?? '')

  const diagnosticTier = normalizeTier(
    latestDiagnosticRecord?.level ||
      latestDiagnosticRecord?.diagnosticTier ||
      latestDiagnosticRecord?.diagnosticLevel ||
      latestDiagnosticRecord?.userLevel
  )

  return {
    hasRecord: records.length > 0 || Boolean(data?.found),
    hasDiagnosticResult,
    diagnosticTier,
    diagnosticRecord: {
      level: hasDiagnosticResult ? diagnosticTier : '',
    },
    trainingCompletedCount: trainingRecords.length,
    lastLearningStage: toFinitePositiveInt(
      parsedProblemCode?.stage ??
        combinedProgress?.stage ??
        sourceRecord.lastLearningStage ??
        sourceRecord.수준단계 ??
        sourceRecord.stageNumber ??
        sourceRecord.level,
      1
    ),
    lastProblemNumber: toFinitePositiveInt(
      parsedProblemCode?.index ??
        combinedProgress?.problem ??
        sourceRecord.lastProblemNumber ??
        sourceRecord.문제번호 ??
        sourceRecord.problemNumber ??
        sourceRecord.questionNumber,
      1
    ),
    status: readRecordStatus(sourceRecord),
    type: (sourceRecord.type ?? sourceRecord.유형 ?? '').toString().trim(),
    problem: (sourceRecord.problem ?? sourceRecord.문항번호 ?? '').toString().trim(),
    latestTrainingRecord: latestTrainingRecord
      ? {
          problem: (latestTrainingRecord.problem ?? latestTrainingRecord.문항번호 ?? '').toString().trim(),
          type: (latestTrainingRecord.type ?? latestTrainingRecord.유형 ?? '').toString().trim(),
          total: Number.isFinite(Number(latestTrainingRecord.total)) ? Number(latestTrainingRecord.total) : 0,
          status: readRecordStatus(latestTrainingRecord),
        }
      : null,
    hasTrainingCompletion: Boolean(latestTrainingRecord),
    total: Number.isFinite(Number(sourceRecord.total)) ? Number(sourceRecord.total) : 0,
  }
}

/**
 * 보조 학습 로그(빈칸 입력, 수련 모드 단계 로그 등)를 Google Apps Script 웹훅으로 전송합니다.
 * .env의 VITE_API_URL을 사용합니다.
 */
export async function updateSupplement(payload) {
  const url = API_URL
  const normalizedPayload = toSheetRowPayload(payload)

  if (!url) {
    console.warn('[Sheets] updateSupplement: no webhook URL')
    return { ok: false, reason: 'missing_webhook' }
  }

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',   // ⭐ 추가
      body: JSON.stringify(normalizedPayload),
    })

    return { ok: true }
  } catch (error) {
    console.error('[Sheets] updateSupplement:error', error)
    return { ok: false, reason: 'network_error', message: error?.message || 'unknown_error' }
  }
}

/**
 * 닉네임 기준으로 기존 진단/학습 진행 기록을 조회합니다.
 * Apps Script 쪽에서 JSON 응답을 제공한다고 가정합니다.
 */
export async function fetchStudentLearningProgress(nickname) {
  const url = API_URL
  const trimmedNickname = (nickname || '').toString().trim()
  console.log('[student-progress] fetchStudentLearningProgress entered', {
    nickname,
    trimmedNickname,
    hasApiUrl: Boolean(url),
  })
  if (!url || !trimmedNickname) {
    console.warn('[student-progress] early return default progress', {
      reason: !url ? 'missing_api_url' : 'missing_nickname',
    })
    return getDefaultProgress()
  }

  try {
    const reqUrl = `${url}?nickname=${encodeURIComponent(trimmedNickname)}`
    console.log('[student-progress] GET request url', reqUrl)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    console.log('[student-progress] GET response status', {
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      url: res.url,
    })
    if (!res.ok) throw new Error(`학생 기록 조회 실패 (${res.status})`)
    const rawText = await res.text()
    console.log('[student-progress] raw response text', rawText)

    const data = parseJsonLoose(rawText)
    if (!data || (typeof data === 'object' && !Array.isArray(data) && !Object.keys(data).length)) {
      console.warn('[student-progress] parsed data is empty after loose parse')
    }

    return parseProgressFromData(data)
  } catch (error) {
    console.error('[Sheets] fetchStudentLearningProgress:error', {
      message: error?.message || 'unknown_error',
      name: error?.name || 'Error',
      stack: error?.stack || '',
    })
    return getDefaultProgress()
  }
}