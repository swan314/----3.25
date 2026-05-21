/**
 * Netlify: /api/gas → VITE_API_URL (POST·JSON 응답, CORS 회피)
 * 로컬 빌드는 .env, Netlify는 Site env의 VITE_API_URL 사용
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readViteApiUrlFromDotEnv() {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const m = trimmed.match(/^VITE_API_URL=(.+)$/)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // ignore
  }
  return ''
}

const gasUrl = (process.env.VITE_API_URL || readViteApiUrlFromDotEnv() || '').trim()
if (!gasUrl) {
  console.warn('[netlify] VITE_API_URL 없음 — public/_redirects 생략')
  process.exit(0)
}

try {
  new URL(gasUrl)
} catch {
  console.warn('[netlify] VITE_API_URL 형식 오류 — _redirects 생략')
  process.exit(0)
}

const out = join(root, 'public', '_redirects')
writeFileSync(out, `/api/gas\t${gasUrl}\t200\n`, 'utf8')
console.log('[netlify] public/_redirects →', gasUrl)
