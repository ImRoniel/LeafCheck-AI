import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { checkDeployment } from '../scripts/check-deployment.mjs'

const origin = 'https://admin.example.test'
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function webHost(url, init) {
  assert.ok(init.signal instanceof AbortSignal)
  assert.equal(init.redirect, 'error')
  if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, X-CSRF-Protection',
  } })
  if (url.pathname.startsWith('/api/')) return reply({ code: 'INVALID_SESSION' }, 401)
  return new Response('<html><div id="root"></div></html>', { headers: { 'Content-Type': 'text/html' } })
}

test('deployment checks only read-only SPA routes, unauthenticated API denial and CORS', async () => {
  const methods = []
  const checks = await checkDeployment(origin, async (url, init) => {
    methods.push(init.method ?? 'GET')
    assert.equal(new Headers(init.headers).has('Authorization'), false)
    return webHost(url, init)
  })
  assert.equal(checks.length, 6)
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET', 'GET', 'OPTIONS'])
})

test('deployment checks reject a missing SPA fallback, HTML API response, and wildcard origin', async () => {
  await assert.rejects(checkDeployment(origin, async (url, init) => url.pathname === '/users' ? new Response('Not found', { status: 404 }) : webHost(url, init)), /SPA route/)
  await assert.rejects(checkDeployment(origin, async (url, init) => url.pathname.startsWith('/api/') ? new Response('<html>Fallback</html>') : webHost(url, init)), /same-origin \/api proxy/)
  await assert.rejects(checkDeployment(origin, async (url, init) => init.method === 'OPTIONS' ? new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } }) : webHost(url, init)), /exact browser origin/)
})

test('deployment checks reject origins containing credentials or paths and require HTTPS outside loopback', async () => {
  for (const input of ['http://admin.example.test', 'https://user:secret@example.test', 'https://admin.example.test/path', 'https://admin.example.test?token=secret']) {
    await assert.rejects(checkDeployment(input, async () => { throw new Error('must not request invalid origins') }), /HTTPS web origin/)
  }
})

test('Vercel example forwards API paths before the SPA fallback', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json.example', import.meta.url), 'utf8'))
  assert.equal(config.rewrites[0].source, '/api/:path*')
  assert.equal(config.rewrites[0].destination, 'https://REPLACE_WITH_BACKEND_HOST/api/:path*')
  assert.equal(config.rewrites[1].destination, '/index.html')
})
