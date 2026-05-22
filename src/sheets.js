import {
  normalizeClassCode,
  normalizeTeacherEmailForCompare,
  readNicknameFromRecord,
  readStudentQueryParams,
  recordMatchesLearner,
} from './classCode.js'
import { resolveCanonicalDiagnosticTier } from './levelConfig.js'
import {
  applySheetProblemOutcomeLists,
  computeTrainingProblemProgressByCode,
  computeTrainingProgressMapByProblem,
} from './training/trainingProblemProgress.js'
import {
  collectFailedProblemCodesFromRecords,
  collectSuccessProblemCodesFromRecords,
  isDiagnosticSheetStatus,
  normalizeProblemCodeList,
  resolveRecordSheetStatus,
  resolveTrainingSaveStatus,
  SHEET_STATUS,
} from './training/trainingStatus.js'
import {
  analyzeStudentStepResult,
  buildAiFeedbackPrompt,
  enrichAnalysisWithOverallPerformance,
  generateFallbackFeedback,
  sanitizeStudentFeedback,
} from './training/studentAiFeedback.js'

export const API_URL = (import.meta.env.VITE_API_URL || '').toString().trim()

/** 구글 시트 셀당 최대 약 50,000자 — AI 피드백(ai 열) 저장 시 상한 */
export const AI_FEEDBACK_STORAGE_MAX_CHARS = 50000

/**
 * 로컬 개발에서만 `VITE_API_PROXY=/api/gas`(vite.config 프록시)로 일부 POST JSON 수신(AI 등).
 * 프로덕션 빌드에서는 `VITE_API_URL`(Netlify 빌드 시 env 주입) 직결.
 * 관리자 `create_class`는 GET `API_URL`(클래스 목록 조회와 동일). POST는 AI 등만 `/api/gas` 프록시.
 */
export function resolveGasWebhookPostUrl() {
  const p = (import.meta.env.VITE_API_PROXY || '').toString().trim()
  if (import.meta.env.DEV && p) return p.startsWith('/') ? p : `/${p}`
  return API_URL
}

function resolveAiFeedbackPostUrl() {
  return resolveGasWebhookPostUrl()
}

function getNicknameFromHashSafe() {
  try {
    return readStudentQueryParams().nickname
  } catch (_) {
    return ''
  }
}

function getClassCodeFromHashSafe() {
  try {
    return readStudentQueryParams().classCode
  } catch (_) {
    return normalizeClassCode()
  }
}

function normalizeScoresArray(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => {
    if (v === '' || v == null) return ''
    if (v === 0 || v === '0') return 0
    return Number(v) > 0 ? 1 : 0
  })
}

function toSheetRowPayload(payload = {}) {
  const statusRaw = normalizeStatus(payload?.status)
  const isDiagnostic = isDiagnosticSheetStatus(statusRaw)
  const scores = isDiagnostic ? [] : normalizeScoresArray(payload?.scores)
  const scoreFromSteps = scores.filter((v) => v === 0 || v === 1).reduce((sum, v) => sum + Number(v), 0)
  const score = isDiagnostic
    ? ''
    : Number.isFinite(Number(payload?.score))
      ? Number(payload.score)
      : Number.isFinite(Number(payload?.totalScore))
        ? Number(payload.totalScore)
        : Number.isFinite(Number(payload?.total))
          ? Number(payload.total)
          : scoreFromSteps
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
  // A(nickname), …, classCode(시트에 매핑), E~O(수련 데이터), P(status=training_completed), Q(ai)
  // B~D(진단 데이터)는 반드시 빈값으로 전송
  const classCode = normalizeClassCode(
    payload?.classCode ?? payload?.클래스코드 ?? getClassCodeFromHashSafe()
  )
  const failRaw = payload?.fail_count ?? payload?.failCount
  const totalRaw = payload?.total ?? payload?.successCount

  return {
    ...payload,
    nickname: (
      payload?.nickname ??
      payload?.닉네임 ??
      getNicknameFromHashSafe() ??
      '익명'
    ).toString(),
    classCode,
    level: isDiagnostic ? String(payload?.level ?? '').trim() : '',
    diag_score: isDiagnostic
      ? payload?.diag_score ?? payload?.score ?? payload?.totalScore ?? ''
      : '',
    diag_time: isDiagnostic
      ? String(payload?.diag_time ?? payload?.completedAt ?? '').trim()
      : '',
    problem: isDiagnostic ? '' : problem,
    item: isDiagnostic ? '' : item,
    phase: isDiagnostic ? '' : phase,
    scores,
    score: isDiagnostic ? '' : score,
    total: isDiagnostic ? '' : totalRaw,
    totalScore: isDiagnostic ? '' : Number.isFinite(Number(payload?.totalScore)) ? Number(payload.totalScore) : score,
    fail_count: isDiagnostic ? '' : failRaw,
    failCount: isDiagnostic ? '' : failRaw,
    totalHint: isDiagnostic ? '' : totalHint,
    ai: isDiagnostic ? (payload?.ai ?? '').toString() : ai,
    status: isDiagnostic
      ? SHEET_STATUS.DIAGNOSTIC
      : statusRaw || resolveTrainingSaveStatus(payload?.type ?? payload?.유형, failRaw),
  }
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
  return resolveRecordSheetStatus({ status: raw })
}

