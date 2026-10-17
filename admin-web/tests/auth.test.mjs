import assert from 'node:assert/strict'
import { after, afterEach, before, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

process.env.VITE_API_URL = '/api'
let vite, api, auth, admin, permissions, format, forms, auditFilters, operations, unsubscribe
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
  admin = await vite.ssrLoadModule('/src/lib/admin.ts')
  permissions = await vite.ssrLoadModule('/src/lib/permissions.ts')
  format = await vite.ssrLoadModule('/src/lib/format.ts')
  forms = await vite.ssrLoadModule('/src/lib/user-form.ts')
  auditFilters = await vite.ssrLoadModule('/src/lib/audit-filters.ts')
  operations = await vite.ssrLoadModule('/src/lib/operations.ts')
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

test('every request gets a ten-second deadline and a timeout produces a recoverable error', async () => {
  const deadline = new AbortController()
  let expired = 0
  unsubscribe = api.onSessionExpired(async () => { expired++ })
  mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 10000)
    return deadline.signal
  })
  const fetch = mock.method(globalThis, 'fetch', (_url, init) => new Promise((_resolve, reject) => {
    assert.ok(init.signal instanceof AbortSignal)
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  }))
  const request = api.apiFetch('/admin/users')
  deadline.abort(new DOMException('Timed out', 'TimeoutError'))
  await assert.rejects(request, error => error.code === 'REQUEST_TIMEOUT' && /10 seconds/.test(error.message))
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(expired, 0)
})

test('caller cancellation aborts a write without refreshing, expiring or replaying it', async () => {
  const controller = new AbortController()
  let expired = 0
  unsubscribe = api.onSessionExpired(async () => { expired++ })
  const fetch = mock.method(globalThis, 'fetch', (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  }))
  const write = api.apiFetch('/admin/users/u1', { method: 'PATCH', body: '{}', signal: controller.signal })
  controller.abort()
  await assert.rejects(write, error => error.name === 'AbortError')
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(expired, 0)
})

test('cancelling one request while refreshing releases it without cancelling the shared refresh', async () => {
  api.setAccessToken('expired')
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/auth/refresh')) {
      started()
      return new Promise(resolve => { release = () => resolve(json({ accessToken: 'fresh' })) })
    }
    return json({ error: 'Expired' }, 401)
  })
  const controller = new AbortController()
  const pending = api.apiFetch('/admin/users', { signal: controller.signal })
  await ready
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  const shared = api.refreshAccessToken()
  release()
  await shared
  assert.equal(api.getAccessToken(), 'fresh')
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

test('missing admin verification expires the session without refreshing, while ordinary RBAC 403 does not', async () => {
  let expired = 0
  api.setAccessToken('unverified')
  unsubscribe = api.onSessionExpired(async () => { expired++; api.setAccessToken(null) })
  const fetch = mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/api/admin/users')
    return json({ code: 'ADMIN_VERIFICATION_REQUIRED', error: 'Verify your administrator session.' }, 403)
  })
  await assert.rejects(api.apiFetch('/admin/users'), error => error.code === 'ADMIN_VERIFICATION_REQUIRED')
  assert.equal(expired, 1)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(api.getAccessToken(), null)
})

test('OTP authentication endpoints preserve 202 responses and 429 cooldowns without refreshing', async () => {
  const paths = []
  mock.method(globalThis, 'fetch', async (url, init) => {
    paths.push(url)
    assert.equal(init.headers.get('Authorization'), null)
    assert.equal(init.headers.get('X-CSRF-Protection'), '1')
    assert.equal(init.credentials, 'include')
    if (url.endsWith('/login')) return json({ status: 'otp_required', challengeToken: 'pending' }, 202)
    return new Response(JSON.stringify({ code: 'RATE_LIMITED', error: 'Please wait.' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '90' },
    })
  })
  assert.equal((await api.apiFetch('/auth/login', { method: 'POST' })).status, 202)
  await assert.rejects(api.apiFetch('/auth/admin-otp/resend', { method: 'POST' }), error =>
    error.status === 429 && error.retryAfter === 90 && error.message === 'Please wait.')
  assert.deepEqual(paths, ['/api/auth/login', '/api/auth/admin-otp/resend'])
})

