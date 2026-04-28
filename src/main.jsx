import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

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

window.addEventListener('error', (event) => {
  showBootError(event?.error?.stack || event?.message || 'unknown error')
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  const message =
    (typeof reason === 'string' && reason) ||
    reason?.stack ||
    reason?.message ||
    'unhandled promise rejection'
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