export function readRecordStatus(record) {
  return resolveRecordSheetStatus(record)
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
    trainingProblemProgressByCode: {},
    trainingProgressMapByProblem: {},
    successProblemCodes: [],
    completedProblemCodes: [],
    completedProblems: [],
    failedProblems: [],
    failedRecords: [],
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
      // 예: { found: true, data: { diagnosticLevel: '삼장(중)' 등 } }
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

function parseProgressFromData(data, learnerFilter = null) {
  console.log('[student-progress] parsed data', data)
  let baseRecords = []
  if (Array.isArray(data?.records) && data.records.length > 0) {
    baseRecords = finalizeAdminHistoryRecords(data.records)
  } else {
    baseRecords = flattenRecords(data)
  }

  let records = baseRecords.map((record, idx) => ({
    ...record,
    __status: readRecordStatus(record),
    __timestamp: adminHistoryRowTimeMsForSort(record) || toTimestampMs(record, idx),
  }))
  console.log('[student-progress] flattened record count', records.length)

  const filterNick = (learnerFilter?.nickname || '').toString().trim()
  const filterClass = normalizeClassCode(learnerFilter?.classCode)
  const classOptional = Boolean(learnerFilter?.classOptional)
  if (filterNick) {
    const before = records.length
    records = records.filter((r) =>
      recordMatchesLearner(r, filterNick, filterClass, { classOptional })
    )
    console.log('[student-progress] learner filter', {
      nickname: filterNick,
      classCode: filterClass,
      before,
      after: records.length,
    })
  }

  const diagnosticRecords = records.filter((record) =>
    isDiagnosticSheetStatus(record.__status),
  )
  const trainingRecords = records.filter(
    (record) =>
      record.__status === SHEET_STATUS.SUCCESS || record.__status === SHEET_STATUS.FAIL,
  )
  const successProblemCodes = [...collectSuccessProblemCodesFromRecords(trainingRecords)]
  const failedRecordsFromApi = Array.isArray(data?.failedRecords)
    ? finalizeAdminHistoryRecords(data.failedRecords)
    : []
  let completedProblems = Array.isArray(data?.completedProblems)
    ? normalizeProblemCodeList(data.completedProblems)
    : successProblemCodes
  const completedSet = new Set(completedProblems)
  let failedProblems
  if (Array.isArray(data?.failedProblems)) {
    failedProblems = normalizeProblemCodeList(data.failedProblems)
  } else if (failedRecordsFromApi.length > 0) {
    failedProblems = collectFailedProblemCodesFromRecords(failedRecordsFromApi)
  } else {
    failedProblems = collectFailedProblemCodesFromRecords(trainingRecords)
  }
  failedProblems = failedProblems.filter((code) => !completedSet.has(code))
  const latestTrainingRecord = trainingRecords
    .slice()
    .sort((a, b) => Number(a.__timestamp || 0) - Number(b.__timestamp || 0))
    .at(-1)
  const latestDiagnosticRecord = diagnosticRecords
    .slice()
    .sort((a, b) => Number(a.__timestamp || 0) - Number(b.__timestamp || 0))
    .at(-1)

  const trainingProblemProgressByCode = applySheetProblemOutcomeLists(
    computeTrainingProblemProgressByCode(trainingRecords),
    completedProblems,
    failedProblems,
  )
  const trainingProgressMapByProblem = computeTrainingProgressMapByProblem(trainingProblemProgressByCode)

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

  const diagnosticTier = resolveCanonicalDiagnosticTier(
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
    trainingProblemProgressByCode,
    trainingProgressMapByProblem,
    successProblemCodes,
    completedProblemCodes: completedProblems,
    completedProblems,
    failedProblems,
    failedRecords: failedRecordsFromApi.length
      ? failedRecordsFromApi
      : trainingRecords.filter((r) => r.__status === SHEET_STATUS.FAIL),
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

/** UTF-8 문자열 → Base64 (Apps Script Utilities.base64Decode 호환) */
function utf8ToBase64(str) {
  const s = String(str)
  try {
    return btoa(unescape(encodeURIComponent(s)))
  } catch {
    return btoa(s)
  }
}

/**
 * 맥락 객체를 JSON으로 만들고 길이 제한 내에서 잘라 Base64 `payload` 한 개로 전달(JSONP URL 길이 한계 대비).
 */
export function buildTrainingAiFeedbackPayloadBlob(context = {}) {
  const clamp = (t, n) => (t || '').toString().slice(0, n)
  const trimSteps = (steps, qLim, aLim) =>
    (Array.isArray(steps) ? steps : []).map((s) => ({
      stepNumber: Number(s.stepNumber) || 0,
      meaning: clamp(s.meaning, 80),
      success: Boolean(s.success),
      label: clamp(s.label, 120),
      questionPreview: clamp(s.questionPreview ?? s.question, qLim),
      studentAnswer: clamp(s.studentAnswer, aLim),
      correctAnswer: clamp(s.correctAnswer, aLim),
    }))

  let problemTextLim = 3500
  let qaLim = 420
  let qPrevLim = 280
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const blob = {
      v: 2,
      problem: clamp(context.problem, 120),
      trainingType: clamp(context.trainingType ?? context.type, 80),
      problemText: clamp(context.problemText, problemTextLim),
      total: Number(context.total) || 0,
      hint: Number(context.hint ?? context.totalHint) || 0,
      steps: trimSteps(context.steps, qPrevLim, qaLim),
    }
    const json = JSON.stringify(blob)
    const b64 = utf8ToBase64(json)
    // 전체 URL 여유(웹앱 주소·callback 등) 고려 ~7500자 상한
    if (b64.length <= 6800) {
      return b64
    }
    problemTextLim = Math.max(400, Math.floor(problemTextLim * 0.65))
    qaLim = Math.max(180, Math.floor(qaLim * 0.75))
    qPrevLim = Math.max(120, Math.floor(qPrevLim * 0.75))
  }
  const minimal = {
    v: 2,
    problem: clamp(context.problem, 120),
    trainingType: clamp(context.trainingType ?? context.type, 80),
    problemText: clamp(context.problemText, 400),
    total: Number(context.total) || 0,
    hint: Number(context.hint ?? context.totalHint) || 0,
    steps: trimSteps(context.steps, 100, 120),
  }
  return utf8ToBase64(JSON.stringify(minimal))
}

/**
 * generate_ai_feedback용 payload — v4: 분석 결과만 전달 (문제 본문 제외)
 */
export function buildGenerateAiFeedbackPayloadBlob(aiPayload) {
  const analysis = enrichAnalysisWithOverallPerformance(
    aiPayload?.analysis && typeof aiPayload.analysis === 'object'
      ? aiPayload.analysis
      : analyzeStudentStepResult(aiPayload),
  )
  return utf8ToBase64(JSON.stringify({ v: 4, analysis }))
}

function fetchAiFeedbackJsonpV3(aiPayload) {
  const base = API_URL
  if (!base) {
    return Promise.resolve({ ok: false, reason: 'missing_api_url' })
  }
  let u
  try {
    u = new URL(base, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
  } catch {
    return Promise.resolve({ ok: false, reason: 'invalid_api_url' })
  }
  u.searchParams.set('action', 'ai_feedback')
  u.searchParams.set('payload', buildGenerateAiFeedbackPayloadBlob(aiPayload))
  const cbName = `__mm_ai_cb_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
  u.searchParams.set('callback', cbName)

  return new Promise((resolve) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => {
      cleanup()
      resolve({ ok: false, reason: 'timeout' })
    }, 45000)
    function cleanup() {
      window.clearTimeout(timer)
      try {
        delete window[cbName]
      } catch {
        // ignore
      }
      if (script.parentNode) script.parentNode.removeChild(script)
    }
    window[cbName] = (data) => {
      cleanup()
      if (data && typeof data === 'object') {
        resolve(data)
      } else {
        resolve({ ok: false, reason: 'invalid_payload' })
      }
    }
    script.onerror = () => {
      cleanup()
      resolve({ ok: false, reason: 'script_error' })
    }
    script.src = u.toString()
    document.head.appendChild(script)
  })
}

/** @deprecated studentAiFeedback.sanitizeStudentFeedback / generateFallbackFeedback 사용 */
export function buildShortCoachingFeedback(rawFeedback, aiPayload) {
  const analysis = analyzeStudentStepResult(aiPayload)
  const cleaned = sanitizeStudentFeedback(rawFeedback, analysis)
  if (cleaned) return cleaned.slice(0, AI_FEEDBACK_STORAGE_MAX_CHARS).trim()
  return generateFallbackFeedback(analysis).slice(0, AI_FEEDBACK_STORAGE_MAX_CHARS).trim()
}

/**
 * Apps Script doPost `action: generate_ai_feedback` — 동일 맥락을 시트 ai 열에 저장.
 * 브라우저→GAS 직결 시 CORS로 응답을 못 읽을 수 있음 → 로컬은 `VITE_API_PROXY=/api/gas` 권장.
 * 실패 시 JSONP(doGet ai_feedback + v3 payload)로 폴백.
 */
export async function postGenerateAiFeedback(aiPayload) {
  const analysis =
    aiPayload?.analysis && typeof aiPayload.analysis === 'object'
      ? aiPayload.analysis
      : analyzeStudentStepResult(aiPayload)
  const enriched = enrichAnalysisWithOverallPerformance(analysis)
  const requestData = { v: 4, analysis: enriched, prompt: buildAiFeedbackPrompt(enriched) }

  const postUrl = resolveAiFeedbackPostUrl()
  console.log('[AI] generate_ai_feedback POST route:', postUrl)
  if (!postUrl) {
    return { ok: false, reason: 'missing_api_url' }
  }
  try {
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate_ai_feedback', data: requestData }),
    })
    console.log('[AI] generate_ai_feedback POST success:', res.ok, 'status:', res.status)
    const rawText = await res.text()
    console.log('[AI] generate_ai_feedback POST response body:', rawText)
    let data = null
    try {
      data = JSON.parse(rawText)
    } catch {
      data = null
    }
    const fb = data && String(data.feedback ?? '').trim()
    const isSuccessResponse =
      data &&
      (String(data.result || '').toLowerCase() === 'success' ||
        data.ok === true ||
        Boolean(fb))
    if (res.ok && isSuccessResponse) {
      const feedback = sanitizeStudentFeedback(String(data.feedback ?? '').trim(), analysis)
      return {
        ok: true,
        feedback: feedback || generateFallbackFeedback(analysis),
      }
    }
  } catch (err) {
    console.warn('[Sheets] postGenerateAiFeedback POST', err)
  }
  console.log('[AI] fallback JSONP used')
  const fallbackRes = await fetchAiFeedbackJsonpV3(requestData)
  if (fallbackRes?.ok) {
    const feedback = sanitizeStudentFeedback(String(fallbackRes.feedback ?? '').trim(), analysis)
    return {
      ...fallbackRes,
      feedback: feedback || generateFallbackFeedback(analysis),
    }
  }
  return { ...fallbackRes, feedback: generateFallbackFeedback(analysis) }
}

/**
 * 닉네임 + 클래스 코드 기준으로 기존 진단/학습 진행 기록을 조회합니다.
 * Google Apps Script **Sheet2** 기준 (getTargetSheet_).
 */
/**
 * 닉네임으로 시트에서 학습자 행을 조회한 뒤, 클래스 코드가 유일하면 반환합니다.
 * 동일 닉네임이 서로 다른 classCode로 여러 번 기록된 경우 ambiguous입니다.
 */
export function analyzeNicknameClassBinding(data, nickname) {
  const nick = (nickname || '').toString().trim()
  if (!nick) return { classCode: null, ambiguous: false, recordCount: 0 }

  let records = flattenRecords(data).map((record, idx) => ({
    ...record,
    __status: readRecordStatus(record),
    __timestamp: toTimestampMs(record, idx),
  }))
  records = records.filter((r) => recordMatchesLearner(r, nick, '', { classOptional: true }))

  const classSet = new Set()
  for (const r of records) {
    classSet.add(normalizeClassCode(readClassCodeFromRecord(r)))
  }
  const unique = [...classSet]
  if (unique.length > 1) {
    return { classCode: null, ambiguous: true, recordCount: records.length }
  }
  if (unique.length === 1) {
    return { classCode: unique[0], ambiguous: false, recordCount: records.length }
  }
  return { classCode: null, ambiguous: false, recordCount: 0 }
}

/**
 * 닉네임만으로 GET 조회 (classCode 쿼리 없음).
 * Apps Script doGet: { found, resolvedClassCode?, multipleClassCodes }
 */
export async function fetchStudentRecordsByNickname(nickname) {
  const url = API_URL
  const trimmedNickname = (nickname || '').toString().trim()
  if (!url || !trimmedNickname) {
    return { ok: false, reason: !url ? 'missing_api_url' : 'missing_nickname', data: {} }
  }

  try {
    const q = new URLSearchParams()
    q.set('nickname', trimmedNickname)
    const reqUrl = `${url}?${q.toString()}`
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, data: {} }
    }
    const rawText = await res.text()
    const data = parseJsonLoose(rawText)
    if (data && typeof data === 'object' && Object.keys(data).length) {
      return { ok: true, data }
    }
  } catch (error) {
    console.warn('[Sheets] fetchStudentRecordsByNickname failed', error?.message || error)
  }
  return { ok: false, reason: 'fetch_failed', data: {} }
}

export async function resolveClassCodeFromNicknameLookup(nickname) {
  const res = await fetchStudentRecordsByNickname(nickname)
  if (!res.ok) {
    return {
      classCode: null,
      ambiguous: false,
      recordCount: 0,
      ok: false,
      reason: res.reason,
    }
  }
  const data = res.data
  if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'found')) {
    const found = Boolean(data.found)
    const multiple = Boolean(data.multipleClassCodes)
    const rawResolved = data.resolvedClassCode
    const resolved =
      rawResolved != null && String(rawResolved).trim() !== ''
        ? normalizeClassCode(String(rawResolved))
        : null
    if (multiple) {
      return { classCode: null, ambiguous: true, recordCount: 0, ok: true, source: 'doGet' }
    }
    if (!found) {
      return { classCode: null, ambiguous: false, recordCount: 0, ok: true, source: 'doGet' }
    }
    if (resolved) {
      return { classCode: resolved, ambiguous: false, recordCount: 1, ok: true, source: 'doGet' }
    }
    return { classCode: null, ambiguous: false, recordCount: 0, ok: true, source: 'doGet' }
  }
  const binding = analyzeNicknameClassBinding(data, nickname)
  return { ...binding, ok: true, source: 'flatten' }
}

export async function fetchStudentLearningProgress(nickname, classCode) {
  const url = API_URL
  const trimmedNickname = (nickname || '').toString().trim()
  const trimmedClass = normalizeClassCode(classCode)
  console.log('[student-progress] fetchStudentLearningProgress entered', {
    nickname,
    trimmedNickname,
    classCode: trimmedClass,
    hasApiUrl: Boolean(url),
  })
  if (!url || !trimmedNickname) {
    console.warn('[student-progress] early return default progress', {
      reason: !url ? 'missing_api_url' : 'missing_nickname',
    })
    return getDefaultProgress()
  }

  try {
    let historyPayload = null
    try {
      const histRes = await fetchAdminStudentLearningHistory(trimmedNickname, trimmedClass)
      if (histRes.ok && Array.isArray(histRes.records) && histRes.records.length > 0) {
        historyPayload = {
          records: histRes.records,
          completedProblems: histRes.completedProblems,
          failedProblems: histRes.failedProblems,
          failedRecords: histRes.failedRecords,
        }
      }
    } catch (histErr) {
      console.warn('[student-progress] student_history failed, will try legacy GET', histErr)
    }

    if (historyPayload) {
      return parseProgressFromData(historyPayload, {
        nickname: trimmedNickname,
        classCode: trimmedClass,
      })
    }

    const q = new URLSearchParams()
    q.set('nickname', trimmedNickname)
    q.set('classCode', trimmedClass)
    const reqUrl = `${url}?${q.toString()}`
    console.log('[student-progress] GET request url (legacy)', reqUrl)
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

    return parseProgressFromData(data, { nickname: trimmedNickname, classCode: trimmedClass })
  } catch (error) {
    console.error('[Sheets] fetchStudentLearningProgress:error', {
      message: error?.message || 'unknown_error',
      name: error?.name || 'Error',
      stack: error?.stack || '',
    })
    return getDefaultProgress()
  }
}

/**
 * 관리자 대시보드: GET …?action=class_roster&classCode=…
 * 응답: `{ result: 'success', students: [ { nickname, level, diag_score, hasDiagnosticResult, … } ] }`
 * (구버전 `{ ok, roster }` 도 일부 지원)
 */
function mapLegacyRosterToStudentRow(entry) {
  const nick = String(entry?.nickname ?? entry?.닉네임 ?? '').trim()
  const level = String(entry?.diagnosticTier ?? entry?.level ?? '').trim()
  const lastStatus = String(entry?.lastStatus ?? entry?.status ?? '').trim()
  return {
    nickname: nick,
    level,
    diag_score: Number.isFinite(Number(entry?.diag_score)) ? Math.round(Number(entry.diag_score)) : 0,
    hasDiagnosticResult: Boolean(
      entry?.hasDiagnosticResult ?? (level !== '' || Number(entry?.diag_score) > 0),
    ),
    latestProblem: String(entry?.latestProblem ?? entry?.problem ?? '').trim(),
    latestType: String(entry?.latestType ?? entry?.type ?? '').trim(),
    latestTotal: Number.isFinite(Number(entry?.latestTotal ?? entry?.total))
      ? Number(entry.latestTotal ?? entry.total)
      : 0,
    latestStatus: lastStatus || '—',
    lastActivity: formatAdminSeoulSheetTimestamp(
      String(entry?.lastActivity ?? entry?.timestamp ?? '').trim(),
    ),
    mainSuccessCount: Number.isFinite(Number(entry?.mainSuccessCount))
      ? Number(entry.mainSuccessCount)
      : 0,
    mainFailCount: Number.isFinite(Number(entry?.mainFailCount)) ? Number(entry.mainFailCount) : 0,
    similarSuccessCount: Number.isFinite(Number(entry?.similarSuccessCount))
      ? Number(entry.similarSuccessCount)
      : 0,
    similarFailCount: Number.isFinite(Number(entry?.similarFailCount))
      ? Number(entry.similarFailCount)
      : 0,
    mathCardCount: Number.isFinite(Number(entry?.mathCardCount)) ? Number(entry.mathCardCount) : 0,
  }
}

export async function fetchClassRoster(classCode) {
  const url = API_URL
  const code = normalizeClassCode(classCode)
  if (!url) {
    return { ok: false, reason: 'missing_api_url', rows: [] }
  }
  try {
    const q = new URLSearchParams()
    q.set('action', 'class_roster')
    q.set('classCode', code)
    const reqUrl = `${url}?${q.toString()}`
    console.log('[admin roster] request url:', reqUrl)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`목록 조회 실패 (${res.status})`)
    const rawText = await res.text()
    const data = parseJsonLoose(rawText)
    console.log('[admin roster] response:', data)

    if (String(data?.result || '').toLowerCase() === 'error') {
      return {
        ok: false,
        reason: 'roster_api',
        message: String(data?.message || 'class_roster 조회 실패'),
        rows: [],
      }
    }

    if (String(data?.result || '').toLowerCase() === 'success') {
      return { ok: true, rows: Array.isArray(data.students) ? data.students : [] }
    }

    if (Array.isArray(data?.students)) {
      return { ok: true, rows: data.students }
    }

    const roster = data?.roster ?? data?.data?.roster
    if (Array.isArray(roster) && roster.length > 0 && typeof roster[0] === 'object' && !Array.isArray(roster[0])) {
      if (data?.ok === false) {
        return { ok: false, reason: 'roster_api', message: String(data?.error || ''), rows: [] }
      }
      return { ok: true, rows: roster.map(mapLegacyRosterToStudentRow) }
    }
    if (Array.isArray(roster) && roster.length === 0 && data?.ok !== false) {
      return { ok: true, rows: [] }
    }

    const direct = data?.rows || data?.data?.students || null
    if (Array.isArray(direct) && direct.length && typeof direct[0] === 'object' && !Array.isArray(direct[0])) {
      return { ok: true, rows: direct }
    }
    const flat = flattenRecords(data)
    const asObjects = flat.filter((r) => readNicknameFromRecord(r))
    return { ok: true, rows: asObjects }
  } catch (error) {
    console.error('[Sheets] fetchClassRoster:error', error)
    return {
      ok: false,
      reason: 'network_or_parse',
      message: error?.message || 'unknown_error',
      rows: [],
    }
  }
}

/**
 * 관리자: GET ?action=class_problem_stats&classCode= — 문제×유형 수련 통계
 * @returns {{ ok: boolean, stats: object[], records?: object[], problems?: string[], reason?: string, message?: string }}
 */
export async function fetchClassProblemLearningStats(classCode) {
  const url = API_URL
  const code = normalizeClassCode(classCode)
  if (!url) {
    return { ok: false, reason: 'missing_api_url', message: '', stats: [], records: [], problems: [] }
  }
  if (!code) {
    return { ok: false, reason: 'missing_class_code', message: '', stats: [], records: [], problems: [] }
  }
  try {
    const q = new URLSearchParams()
    q.set('action', 'class_problem_stats')
    q.set('classCode', code)
    const reqUrl = `${url}?${q.toString()}`
    console.log('[admin problem stats] request url:', reqUrl)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, message: '', stats: [], records: [], problems: [] }
    }
    const rawText = await res.text()
    const data = parseJsonLoose(rawText)
    console.log('[admin problem stats] response:', data)
    if (String(data?.result || '').toLowerCase() === 'error') {
      return {
        ok: false,
        reason: 'problem_stats_api',
        message: String(data?.message || 'class_problem_stats 조회 실패'),
        stats: [],
        records: [],
        problems: [],
      }
    }
    if (String(data?.result || '').toLowerCase() === 'success' && Array.isArray(data.stats)) {
      const records = Array.isArray(data.records) ? data.records : []
      const problems = Array.isArray(data.problems) ? data.problems : []
      console.log('[problem stats] raw records:', records)
      console.log('[problem stats] grouped stats:', data.stats)
      return { ok: true, stats: data.stats, records, problems }
    }
    return { ok: false, reason: 'unexpected_shape', message: '', stats: [], records: [], problems: [] }
  } catch (error) {
    console.error('[Sheets] fetchClassProblemLearningStats:error', error)
    return {
      ok: false,
      reason: 'network_or_parse',
      message: error?.message || 'unknown_error',
      stats: [],
      records: [],
      problems: [],
    }
  }
}

export function sheetStatusLabelForAdmin(record) {
  const ns = record.__status ?? readRecordStatus(record)
  if (ns === SHEET_STATUS.SUCCESS) return '성공'
  if (ns === SHEET_STATUS.FAIL) return '실패'
  if (ns === 'training_completed' || ns === '수련완료') return '수련완료'
  if (ns === SHEET_STATUS.DIAGNOSTIC || ns === 'diagnostic_completed') return '진단완료'
  if (ns === 'in_progress') return '진행중'
  const raw = String(record?.status ?? '').trim()
  return raw || '—'
}

export function formatAdminHistoryTimestamp(record) {
  const v = record.timestamp ?? record.completionDate ?? record.completedAt ?? record.diag_time
  return formatAdminHistoryTimestampCellValue(v)
}

/** 구글 시트·class_roster 표기: `2026. 5. 17 오후 10:06:08` */
const ADMIN_KO_SHEET_TIMESTAMP_RE =
  /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})$/

export function isAdminKoreanSheetTimestampString(value) {
  return ADMIN_KO_SHEET_TIMESTAMP_RE.test(String(value ?? '').trim())
}

/**
 * 시트/API timestamp → epoch ms (숫자 ms·초, ISO, 한국어 표기 문자열).
 * `Date.parse('1777204843000')` 는 NaN 이므로 숫자 문자열은 별도 처리합니다.
 */
export function coerceAdminTimestampToMs(value) {
  if (value === undefined || value === null || value === '') return NaN
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1e12) return value
    if (value >= 1e9) return value * 1000
    // Google Sheets 날짜 직렬값(일 단위)
    if (value > 20000 && value < 120000) {
      return Math.round((value - 25569) * 86400 * 1000)
    }
    return NaN
  }
  const s = String(value)
    .trim()
    .replace(/^["']|["']$/g, '')
  if (!s) return NaN
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) {
      if (n >= 1e12) return n
      if (n >= 1e9) return n * 1000
    }
  }
  const serial = Number(s)
  if (Number.isFinite(serial) && serial > 20000 && serial < 120000) {
    return Math.round((serial - 25569) * 86400 * 1000)
  }
  const km = s.match(ADMIN_KO_SHEET_TIMESTAMP_RE)
  if (km) {
    const y = Number(km[1])
    const mo = Number(km[2]) - 1
    const d = Number(km[3])
    let h = Number(km[5])
    const min = Number(km[6])
    const sec = Number(km[7])
    if (km[4] === '오후' && h < 12) h += 12
    if (km[4] === '오전' && h === 12) h = 0
    return Date.UTC(y, mo, d, h - 9, min, sec)
  }
  const parsed = Date.parse(s)
  return Number.isFinite(parsed) ? parsed : NaN
}

/**
 * 관리자 화면 전용: 구글 시트와 동일한 한국 시간 표기
 * `yyyy. M. d 오전/오후 h:mm:ss` (예: 2026. 4. 28 오후 12:26:30)
 */
export function formatAdminSeoulSheetTimestamp(value) {
  if (value === undefined || value === null || value === '') return '—'
  const s = String(value).trim()
  if (isAdminKoreanSheetTimestampString(s)) return s
  const ms = coerceAdminTimestampToMs(value)
  if (Number.isFinite(ms)) {
    return formatAdminSeoulSheetTimestampFromDate_(new Date(ms))
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const parsed = Date.parse(s)
    if (Number.isFinite(parsed)) {
      return formatAdminSeoulSheetTimestampFromDate_(new Date(parsed))
    }
  }
  return s && !/^\d{4}-\d{2}-\d{2}T/.test(s) ? s : '—'
}

function pickRecordField(record, key) {
  const field = record?.[key]
  if (field === undefined || field === null) return ''
  if (field instanceof Date && !Number.isNaN(field.getTime())) return field
  const s = String(field).trim()
  return s || ''
}

function formatAdminHistoryTimestampCellValue(value) {
  if (value === undefined || value === null || String(value).trim() === '') return '—'
  const formatted = formatAdminSeoulSheetTimestamp(value)
  const out = formatted !== '—' && String(formatted).trim() !== '' ? formatted : '—'
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(out).trim())) return '—'
  return out
}

/**
 * 전체 학습 이력 테이블 timestamp 열
 * - 수련: record.timestamp 만
 * - 진단: record.diag_time || record.timestamp
 */
export function formatAdminHistoryTableTimestamp(record) {
  const diagnostic =
    isDiagnosticSheetStatus(readRecordStatus(record)) ||
    String(record?.type ?? '').trim() === '진단평가'
  if (diagnostic) {
    const v = pickRecordField(record, 'diag_time') || pickRecordField(record, 'timestamp')
    return formatAdminHistoryTimestampCellValue(v)
  }
  return formatAdminHistoryTimestampCellValue(pickRecordField(record, 'timestamp'))
}

/** student_history 응답에 timestamp가 실제로 오는지 개발자 도구에서 확인용 */
export function logAdminHistoryTimestampInspection(records, label) {
  const list = Array.isArray(records) ? records : []
  const trainingMissing = list.filter((r) => {
    const st = String(r?.status ?? '').trim()
    if (st === '진단완료' || st === 'diagnostic_completed') return false
    return !pickRecordField(r, 'timestamp')
  }).length
  console.log(`[admin history] timestamp inspection (${label})`, {
    total: list.length,
    trainingRowsMissingTimestamp: trainingMissing,
  })
  try {
    console.log(
      `[admin history] records sample JSON (${label}):\n${JSON.stringify(list.slice(0, 3), null, 2)}`,
    )
  } catch (err) {
    console.warn(`[admin history] records sample JSON failed (${label})`, err)
  }
}

function looksLikeLearningRecord(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  return Boolean(
    row.nickname ||
      row.problem ||
      row.status ||
      row.type ||
      row.diag_score !== undefined ||
      row.diag_time,
  )
}

/** `{ "0": row, "1": row }` 처럼 배열이 객체로 직렬화된 경우 */
function coerceNumericKeyedRecordsArray(value) {
  if (Array.isArray(value)) return value.length ? value : null
  if (!value || typeof value !== 'object') return null
  const keys = Object.keys(value)
  if (!keys.length || !keys.every((k) => /^\d+$/.test(k))) return null
  const rows = keys
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => value[k])
    .filter((x) => x != null && typeof x === 'object')
  return rows.length ? rows : null
}

function parseMaybeJsonRecordsArray(value) {
  if (Array.isArray(value)) return value.length ? value : null
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t.startsWith('[') && !t.startsWith('{')) return null
    try {
      const parsed = JSON.parse(t)
      if (Array.isArray(parsed) && parsed.length) return parsed
      return coerceNumericKeyedRecordsArray(parsed)
    } catch (_) {
      return null
    }
  }
  return coerceNumericKeyedRecordsArray(value)
}

function inferAdminHistoryTimestampFromRaw(raw) {
  const direct = raw?.timestamp ?? raw?.Timestamp
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
    return direct
  }
  for (const key of ['completedAt', 'completionDate', 'updatedAt', 'createdAt']) {
    const v = raw?.[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return ''
}

/** action=student_history 1차 응답 구조 진단 */
function logStudentHistoryApiShape(data, label, rawText = '') {
  const top = Array.isArray(data) ? 'array' : typeof data
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : []
  const dataFieldType =
    data?.data == null ? 'missing' : Array.isArray(data.data) ? 'array' : typeof data.data
  console.log(`[admin history] API shape (${label})`, {
    topLevelType: top,
    keys,
    keyList: keys.join(','),
    rawTextHead: (rawText || '').slice(0, 280),
    result: data?.result,
    ok: data?.ok,
    recordsIsArray: Array.isArray(data?.records),
    recordsLength: Array.isArray(data?.records) ? data.records.length : null,
    dataFieldType,
    dataLength: Array.isArray(data?.data) ? data.data.length : null,
    nestedDataRecordsIsArray: Array.isArray(data?.data?.records),
  })
  try {
    const sample = Array.isArray(data)
      ? data.slice(0, 2)
      : {
          result: data?.result,
          message: data?.message,
          records: Array.isArray(data?.records) ? data.records.slice(0, 2) : data?.records,
          data: Array.isArray(data?.data) ? data.data.slice(0, 2) : data?.data,
        }
    console.log(`[admin history] API payload sample (${label}):\n${JSON.stringify(sample, null, 2)}`)
  } catch (err) {
    console.warn(`[admin history] API payload sample failed (${label})`, err)
  }
}

/**
 * student_history(또는 동일 URL) JSON에서 records 배열 추출.
 * @returns {{
 *   records: object[] | null,
 *   source: string,
 *   isError?: boolean,
 *   errorMessage?: string,
 *   meta?: object,
 * }}
 */
function extractStudentHistoryRecordsFromApi(data) {
  if (Array.isArray(data)) {
    if (data.length && looksLikeLearningRecord(data[0])) {
      return { records: data, source: 'top-level-array', meta: null }
    }
    return { records: null, source: 'top-level-array-empty', meta: null }
  }
  if (!data || typeof data !== 'object') {
    return { records: null, source: 'invalid-payload' }
  }

  const result = String(data.result ?? data.Result ?? '').trim().toLowerCase()
  if (result === 'error') {
    return {
      records: null,
      source: 'api-error',
      isError: true,
      errorMessage: String(data.message ?? data.error ?? 'student_history 조회 실패'),
      meta: data,
    }
  }

  const tryField = (fieldName) => {
    const arr = parseMaybeJsonRecordsArray(data[fieldName])
    if (arr?.length && looksLikeLearningRecord(arr[0])) {
      return { records: arr, source: fieldName, meta: data }
    }
    return null
  }

  for (const field of ['records', 'data', 'rows', 'history']) {
    const hit = tryField(field)
    if (hit) return hit
  }

  const inner = data.data
  if (inner && typeof inner === 'object' && !Array.isArray(inner) && Array.isArray(inner.records)) {
    return { records: inner.records, source: 'data.records', meta: data }
  }

  if (data.records && typeof data.records === 'object' && !Array.isArray(data.records)) {
    const coerced = coerceNumericKeyedRecordsArray(data.records)
    if (coerced?.length && looksLikeLearningRecord(coerced[0])) {
      return { records: coerced, source: 'records-numeric-keys', meta: data }
    }
    const values = Object.values(data.records).filter((x) => x && typeof x === 'object')
    if (values.length > 0 && looksLikeLearningRecord(values[0])) {
      return { records: values, source: 'records-object-values', meta: data }
    }
  }

  const rootCoerced = coerceNumericKeyedRecordsArray(data)
  if (rootCoerced?.length && looksLikeLearningRecord(rootCoerced[0])) {
    return { records: rootCoerced, source: 'numeric-keys-root', meta: data }
  }

  for (const k of Object.keys(data)) {
    const arr = parseMaybeJsonRecordsArray(data[k])
    if (arr?.length && looksLikeLearningRecord(arr[0])) {
      return { records: arr, source: `field:${k}`, meta: data }
    }
  }

  return { records: null, source: 'unrecognized', meta: data }
}

function buildAdminHistoryFetchResult(records, meta, sourceLabel) {
  return {
    ok: true,
    records,
    historySource: sourceLabel,
    completedProblems: Array.isArray(meta?.completedProblems) ? meta.completedProblems : undefined,
    failedProblems: Array.isArray(meta?.failedProblems) ? meta.failedProblems : undefined,
    failedRecords: Array.isArray(meta?.failedRecords) ? meta.failedRecords : undefined,
  }
}

/** 목록용: 한 레코드에서 표시할 대표 시각 */
export function formatAdminSeoulSheetTimestampFromRecord(record) {
  return formatAdminHistoryTableTimestamp(record)
}

/** 관리자 학습 이력 테이블: total / fail_count 등 숫자 셀 */
export function formatAdminHistoryNumericCell(value) {
  if (value === '' || value === null || value === undefined) return '—'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const s = String(value).trim()
  if (!s) return '—'
  const n = Number(s)
  return Number.isFinite(n) ? String(n) : s
}

function formatAdminSeoulSheetTimestampFromDate_(d) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(d)

  const byType = Object.create(null)
  for (const p of parts) {
    if (p.type !== 'literal') byType[p.type] = p.value
  }
  const year = byType.year ?? ''
  const month = String(byType.month ?? '').replace(/\.$/, '').trim()
  const day = String(byType.day ?? '').replace(/\.$/, '').trim()
  const hour = byType.hour ?? ''
  const minute = byType.minute ?? ''
  const second = byType.second ?? ''
  const dayPeriod = byType.dayPeriod ?? ''

  if (!year || !month || !day) {
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  }

  return `${year}. ${month}. ${day} ${dayPeriod} ${hour}:${minute}:${second}`.replace(/\s+/g, ' ').trim()
}

/** 관리자 API/시트: step 슬롯은 0(실패)이 유효 — hasOwnProperty + 0 보존 */
function adminNormalizeStepFromRaw(raw, i) {
  const keys = [
    'step1',
    'step2',
    'step3',
    'step4',
    'step5_1',
    'step5_2',
    'step5_3',
    'step6',
  ]
  const k = keys[i]
  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, k)) {
    const d = raw[k]
    if (d !== undefined && d !== null && d !== '') return d
    if (d === 0) return 0
  }
  const scores = Array.isArray(raw?.scores) ? raw.scores : []
  if (scores.length > i) {
    const v = scores[i]
    if (v !== undefined && v !== null && v !== '') return v
    if (v === 0) return 0
  }
  return ''
}

function adminNormalizeHintFromRaw(raw) {
  if (raw?.hint !== undefined && raw?.hint !== null && raw?.hint !== '') return raw.hint
  if (raw?.hint === 0) return 0
  if (raw?.totalHint !== undefined && raw?.totalHint !== null && raw?.totalHint !== '') return raw.totalHint
  if (raw?.totalHint === 0) return 0
  return ''
}

function normalizeAdminHistoryRecordShape(raw) {
  const scores = Array.isArray(raw?.scores) ? raw.scores : []
  const hintRaw = adminNormalizeHintFromRaw(raw)
  const sr = Number(raw?.sheetRow)
  const tsRaw = inferAdminHistoryTimestampFromRaw(raw)
  const ts =
    tsRaw !== undefined && tsRaw !== null && String(tsRaw).trim() !== '' ? tsRaw : ''
  const diagRaw = raw?.diag_time ?? raw?.diagTime
  const diag =
    diagRaw !== undefined && diagRaw !== null && String(diagRaw).trim() !== '' ? diagRaw : ''
  return {
    ...raw,
    nickname: String(raw?.nickname ?? '').trim(),
    classCode: normalizeClassCode(raw?.classCode ?? ''),
    problem: String(raw?.problem ?? '').trim(),
    type: String(raw?.type ?? '').trim(),
    level: String(raw?.level ?? '').trim(),
    total: raw?.total,
    fail_count: raw?.fail_count ?? raw?.failCount ?? '',
    failCount: raw?.fail_count ?? raw?.failCount ?? '',
    timestamp: ts,
    diag_time: diag,
    hint: hintRaw,
    status: String(raw?.status ?? '').trim(),
    ai: String(raw?.ai ?? '').trim(),
    step1: adminNormalizeStepFromRaw(raw, 0),
    step2: adminNormalizeStepFromRaw(raw, 1),
    step3: adminNormalizeStepFromRaw(raw, 2),
    step4: adminNormalizeStepFromRaw(raw, 3),
    step5_1: adminNormalizeStepFromRaw(raw, 4),
    step5_2: adminNormalizeStepFromRaw(raw, 5),
    step5_3: adminNormalizeStepFromRaw(raw, 6),
    step6: adminNormalizeStepFromRaw(raw, 7),
    step5: adminNormalizeStepFromRaw(raw, 4),
    scores:
      Array.isArray(raw?.scores) && raw.scores.length >= 8
        ? raw.scores
        : [
            adminNormalizeStepFromRaw(raw, 0),
            adminNormalizeStepFromRaw(raw, 1),
            adminNormalizeStepFromRaw(raw, 2),
            adminNormalizeStepFromRaw(raw, 3),
            adminNormalizeStepFromRaw(raw, 4),
            adminNormalizeStepFromRaw(raw, 5),
            adminNormalizeStepFromRaw(raw, 6),
            adminNormalizeStepFromRaw(raw, 7),
          ],
    sheetRow: Number.isFinite(sr) ? sr : undefined,
  }
}

/** Apps Script `adminHistoryRowTimeMs_` / `activityMsForRecord_` 와 동일한 기준 */
export function adminHistoryRowTimeMsForSort(rec) {
  let best = 0
  for (const field of [rec?.timestamp, rec?.diag_time]) {
    const ms = coerceAdminTimestampToMs(field)
    if (Number.isFinite(ms) && ms > best) best = ms
  }
  return best
}

function sortAdminHistoryRecordsInPlace(records) {
  records.sort((a, b) => {
    const ta = adminHistoryRowTimeMsForSort(a)
    const tb = adminHistoryRowTimeMsForSort(b)
    if (ta !== tb) return tb - ta
    return (Number(b.sheetRow) || 0) - (Number(a.sheetRow) || 0)
  })
}

function finalizeAdminHistoryRecords(rawList) {
  const records = rawList.map((r) => normalizeAdminHistoryRecordShape(r))
  sortAdminHistoryRecordsInPlace(records)
  console.log('[admin history] records count:', records.length)
  return records
}

/**
 * 관리자: GET ?action=student_history&nickname=&classCode= (전체 행 + step1~6),
 * 미배포 시 GET ?nickname=&classCode= `{ data }` 로 폴백합니다.
 */
export async function fetchAdminStudentLearningHistory(nickname, classCode) {
  const url = API_URL
  const nick = (nickname || '').toString().trim()
  const cc = normalizeClassCode(classCode)
  if (!url || !nick || !cc) {
    return {
      ok: false,
      reason: !url ? 'missing_api_url' : 'missing_params',
      message: '',
      records: [],
    }
  }
  try {
    const q = new URLSearchParams()
    q.set('action', 'student_history')
    q.set('nickname', nick)
    q.set('classCode', cc)
    const reqUrl = `${url}?${q.toString()}`
    console.log('[admin history] request url:', reqUrl)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 20000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, message: '', records: [] }
    }
    const rawText = await res.text()
    const data = parseJsonLoose(rawText)
    logStudentHistoryApiShape(data, 'student_history primary', rawText)

    const primary = extractStudentHistoryRecordsFromApi(data)
    if (primary.isError) {
      return {
        ok: false,
        reason: 'student_history_api',
        message: primary.errorMessage || 'student_history 조회 실패',
        records: [],
      }
    }

    if (primary.records) {
      console.log(
        `[admin history] using primary response (source=${primary.source}, count=${primary.records.length})`,
      )
      logAdminHistoryTimestampInspection(primary.records, `primary:${primary.source} (before normalize)`)
      const records = finalizeAdminHistoryRecords(primary.records)
      logAdminHistoryTimestampInspection(records, `primary:${primary.source} (after normalize)`)
      return buildAdminHistoryFetchResult(records, primary.meta, `student_history:${primary.source}`)
    }

    console.warn(
      '[admin history] primary student_history had no records array; unrecognized shape — trying legacy fallback',
      {
        source: primary.source,
        keys: data && typeof data === 'object' ? Object.keys(data) : [],
      },
    )

    const q2 = new URLSearchParams()
    q2.set('nickname', nick)
    q2.set('classCode', cc)
    const fallbackUrl = `${url}?${q2.toString()}`
    console.log('[admin history] fallback request url:', fallbackUrl)
    const controller2 = new AbortController()
    const timeoutId2 = window.setTimeout(() => controller2.abort(), 20000)
    const res2 = await fetch(fallbackUrl, { method: 'GET', signal: controller2.signal })
    window.clearTimeout(timeoutId2)
    if (!res2.ok) {
      return { ok: false, reason: `http_${res2.status}`, message: '', records: [] }
    }
    const raw2 = await res2.text()
    const data2 = parseJsonLoose(raw2)
    logStudentHistoryApiShape(data2, 'legacy fallback (nickname+classCode)', raw2)

    const fallback = extractStudentHistoryRecordsFromApi(data2)
    let rawRecords = fallback.records
    if (!rawRecords) {
      rawRecords = flattenRecords(data2).filter((r) =>
        recordMatchesLearner(r, nick, cc, { classOptional: false }),
      )
    }
    if (!rawRecords?.length) {
      return {
        ok: false,
        reason: 'student_history_empty',
        message: '학습 기록을 찾을 수 없습니다.',
        records: [],
      }
    }

    console.log(
      `[admin history] using fallback (source=${fallback.source || 'flatten'}, count=${rawRecords.length})`,
    )
    logAdminHistoryTimestampInspection(rawRecords, 'fallback (before normalize)')
    const records = finalizeAdminHistoryRecords(rawRecords)
    logAdminHistoryTimestampInspection(records, 'fallback (after normalize)')
    return buildAdminHistoryFetchResult(
      records,
      fallback.meta ?? data2,
      `fallback:${fallback.source || 'flatten'}`,
    )
  } catch (error) {
    console.error('[Sheets] fetchAdminStudentLearningHistory:error', error)
    return {
      ok: false,
      reason: 'network_or_parse',
      message: error?.message || 'unknown_error',
      records: [],
    }
  }
}

/**
 * 클래스 코드 확인 화면용 메타데이터.
 * Apps Script 예: GET …?action=class_info&classCode=…
 * 응답 예: `{ className, courseTitle, teacherName }` 또는 `{ data: { … } }`
 */
export async function fetchClassInfo(classCode) {
  const url = API_URL
  const code = normalizeClassCode(classCode)
  const fallback = (reason = '') => ({
    ok: reason === 'missing_api_url' ? false : true,
    reason: reason || undefined,
    classCode: code,
    eyebrow: '나의 클래스',
    title: `반 코드 ${code}`,
    subtitle: '',
    footnote: '이 클래스에 참여합니다.',
  })

  if (!url) return fallback('missing_api_url')

  try {
    const q = new URLSearchParams()
    q.set('action', 'class_info')
    q.set('classCode', code)
    const reqUrl = `${url}?${q.toString()}`
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    if (!res.ok) return fallback()
    const rawText = await res.text()
    const data = parseJsonLoose(rawText)
    const inner = data?.class ?? data?.data ?? data
    const title =
      (inner?.courseTitle ?? inner?.title ?? inner?.displayName ?? inner?.name ?? '').toString().trim() ||
      `반 코드 ${code}`
    const teacherName = (inner?.teacherName ?? inner?.teacher ?? inner?.선생님 ?? '').toString().trim()
    const subtitle =
      (inner?.subtitle ?? inner?.description ?? '').toString().trim() ||
      (teacherName ? `${teacherName} 선생님의 방정식 수련반` : '')
    return {
      ok: true,
      classCode: code,
      eyebrow: (inner?.eyebrow ?? inner?.label ?? '나의 클래스').toString().trim() || '나의 클래스',
      title,
      subtitle,
      footnote: '이 클래스에 참여합니다.',
    }
  } catch (error) {
    console.warn('[Sheets] fetchClassInfo:fallback', error)
    return fallback()
  }
}

/**
 * 관리자: GET …?mode=classes&teacherEmail=… → **classes** 시트만 조회 (Sheet1과 무관).
 * 응답: `{ result: 'success', classes: [ { teacherEmail, classCode, className, createdAt } ] }`
 */
export async function fetchTeacherClasses(teacherEmail) {
  const url = API_URL
  const email = normalizeTeacherEmailForCompare(teacherEmail)
  if (!url || !email) {
    return { ok: false, reason: !url ? 'missing_api_url' : 'missing_teacherEmail', classes: [], rows: [] }
  }
  try {
    const q = new URLSearchParams()
    q.set('mode', 'classes')
    q.set('teacherEmail', email)
    const reqUrl = `${url}?${q.toString()}`
    console.log('[admin] classes request url:', reqUrl)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    const res = await fetch(reqUrl, { method: 'GET', signal: controller.signal })
    window.clearTimeout(timeoutId)
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, classes: [], rows: [] }
    }
    const rawText = await res.text()
    const data = parseJsonLoose(rawText)
    console.log('[admin] classes response:', data)
    const list = data?.classes ?? data?.data?.classes ?? []
    const rows = Array.isArray(data?.rows) ? data.rows : []
    const resultStr = String(data?.result ?? '').toLowerCase()
    if (resultStr === 'error') {
      return {
        ok: false,
        reason: 'classes_api',
        classes: [],
        rows,
        message: String(data?.message || 'classes 조회 실패'),
      }
    }
    if (!Array.isArray(list)) {
      return {
        ok: false,
        reason: 'invalid_response',
        classes: [],
        rows,
        message: 'classes 배열이 없습니다. 웹앱 doGet에 mode=classes를 배포했는지 확인해 주세요.',
      }
    }
    const apiOk = resultStr === 'success' || data?.ok === true
    const normalizeClassDisplayName = (rawName, rawCode) => {
      const fallbackCode = normalizeClassCode(rawCode || '')
      const text = String(rawName ?? '').trim()
      if (!text) return ''
      const ms = Date.parse(text)
      // 클래스명이 날짜 문자열로 깨진 경우(예: Thu Jan 01 2026 ...) 표시 보정
      if (Number.isFinite(ms) && /gmt|한국 표준시|kst|utc/i.test(text)) {
        const d = new Date(ms)
        const month = d.getMonth() + 1
        const day = d.getDate()
        if (Number.isFinite(month) && Number.isFinite(day)) {
          return `${month}-${day}`
        }
        return fallbackCode
      }
      return text
    }

    const classes = list
      .map((row) => {
        const rawCode = String(row.classCode ?? row.클래스코드 ?? '').trim()
        if (!rawCode) return null
        const displayName = normalizeClassDisplayName(
          row.displayName ?? row.className ?? row.title ?? row.name ?? '',
          rawCode,
        )
        return {
          displayName,
          classCode: normalizeClassCode(rawCode),
          teacherEmail: String(row.teacherEmail ?? row.email ?? '').trim(),
          createdAt: String(row.createdAt ?? '').trim(),
        }
      })
      .filter(Boolean)
    return { ok: apiOk || classes.length > 0, classes, rows }
  } catch (error) {
    console.error('[Sheets] fetchTeacherClasses:error', error)
    return { ok: false, reason: 'network_error', classes: [], rows: [], message: error?.message || '' }
  }
}

/**
 * 관리자: POST action=create_class
 * payload: { teacherEmail, classCode, className }
 * 응답: { result: 'success' | 'exists' | 'error', class?: { ... }, message?: string }
 */
export async function createTeacherClass(teacherEmail, classCode, className) {
  const gasTarget = API_URL
  const email = normalizeTeacherEmailForCompare(teacherEmail)
  const code = normalizeClassCode(classCode)
  const name = String(className || '').trim()
  const payload = {
    action: 'create_class',
    teacherEmail: email,
    classCode: code,
    className: name,
  }

  if (!gasTarget) {
    return {
      ok: false,
      reason: 'missing_api_url',
      message: 'VITE_API_URL(Apps Script Web App URL)이 설정되지 않았습니다.',
    }
  }
  if (!email || !code || !name) {
    return { ok: false, reason: 'missing_params', message: 'teacherEmail, classCode, className이 필요합니다.' }
  }

  const q = new URLSearchParams({
    action: 'create_class',
    teacherEmail: email,
    classCode: code,
    className: name,
  })
  const url = `${gasTarget}?${q.toString()}`

  console.log('[create_class] url:', url)
  console.log('[create_class] payload:', payload)

  try {
    const res = await fetch(url, { method: 'GET' })
    const raw = await res.text()
    const data = parseJsonLoose(raw)
    const result = String(data?.result || '').toLowerCase()
    if (!res.ok) {
      console.warn('[create_class] http_error', res.status, raw?.slice(0, 500))
    }
    if (res.ok && (result === 'success' || result === 'exists')) {
      return {
        ok: true,
        duplicated: result === 'exists',
        class: data?.class || null,
        message: String(data?.message || ''),
      }
    }
    return {
      ok: false,
      reason: result || `http_${res.status}`,
      message: String(data?.message || ''),
    }
  } catch (error) {
    console.error('[create_class] network_error', error)
    return {
      ok: false,
      reason: 'network_error',
      message:
        error?.message ||
        '네트워크 오류 — 로컬은 dev 서버 재시작·VITE_API_PROXY=/api/gas, 배포는 Netlify VITE_API_URL 확인',
    }
  }
}

/**
 * 관리자: POST action=update_class
 * payload: { teacherEmail, classCode, className }
 */
export async function updateTeacherClass(teacherEmail, classCode, className) {
  const url = resolveAiFeedbackPostUrl()
  const email = normalizeTeacherEmailForCompare(teacherEmail)
  const code = normalizeClassCode(classCode)
  const name = String(className || '').trim()

  if (!url) return { ok: false, reason: 'missing_api_url', message: '' }
  if (!email || !code || !name) {
    return { ok: false, reason: 'missing_params', message: 'teacherEmail, classCode, className이 필요합니다.' }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_class',
        teacherEmail: email,
        classCode: code,
        className: name,
      }),
    })
    const raw = await res.text()
    const data = parseJsonLoose(raw)
    console.log('[admin] update_class response', { status: res.status, data })
    const result = String(data?.result || '').toLowerCase()

    if (res.ok && data?.ok === true && !result) {
      return {
        ok: false,
        reason: 'deploy_missing_update_class',
        message:
          '서버가 이름 변경을 처리하지 못했습니다. Apps Script에 최신 Code.gs(update_class 포함)를 붙여넣고 「새 버전」으로 배포해 주세요.',
      }
    }

    if (res.ok && result === 'success') {
      return {
        ok: true,
        class: data?.class || null,
        message: String(data?.message || ''),
      }
    }

    const apiMessage = String(data?.message || data?.error || '').trim()
    if (result === 'not_found') {
      return {
        ok: false,
        reason: 'not_found',
        message: apiMessage || '해당 클래스를 찾지 못했습니다.',
      }
    }

    return {
      ok: false,
      reason: result || `http_${res.status}`,
      message: apiMessage || '클래스 이름 변경에 실패했습니다.',
    }
  } catch (error) {
    return { ok: false, reason: 'network_error', message: error?.message || '' }
  }
}

/**
 * 관리자: POST action=delete_class
 * payload: { teacherEmail, classCode }
 * 응답: { result: 'success' | 'not_found' | 'error' }
 */
export async function deleteTeacherClass(teacherEmail, classCode) {
  const url = resolveAiFeedbackPostUrl()
  const email = normalizeTeacherEmailForCompare(teacherEmail)
  const code = normalizeClassCode(classCode)
  if (!url) return { ok: false, reason: 'missing_api_url', message: '' }
  if (!email || !code) {
    return { ok: false, reason: 'missing_params', message: 'teacherEmail, classCode가 필요합니다.' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_class',
        teacherEmail: email,
        classCode: code,
      }),
    })
    const raw = await res.text()
    const data = parseJsonLoose(raw)
    const result = String(data?.result || '').toLowerCase()
    if (res.ok && (result === 'success' || result === 'not_found')) {
      return {
        ok: true,
        deleted: result === 'success',
        message: String(data?.message || ''),
      }
    }
    return { ok: false, reason: result || `http_${res.status}`, message: String(data?.message || '') }
  } catch (error) {
    return { ok: false, reason: 'network_error', message: error?.message || '' }
  }
}