import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { gasDevProxyPlugin } from './vite-gas-dev-proxy.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gasUrl = (env.VITE_API_URL || '').trim()
  const plugins = [react(), tailwindcss()]
  if (mode === 'development' && gasUrl) {
    try {
      new URL(gasUrl)
      plugins.push(gasDevProxyPlugin(gasUrl))
      console.log('[vite] /api/gas dev proxy →', gasUrl)
    } catch (e) {
      console.warn('[vite] VITE_API_URL 파싱 실패:', e?.message || e)
    }
  } else if (mode === 'development') {
    console.warn(
      '[vite] VITE_API_URL이 비어 있습니다. .env에 Apps Script Web App URL을 설정하세요.',
    )
  }
  return {
    plugins,
    server: {},
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          legacy: resolve(__dirname, 'legacy.html'),
        },
      },
    },
  }
})