test('challenge parsing requires a valid token and expiry and enforces at least a 60-second resend cooldown', () => {
  const payload = { status: 'otp_required', challengeToken: 'secret', maskedEmail: 'a***@example.test',
    expiresAt: new Date(Date.now() + 300_000).toISOString(), resendAfter: 0 }
  const start = Date.now()
  const challenge = auth.readAdminChallenge(payload)
  assert.equal(challenge.challengeToken, 'secret')
  assert.ok(challenge.resendAvailableAt >= start + 60_000)
  assert.equal(challenge.expiresAt, Date.parse(payload.expiresAt))
  for (const change of [{ challengeToken: '' }, { maskedEmail: null }, { expiresAt: 'invalid' },
    { expiresAt: new Date(0).toISOString() }, { resendAfter: '60' }]) {
    assert.throws(() => auth.readAdminChallenge({ ...payload, ...change }), /Invalid sign-in challenge/)
  }
})

test('frontend permissions grant operational writes to LEAD_DEV and reserve platform controls for ADMIN', () => {
  for (const permission of ['users.read', 'users.manage', 'devices.read', 'devices.manage', 'devices.provision', 'sessions.revoke', 'settings.read', 'settings.manage', 'integrations.read', 'audit.read']) {
    assert.equal(permissions.hasPermission('ADMIN', permission), true)
    assert.equal(permissions.hasPermission('LEAD_DEV', permission), ['devices.read', 'devices.manage'].includes(permission))
  }
})

test('diagnostics parsing preserves missing sensor values, raw ADC and simulated readings', () => {
  const reading = { id: 'r1', timestamp: '2026-10-17T00:00:00.000Z', temperatureCelsius: 26.1,
    humidityPercentage: 62, soilMoistureRaw: 2180, lightLux: null, simulated: true }
  assert.deepEqual(operations.readTelemetryReadings({ data: [reading] }), [reading])
  assert.equal(operations.readTelemetryReadings({ data: [{ ...reading, soilMoistureRaw: undefined }] })[0].soilMoistureRaw, null)
  assert.throws(() => operations.readTelemetryReadings({ data: [{ ...reading, humidityPercentage: '62' }] }), /unexpected response/)
  assert.throws(() => operations.readTelemetryReadings({ data: Array(6).fill(reading) }), /unexpected response/)
  assert.throws(() => operations.readTelemetryReadings({ data: [{ ...reading, timestamp: 'invalid' }] }), /unexpected response/)
})

test('versioned operational details and settings reject invalid concurrency timestamps', () => {
  const device = { id: 'd1', name: 'Sensor', macAddress: 'AA:BB:CC:DD:EE:FF', plants: [], connectionStatus: 'ONLINE', updatedAt: '2026-10-17T00:00:00.000Z', pairing: null }
  assert.equal(operations.readDeviceDetails({ data: device }).updatedAt, device.updatedAt)
  assert.equal(operations.readDeviceDetails({ data: device }).owner, null)
  assert.equal(operations.readDeviceDetails({ data: { ...device, source: 'DEMO', connectionStatus: 'UNKNOWN' } }).simulated, true)
  assert.throws(() => operations.readDeviceDetails({ data: { ...device, updatedAt: 'bad' } }), /unexpected response/)
  const settings = { id: 'platform', aiScanningEnabled: true, deviceClaimsEnabled: false, updatedAt: device.updatedAt, updatedBy: null }
  assert.deepEqual(operations.readPlatformSettings({ data: settings }), settings)
  assert.throws(() => operations.readPlatformSettings({ data: { ...settings, aiScanningEnabled: 'true' } }), /unexpected response/)
})

