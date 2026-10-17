import assert from 'node:assert/strict'
import { after, afterEach, before, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

process.env.VITE_API_URL = '/api'
let vite, api, auth, unsubscribe
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

before(async () => {
  vite = await createServer({ configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent',
    server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true },
  })
  api = await vite.ssrLoadModule('/src/lib/api.ts')
  auth = await vite.ssrLoadModule('/src/lib/auth.ts')
})
afterEach(() => {
  unsubscribe?.()
  api.setAccessToken(null)
  mock.restoreAll()
})
after(async () => { await vite?.close() })

test('requests use the memory JWT, include cookies/CSRF, preserve headers, and support 204', async () => {
  api.setAccessToken('memory-jwt')
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/devices')
    assert.equal(init.credentials, 'include')
    assert.equal(init.headers.get('Authorization'), 'Bearer memory-jwt')
    assert.equal(init.headers.get('X-CSRF-Protection'), '1')
    assert.equal(init.headers.get('X-Test'), 'preserved')
    assert.equal('retryOnUnauthorized' in init, false)
    return new Response(null, { status: 204 })
  })
  assert.equal((await api.apiFetch('/devices', { headers: { 'X-Test': 'preserved' } })).status, 204)
})

test('invalid login preserves the API error and never refreshes or triggers logout', async () => {
  let expired = 0
  unsubscribe = api.onSessionExpired(async () => { expired++ })
  const fetch = mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/api/auth/login')
    return json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401)
  })
  await assert.rejects(api.apiFetch('/auth/login', { method: 'POST' }), error =>
    error instanceof api.ApiError && error.status === 401 && error.message === 'Invalid credentials' && error.code === 'INVALID_CREDENTIALS')
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(expired, 0)
})

test('a protected 401 refreshes once and retries with the new token', async () => {
  const requests = []
  api.setAccessToken('expired')
  mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push(url)
    if (url === '/api/auth/refresh') {
      assert.equal(init.method, 'POST')
      assert.equal(init.body, '{}')
      assert.equal(init.credentials, 'include')
      assert.equal(init.headers.get('X-CSRF-Protection'), '1')
      return json({ accessToken: 'fresh', expiresIn: 900 })
    }
    return init.headers.get('Authorization') === 'Bearer fresh' ? json({ ok: true }) : json({ error: 'Expired' }, 401)
  })
  assert.deepEqual(await (await api.apiFetch('/admin/users')).json(), { ok: true })
  assert.deepEqual(requests, ['/api/admin/users', '/api/auth/refresh', '/api/admin/users'])
  assert.equal(api.getAccessToken(), 'fresh')
})

test('concurrent 401 responses share one refresh request', async () => {
  api.setAccessToken('expired')
  let releaseRefresh, refreshStarted
  const started = new Promise(resolve => { refreshStarted = resolve })
  let refreshes = 0
  mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === '/api/auth/refresh') {
      refreshes++
      refreshStarted()
      return new Promise(resolve => { releaseRefresh = () => resolve(json({ accessToken: 'fresh' })) })
    }
    return init.headers.get('Authorization') === 'Bearer fresh' ? json({ ok: true }) : json({ error: 'Expired' }, 401)
  })
  const responses = Promise.all([api.apiFetch('/admin/users'), api.apiFetch('/admin/devices')])
  await started
  releaseRefresh()
  assert.deepEqual((await responses).map(response => response.status), [200, 200])
  assert.equal(refreshes, 1)
})

test('failed refresh invokes the logout flow without recursive refresh requests', async () => {
  api.setAccessToken('expired')
  const paths = []
  let logouts = 0
  unsubscribe = api.onSessionExpired(async () => {
    logouts++
    await assert.rejects(api.apiFetch('/auth/logout', { method: 'POST' }), error => error.status === 401)
    api.setAccessToken(null)
  })
  mock.method(globalThis, 'fetch', async url => {
    paths.push(url)
    return json({ error: 'Invalid session', code: 'INVALID_SESSION' }, 401)
  })
  await assert.rejects(api.apiFetch('/admin/users'), error => error.status === 401)
  assert.deepEqual(paths, ['/api/admin/users', '/api/auth/refresh', '/api/auth/logout'])
  assert.equal(logouts, 1)
  assert.equal(api.getAccessToken(), null)
})

test('a second 401 after retry signs out and does not refresh a second time', async () => {
  let refreshes = 0, resources = 0, expired = 0
  api.setAccessToken('expired')
  unsubscribe = api.onSessionExpired(async () => { expired++; api.setAccessToken(null) })
  mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/auth/refresh') { refreshes++; return json({ accessToken: 'fresh' }) }
    resources++
    return json({ error: 'Invalid session' }, 401)
  })
  await assert.rejects(api.apiFetch('/admin/users'), error => error.status === 401)
  assert.deepEqual({ refreshes, resources, expired }, { refreshes: 1, resources: 2, expired: 1 })
})

test('403 responses and a network failure after successful refresh keep the session', async () => {
  let expired = 0
  api.setAccessToken('expired')
  unsubscribe = api.onSessionExpired(async () => { expired++ })
  mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/forbidden') return json({ error: 'Admin required' }, 403)
    if (url === '/api/auth/refresh') return json({ accessToken: 'fresh' })
    if (api.getAccessToken() === 'fresh') throw new TypeError('Offline')
    return json({ error: 'Expired' }, 401)
  })
  await assert.rejects(api.apiFetch('/forbidden'), error => error.status === 403)
  await assert.rejects(api.apiFetch('/admin/users'), /Offline/)
  assert.equal(api.getAccessToken(), 'fresh')
  assert.equal(expired, 0)
})

test('a late refresh cannot restore the token after logout', async () => {
  let release
  mock.method(globalThis, 'fetch', () => new Promise(resolve => {
    release = () => resolve(json({ accessToken: 'late-token' }))
  }))
  api.setAccessToken('old')
  const refresh = api.refreshAccessToken()
  api.setAccessToken(null)
  release()
  await assert.rejects(refresh, error => error.name === 'AbortError')
  assert.equal(api.getAccessToken(), null)
})

test('a response from a previous session cannot replace a new session', async () => {
  let release, expired = 0
  unsubscribe = api.onSessionExpired(async () => { expired++ })
  mock.method(globalThis, 'fetch', () => new Promise(resolve => { release = () => resolve(json({}, 401)) }))
  api.setAccessToken('old')
  const request = api.apiFetch('/admin/users')
  api.setAccessToken('new-login')
  release()
  await assert.rejects(request, error => error.name === 'AbortError')
  assert.equal(api.getAccessToken(), 'new-login')
  assert.equal(expired, 0)
})

test('user parsing admits staff roles and identifies USER without trusting unknown roles', () => {
  for (const role of ['ADMIN', 'LEAD_DEV', 'USER']) {
    const user = auth.readUser({ email: 'staff@example.test', role })
    assert.equal(auth.isAdminUser(user), role !== 'USER')
  }
  assert.throws(() => auth.readUser({ email: 'staff@example.test', role: 'OWNER' }), /Invalid user response/)
  assert.throws(() => auth.readUser({ email: 42, role: 'ADMIN' }), /Invalid user response/)
  assert.throws(() => auth.readAccessToken({ accessToken: '' }), /Invalid authentication response/)
})
