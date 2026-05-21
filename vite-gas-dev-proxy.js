/**
 * 로컬 dev: /api/gas → VITE_API_URL
 * - TLS: 회사망 self-signed certificate (rejectUnauthorized: false)
 * - GAS Web App POST: 302 Location → GET 으로 JSON 응답 수신
 */
import https from 'node:https'

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function httpsRequest(url, method, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers = {}
    if (body && body.length > 0) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(body.length)
    }
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    if (body && body.length > 0) req.write(body)
    req.end()
  })
}

/** Apps Script doPost: POST 후 redirect URL을 GET 해야 본문 JSON 수신 */
async function gasPostThenGet(execUrl, body) {
  const postRes = await httpsRequest(execUrl, 'POST', body)
  const loc = postRes.headers?.location
  if ((postRes.statusCode === 302 || postRes.statusCode === 301) && loc) {
    return httpsRequest(loc, 'GET', null)
  }
  return postRes
}

export function gasDevProxyPlugin(gasExecUrl) {
  return {
    name: 'gas-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || ''
        if (!rawUrl.startsWith('/api/gas')) return next()

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.end()
          return
        }

        try {
          if (req.method === 'GET') {
            const q = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : ''
            const target = gasExecUrl + q
            let getRes = await httpsRequest(target, 'GET', null)
            if (
              (getRes.statusCode === 302 || getRes.statusCode === 301) &&
              getRes.headers?.location
            ) {
              getRes = await httpsRequest(getRes.headers.location, 'GET', null)
            }
            res.statusCode = getRes.statusCode || 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(getRes.body)
            return
          }

          if (req.method === 'POST') {
            const body = await readRequestBody(req)
            const out = await gasPostThenGet(gasExecUrl, body)
            res.statusCode = out.statusCode >= 200 && out.statusCode < 600 ? out.statusCode : 502
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(out.body)
            return
          }

          next()
        } catch (err) {
          console.error('[gas-dev-proxy]', err?.message || err)
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              result: 'error',
              message: String(err?.message || err),
            }),
          )
        }
      })
    },
  }
}