test('table parsers accept masked user emails and operational devices without retaining owner data', () => {
  const user = admin.readUserRow({ id: 'u1', name: null, emailMasked: 'a***@example.test', role: 'USER', isActive: true, updatedAt: '2026-10-17T00:00:00.000Z' })
  assert.equal(user.email, null)
  assert.equal(user.emailMasked, 'a***@example.test')
  assert.equal(admin.readUserRow({ ...user, email: 'actual@example.test' }).email, 'actual@example.test')
  assert.throws(() => admin.readUserRow({ ...user, isActive: 'false' }), /unexpected response/)
  const device = { id: 'd1', name: 'Sensor', macAddress: '00:11:22:33:44:55', plants: [], connectionStatus: 'ONLINE' }
  assert.deepEqual(admin.readDeviceRow(device), { ...device, lastReadingAt: null, readingError: false })
  assert.equal('owner' in admin.readDeviceRow({ ...device, owner: { email: 'private@example.test' } }), false)
  assert.throws(() => admin.readAdminList({ data: [], pagination: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }, admin.readUserRow), /unexpected response/)
})

test('audit outcomes distinguish failed, requested, cancelled, successful and unclassified events', () => {
  const row = { id: 'a1', actorId: null, targetId: null, createdAt: new Date().toISOString(), metadata: null }
  for (const [action, outcome] of [['ADMIN_OTP_FAILED', 'Failed'], ['USER_DELETE_REQUESTED', 'Requested'],
    ['ADMIN_OTP_CANCELLED', 'Cancelled'], ['USER_UPDATED', 'Succeeded'], ['DEVICE_RENAMED', 'Succeeded'], ['DEVICE_UNLINKED', 'Succeeded'],
    ['USER_SESSIONS_REVOKED', 'Succeeded'], ['HARDWARE_PROVISIONED', 'Succeeded'], ['HARDWARE_BACKFILLED', 'Succeeded'], ['CUSTOM_ACTION', 'Recorded']]) {
    assert.equal(admin.auditOutcome({ ...row, action }), outcome)
  }
  assert.equal(admin.auditOutcome({ ...row, action: 'CUSTOM_ACTION', metadata: { outcome: 'Pending' } }), 'Pending')
  assert.throws(() => admin.readAuditRow({ ...row, action: 'CUSTOM_ACTION', createdAt: 'invalid' }), /unexpected response/)
})

test('dashboard stats validate counts and preserve unavailable connectivity instead of inventing zero', () => {
  const payload = { data: { totalUsers: 12, totalDevices: 5, totalPhysicalDevices: 4, activeDevices: 3, totalActiveDevices: 3, totalPlants: 25, totalAiScans: 48 },
    meta: { asOf: new Date().toISOString(), telemetryDegraded: false } }
  assert.equal(admin.readAdminStats(payload).totalUsers, 12)
  assert.equal(admin.readAdminStats({ ...payload, data: { ...payload.data, activeDevices: null, totalActiveDevices: null },
    meta: { ...payload.meta, telemetryDegraded: true } }).totalActiveDevices, null)
  for (const value of [-1, '3', 1.5]) {
    assert.throws(() => admin.readAdminStats({ ...payload, data: { ...payload.data, totalUsers: value } }), /unexpected response/)
  }
  for (const changes of [{ totalDevices: 3 }, { activeDevices: 6, totalActiveDevices: 6 }, { activeDevices: 2 }]) {
    assert.throws(() => admin.readAdminStats({ ...payload, data: { ...payload.data, ...changes } }), /unexpected response/)
  }
})

test('audit identities are optional for deleted accounts and action labels remain readable', () => {
  const row = { id: 'log-1', actorId: null, actorEmail: null, targetId: 'deleted-user', targetEmail: null,
    action: 'ADMIN_LOGIN_VERIFIED', createdAt: new Date().toISOString(), metadata: null }
  assert.equal(admin.readAuditRow(row).actorEmail, null)
  assert.equal(admin.readAuditRow({ ...row, actorEmail: 'admin@example.test' }).actorEmail, 'admin@example.test')
  assert.equal(format.formatAuditAction('ADMIN_LOGIN_VERIFIED'), 'Admin Login Verified')
  assert.equal(format.formatAuditAction('ADMIN_OTP_FAILED'), 'Admin OTP Failed')
})

