import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadStepTrainingDataByKey } from './training/stepTrainingData'
import './index.css'

loadStepTrainingDataByKey().catch((err) => {
  console.warn('[step-training] load failed:', err)
})

const appEl = document.getElementById('app')

function showBootError(message) {
  if (!appEl) return
  appEl.innerHTML = `
    <div style="min-height:100vh;padding:24px;background:#fff7ed;color:#7c2d12;font-family:system-ui,sans-serif">
      <h1 style="font-size:20px;font-weight:800;margin:0 0 10px">화면 로드 중 오류가 발생했습니다.</h1>
      <p style="margin:0 0 8px">아래 메시지를 복사해서 전달해 주세요.</p>
      <pre style="white-space:pre-wrap;background:#ffedd5;border:1px solid #fdba74;border-radius:8px;padding:12px;">${message}</pre>
    </div>
  `
}

/** MathLive 가상 키보드 등에서 흔한 무해한 브라우저 경고 — 앱 오류로 취급하지 않음 */
function isBenignResizeObserverError(message) {
  const text = String(message || '')
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(text)
}

window.addEventListener('error', (event) => {
  const message = event?.error?.stack || event?.message || 'unknown error'
  if (isBenignResizeObserverError(event?.message) || isBenignResizeObserverError(message)) {
    event.preventDefault?.()
    return
  }
  showBootError(message)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  const message =
    (typeof reason === 'string' && reason) ||
    reason?.stack ||
    reason?.message ||
    'unhandled promise rejection'
  if (isBenignResizeObserverError(message)) {
    event.preventDefault?.()
    return
  }
  showBootError(message)
})

try {
  createRoot(appEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
} catch (error) {
  showBootError(error?.stack || error?.message || 'react bootstrap failed')
}
