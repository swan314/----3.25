import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gasUrl = (env.VITE_API_URL || '').trim()
  let proxy = {}
  if (gasUrl) {
    try {
      const u = new URL(gasUrl)
      const pathOnly = u.pathname + u.search
      proxy['/api/gas'] = {
        target: u.origin,
        changeOrigin: true,
        rewrite: () => pathOnly,
      }
    } catch {
      // ignore invalid VITE_API_URL
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
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