test('last-seen formatting handles missing readings, elapsed time and clock errors', () => {
  const now = Date.parse('2026-10-17T08:00:00Z')
  assert.equal(format.formatLastSeen(null, now), 'Never seen')
  assert.equal(format.formatLastSeen('invalid', now), 'Unavailable')
  assert.equal(format.formatLastSeen(new Date(now).toISOString(), now), 'Just now')
  assert.equal(format.formatLastSeen(new Date(now - 120_000).toISOString(), now), '2 minutes ago')
  assert.equal(format.formatLastSeen(new Date(now + 120_000).toISOString(), now), 'Clock ahead')
})

test('API errors retain only bounded allowlisted field messages', async () => {
  const error = await api.ApiError.fromResponse(json({ error: 'Invalid input', fieldErrors: {
    email: 'Enter a valid address.', password: 'Password too weak.', name: 'x'.repeat(501), secret: 'PRIVATE', role: 42,
  } }, 400))
  assert.deepEqual(error.fieldErrors, { email: 'Enter a valid address.', password: 'Password too weak.' })
})

test('user form validation matches email and password length boundaries without inventing provider rules', () => {
  assert.deepEqual(forms.validateUserForm({ name: '', role: 'USER', email: 'new@example.test', password: '😀'.repeat(8) }), {})
  const errors = forms.validateUserForm({ name: 'x'.repeat(101), role: 'OWNER', email: 'invalid', password: 'short' })
  assert.deepEqual(Object.keys(errors).sort(), ['email', 'name', 'password', 'role'])
  assert.deepEqual(forms.validateUserForm({ name: '', role: 'ADMIN' }), {})
  assert.equal(typeof forms.validateUserForm({ name: '', role: 'USER', password: 'x'.repeat(129) }).password, 'string')
  assert.equal(forms.userFieldErrors(new api.ApiError(400, 'Password too weak.')).password, 'Password too weak.')
  assert.equal(forms.userFieldErrors(new api.ApiError(409, 'Already exists.', 'EMAIL_CONFLICT')).email, 'Already exists.')
})

test('health parsing accepts readiness states and rejects unknown or invalid service data', () => {
  assert.equal(admin.readAdminHealth({ api: 'ok', postgres: 'ok', mongo: 'down' }).mongo, 'down')
  for (const value of [{ api: 'ok', postgres: 'ok' }, { api: 'down', postgres: 'ok', mongo: 'ok' }, { api: 'ok', postgres: 'maybe', mongo: 'ok' }]) {
    assert.throws(() => admin.readAdminHealth(value), /unexpected response/)
  }
})

test('audit filters use inclusive local calendar days, validate ranges, and preserve actor/target IDs', () => {
  const actorId = '00000000-0000-4000-8000-000000000001'
  const { params, errors } = auditFilters.auditFilterQuery({ action: ' user_updated ', from: '2026-10-17', to: '2026-10-17', actorId, targetId: ' deleted-user ' })
  assert.deepEqual(errors, {})
  assert.deepEqual(params, { action: 'USER_UPDATED', from: new Date('2026-10-17T00:00:00.000').toISOString(),
    to: new Date('2026-10-17T23:59:59.999').toISOString(), actorId, targetId: 'deleted-user' })
  assert.deepEqual(auditFilters.auditFilterQuery(auditFilters.emptyAuditFilters).params, {})
  assert.ok(auditFilters.auditFilterQuery({ ...auditFilters.emptyAuditFilters, from: '2026-10-18', to: '2026-10-17' }).errors.to)
  assert.ok(auditFilters.auditFilterQuery({ ...auditFilters.emptyAuditFilters, from: '2026-02-31' }).errors.from)
  assert.ok(auditFilters.auditFilterQuery({ ...auditFilters.emptyAuditFilters, action: 'bad action', actorId: 'not-a-uuid' }).errors.actorId)
})
