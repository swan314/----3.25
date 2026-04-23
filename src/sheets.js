const directSheetsWebhookUrl =
  'https://script.google.com/macros/s/AKfycbxS6jJolgQuiHPwn5s6i_DHekp6bt-Ac-bppWxFQN6hKTEd8BMLsdpCgWNDDNam0ujzvA/exec'

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

function getDefaultProgress() {
  return {
    hasDiagnosticResult: false,
    diagnosticTier: '하',
    lastLearningStage: 1,
    lastProblemNumber: 1,
  }
}

function pickRecord(data) {
  return (
    data?.data?.record ||
    data?.data?.latest ||
    data?.data?.student ||
    (Array.isArray(data?.data) ? data.data[0] : null) ||
    data?.record ||
    data?.latest ||
    data?.student ||
    (Array.isArray(data) ? data[0] : null) ||
    data ||
    {}
  )
}

function parseProgressFromData(data) {
  const record = pickRecord(data)
  console.log('[student-progress] parsed data', data)
  console.log('[student-progress] selected record', record)
  console.log('[student-progress] selected record keys', Object.keys(record || {}))

  const hasDiagnosticResult = Boolean(
    record.hasDiagnosticResult ??
      record.has_diagnostic_result ??
      record.hasDiagnostic ??
      record.diagnosticLevel ??
      record.diagnosticTier
  )

  const combinedProgress =
    parseCombinedProgress(record.lastProgress) ||
    parseCombinedProgress(record.resumePoint) ||
    parseCombinedProgress(record.이어하기) ||
    parseCombinedProgress(record.progress)

  if (!record || !Object.keys(record).length) {
    console.warn(
      '[student-progress] record is empty. Apps Script 응답에 학생 데이터가 없거나 nickname 매칭 컬럼이 서버에서 인식되지 않았을 수 있습니다.'
    )
  }

  return {
    hasDiagnosticResult,
    diagnosticTier: normalizeTier(record.diagnosticTier || record.diagnosticLevel || record.userLevel),
    lastLearningStage: toFinitePositiveInt(
      combinedProgress?.stage ??
        record.lastLearningStage ??
        record.수준단계 ??
        record.stageNumber ??
        record.level,
      1
    ),
    lastProblemNumber: toFinitePositiveInt(
      combinedProgress?.problem ??
        record.lastProblemNumber ??
        record.문제번호 ??
        record.problemNumber ??
        record.questionNumber,
      1
    ),
  }
}

function fetchProgressViaJsonp(reqUrl) {
  return new Promise((resolve, reject) => {
    const callbackName = `mmStudentProgress_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    const script = document.createElement('script')
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('JSONP timeout'))
    }, 8000)

    function cleanup() {
      if (script.parentNode) script.parentNode.removeChild(script)
      delete window[callbackName]
      window.clearTimeout(timeoutId)
    }

    window[callbackName] = (payload) => {
      cleanup()
      resolve(payload || {})
    }

    reqUrl.searchParams.set('callback', callbackName)
    script.src = reqUrl.toString()
    script.async = true
    script.onerror = () => {
      cleanup()
      reject(new Error('JSONP load failed'))
    }
    document.body.appendChild(script)
  })
}

/**
 * 보조 학습 로그(빈칸 입력, 수련 모드 단계 로그 등)를 Google Apps Script 웹훅으로 전송합니다.
 * .env의 VITE_SHEETS_WEBHOOK_URL이 있으면 우선 사용합니다.
 */
export async function updateSupplement(payload) {
  const url = import.meta.env.VITE_SHEETS_WEBHOOK_URL || directSheetsWebhookUrl
  if (!url) {
    console.warn('[Sheets] updateSupplement: no webhook URL')
    return { ok: false, reason: 'missing_webhook' }
  }
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
    return { ok: true, reason: 'no_cors_assumed_success' }
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
  const url = import.meta.env.VITE_SHEETS_WEBHOOK_URL || directSheetsWebhookUrl
  const trimmedNickname = (nickname || '').toString().trim()
  if (!url || !trimmedNickname) {
    return getDefaultProgress()
  }

  try {
    const reqUrl = new URL(url)
    reqUrl.searchParams.set('action', 'get_student_progress')
    reqUrl.searchParams.set('nickname', trimmedNickname)

    const res = await fetch(reqUrl.toString(), { method: 'GET' })
    if (!res.ok) throw new Error(`학생 기록 조회 실패 (${res.status})`)
    const rawText = await res.text()
    console.log('[student-progress] raw response text', rawText)

    let data = {}
    try {
      data = rawText ? JSON.parse(rawText) : {}
    } catch (parseError) {
      console.warn('[student-progress] json parse failed, fallback to empty object', parseError)
      data = {}
    }

    return parseProgressFromData(data)
  } catch (error) {
    console.error('[Sheets] fetchStudentLearningProgress:error', error)
    try {
      const reqUrl = new URL(url)
      reqUrl.searchParams.set('action', 'get_student_progress')
      reqUrl.searchParams.set('nickname', trimmedNickname)
      const jsonpData = await fetchProgressViaJsonp(reqUrl)
      console.log('[student-progress] jsonp payload', jsonpData)
      return parseProgressFromData(jsonpData)
    } catch (jsonpError) {
      console.error('[Sheets] fetchStudentLearningProgress:jsonp_error', jsonpError)
      return getDefaultProgress()
    }
  }
}
