import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

let vite, browser, origin
const admin = { id: 'admin-1', email: 'admin@example.test', name: 'Platform Admin', role: 'ADMIN' }
const operator = { id: 'operator-1', email: 'operator@example.test', name: 'Operations', role: 'LEAD_DEV' }
const member = { id: 'member-1', email: 'member@example.test', name: 'Member', role: 'USER' }
const userVersion = '2026-10-17T00:00:00.000Z'
const sensor = { id: 'sensor-1', macAddress: 'AA:BB:CC:DD:EE:FF', name: 'Office sensor',
  plants: [{ id: 'plant-1', name: 'Monstera' }], connectionStatus: 'ONLINE' }
const reply = (body, status = 200, headers = {}) => ({ status, body: JSON.stringify(body), contentType: 'application/json', headers })
const list = (data, page = 1, total = data.length, meta = {}, pageSize = 25) => ({ data,
  pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }, meta })
const integrationPayload = (checkedAt, missing = []) => ({ data: ['gemini', 'plantnet', 'perenual', 'cloudinary'].map(provider => ({
  provider, name: { gemini: 'Gemini', plantnet: 'Pl@ntNet', perenual: 'Perenual', cloudinary: 'Cloudinary' }[provider],
  configured: !missing.includes(provider), status: missing.includes(provider) ? 'NOT_CONFIGURED' : 'CONFIGURED',
  model: provider === 'gemini' ? 'gemini-2.5-flash' : null, cloudName: provider === 'cloudinary' && !missing.includes(provider) ? 'leafcheck-plants' : null,
  checkedAt, message: missing.includes(provider) ? 'Add the required service settings to configure this integration.' : {
    gemini: 'Plant health analysis and scan recommendations.', plantnet: 'Plant species identification from uploaded images.',
    perenual: 'Plant care guidance and species information.', cloudinary: 'Cloud image hosting for plant photos and scan uploads.',
  }[provider],
  quota: { source: 'unavailable', remaining: null, limit: null, resetAt: null }, lastObservedAt: null, observedRequests: null,
})), meta: { schemaVersion: 1, asOf: checkedAt } })

before(async () => {
  process.env.VITE_API_URL = '/api'
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  })
  await vite.listen()
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  // Warm Vite's module graph before assertions run with their shorter UI deadline.
  // The throwaway context has no shared cookies/storage and cannot call a backend.
  const warmup = await browser.newContext()
  try {
    await warmup.route('**/api/**', route => route.fulfill(reply({ error: 'No session' }, 401)))
    const page = await warmup.newPage()
    await page.goto(origin + '/login')
    await page.getByLabel('Email', { exact: true }).waitFor({ timeout: 30000 })
  } finally { await warmup.close() }
})

after(async () => { await browser?.close(); await vite?.close() })

async function app(t, options = {}) {
  const context = await browser.newContext({ timezoneId: options.timezoneId ?? 'UTC' })
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  const errors = []
  const requests = []
  const actor = options.actor ?? admin
  const state = { signedIn: options.restored ?? false, challenges: 0,
    provisions: [], settings: { id: 'platform', aiScanningEnabled: true, deviceClaimsEnabled: true, updatedAt: userVersion, updatedBy: null },
    users: (options.users ?? [{ id: admin.id, name: admin.name, email: admin.email, emailMasked: 'a***@example.test', role: 'ADMIN', isActive: true },
      { id: member.id, name: member.name, email: member.email, emailMasked: 'm***@example.test', role: 'USER', isActive: true }]).map(row => ({ updatedAt: userVersion, ...row })) }
  const device = { ...sensor, updatedAt: userVersion, lastReadingAt: new Date(Date.now() - 120_000).toISOString(), readingError: false,
    pairing: { id: 'pairing-1', plantId: 'plant-1', plantName: 'Monstera', pairedAt: userVersion } }
  let pending
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  // Every API request is intercepted. Tests never contact Render, Supabase or the local backend.
  await context.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.slice('/api'.length)
    const entry = { path, method: request.method(), query: url.searchParams,
      body: request.postDataJSON(), headers: request.headers() }
    requests.push(entry)
    try {
      assert.equal(entry.headers['x-csrf-protection'], '1')
      if (options.handle) {
        const response = await options.handle(entry, state)
        if (response) return await route.fulfill(response)
      }
      if (path === '/auth/refresh') return await route.fulfill(state.signedIn
        ? reply({ accessToken: 'verified-memory-jwt' }) : reply({ error: 'No session' }, 401))
      if (path === '/users/me') return await route.fulfill(reply(actor))
      if (path === '/auth/login') {
        if (actor.role === 'USER') {
          state.signedIn = true
          return await route.fulfill(reply({ accessToken: 'verified-memory-jwt', user: actor }))
        }
        state.challenges++
        pending = { status: 'otp_required', challengeToken: `memory-challenge-${state.challenges}`,
          maskedEmail: 'a***@example.test', expiresAt: new Date(Date.now() + 300_000).toISOString(), resendAfter: 60 }
        return await route.fulfill(reply(pending, 202))
      }
      if (path === '/auth/verify-admin-otp') {
        assert.equal(entry.body.challengeToken, pending.challengeToken)
        assert.equal(entry.headers.authorization, undefined)
        if (entry.body.code !== '00001234') return await route.fulfill(reply({ code: 'INVALID_CODE', error: 'Invalid or expired code.' }, 400))
        state.signedIn = true
        return await route.fulfill(reply({ accessToken: 'verified-memory-jwt', user: actor }))
      }
      if (path === '/auth/admin-otp/resend') {
        assert.deepEqual(entry.body, { challengeToken: pending.challengeToken })
        return await route.fulfill(reply({ status: 'otp_required', expiresAt: pending.expiresAt, resendAfter: 60 }, 202))
      }
      if (path === '/auth/admin-otp/cancel') {
        assert.deepEqual(entry.body, { challengeToken: pending.challengeToken })
        return await route.fulfill({ status: 204 })
      }
      if (path === '/auth/logout') {
        state.signedIn = false
        return await route.fulfill({ status: 204 })
      }
      if (path.startsWith('/admin/')) {
        assert.equal(state.signedIn, true, 'admin data must not be fetched before authentication')
        assert.equal(entry.headers.authorization, 'Bearer verified-memory-jwt')
      }
      if (path === '/admin/stats') return await route.fulfill(reply({
        data: { totalUsers: state.users.length, totalDevices: 2, totalPhysicalDevices: 1, activeDevices: 1, totalActiveDevices: 1, totalPlants: 23, totalAiScans: 48 },
        meta: { asOf: new Date().toISOString(), telemetryDegraded: false, freshnessWindowSeconds: 1800 },
      }))
      if (path === '/admin/health') return await route.fulfill(reply({ api: 'ok', postgres: 'ok', mongo: 'ok' }))
      if (path === '/admin/users' && entry.method === 'POST') {
        const user = { id: 'created-user', name: entry.body.name ?? null, email: entry.body.email, emailMasked: 'n***@example.test',
          role: entry.body.role, isActive: entry.body.isActive ?? true, updatedAt: userVersion }
        state.users.unshift(user)
        return await route.fulfill(reply({ data: user }, 201))
      }
      if (path.endsWith('/revoke-sessions') && entry.method === 'POST') {
        assert.equal(actor.role, 'ADMIN')
        assert.ok(entry.body.reason.trim().length >= 3)
        return await route.fulfill(reply({ data: { revoked: true } }))
      }
      if (path.startsWith('/admin/users/') && entry.method === 'PATCH') {
        const user = state.users.find(row => row.id === path.split('/').at(-1))
        assert.ok(user)
        if (entry.body.updatedAt !== user.updatedAt) return await route.fulfill(reply({ code: 'CONFLICT', error: 'This user was modified by another administrator. Please refresh.' }, 409))
        for (const key of ['name', 'role', 'isActive']) if (key in entry.body) user[key] = entry.body[key]
        user.updatedAt = new Date(Date.parse(user.updatedAt) + 1).toISOString()
        return await route.fulfill(reply({ data: user }))
      }
      if (path.startsWith('/admin/users/') && entry.method === 'DELETE') {
        state.users = state.users.filter(row => row.id !== path.split('/').at(-1))
        return await route.fulfill({ status: 204 })
      }
      if (path === '/admin/users') {
        assert.equal(actor.role, 'ADMIN', 'LEAD_DEV must never request the users endpoint')
        const pageNumber = Number(entry.query.get('page'))
        const query = entry.query.get('q')?.toLowerCase() ?? ''
        const users = state.users.filter(row => `${row.name} ${row.emailMasked}`.toLowerCase().includes(query))
        const rows = users.slice((pageNumber - 1) * 25, pageNumber * 25).map(({ email, ...row }) => ({
          ...row, ...(entry.query.get('revealEmails') === 'true' ? { email: email ?? row.id + '@example.test' } : {}),
        }))
        return await route.fulfill(reply(list(rows, pageNumber, users.length)))
      }
      if (path === '/admin/devices') return await route.fulfill(reply(list([device])))
      if (path === '/admin/devices/sensor-1/readings') return await route.fulfill(reply({ data: [
        { id: 'reading-1', timestamp: device.lastReadingAt, temperatureCelsius: 26.1, humidityPercentage: 62, soilMoistureRaw: 2180, lightLux: 740, simulated: false },
        { id: 'reading-2', timestamp: userVersion, temperatureCelsius: null, humidityPercentage: null, soilMoistureRaw: null, lightLux: null, simulated: false },
      ] }))
      if (path === '/admin/devices/sensor-1' && entry.method === 'GET') return await route.fulfill(reply({ data: { ...device,
        ...(actor.role === 'ADMIN' ? { owner: { id: member.id, name: member.name, email: member.email } } : {}) } }))
      if (path === '/admin/devices/sensor-1' && entry.method === 'PATCH') {
        if (entry.body.updatedAt !== device.updatedAt) return await route.fulfill(reply({ code: 'CONFLICT', error: 'Stale device' }, 409))
        device.name = entry.body.name
        device.updatedAt = new Date(Date.parse(device.updatedAt) + 1).toISOString()
        return await route.fulfill(reply({ data: device }))
      }
      if (path === '/admin/devices/sensor-1/unlink') {
        assert.equal(entry.body.expectedPairingId, device.pairing?.id)
        assert.equal(entry.body.updatedAt, device.updatedAt)
        device.pairing = null
        device.plants = []
        device.updatedAt = new Date(Date.parse(device.updatedAt) + 1).toISOString()
        return await route.fulfill(reply({ data: device }))
      }
      if (path === '/admin/devices/whitelist' && entry.method === 'GET') {
        assert.equal(actor.role, 'ADMIN')
        return await route.fulfill(reply(list(state.provisions)))
      }
      if (path === '/admin/devices/whitelist' && entry.method === 'POST') {
        const provision = { id: 'provision-1', macAddress: entry.body.macAddress, label: entry.body.label ?? null, status: 'APPROVED', claimedDeviceId: null, updatedAt: userVersion, createdAt: userVersion }
        state.provisions.push(provision)
        return await route.fulfill(reply({ data: provision }, 201))
      }
      if (path === '/admin/devices/whitelist/provision-1' && entry.method === 'PATCH') {
        const provision = state.provisions[0]
        assert.equal(entry.body.updatedAt, provision.updatedAt)
        for (const field of ['label', 'status']) if (field in entry.body) provision[field] = entry.body[field]
        provision.updatedAt = new Date(Date.parse(provision.updatedAt) + 1).toISOString()
        return await route.fulfill(reply({ data: provision }))
      }
      if (path === '/admin/settings') {
        assert.equal(actor.role, 'ADMIN')
        if (entry.method === 'PATCH') {
          assert.equal(entry.body.updatedAt, state.settings.updatedAt)
          for (const field of ['aiScanningEnabled', 'deviceClaimsEnabled']) if (field in entry.body) state.settings[field] = entry.body[field]
          state.settings.updatedAt = new Date(Date.parse(state.settings.updatedAt) + 1).toISOString()
          state.settings.updatedBy = { id: admin.id, name: admin.name, email: admin.email }
        }
        return await route.fulfill(reply({ data: state.settings }))
      }
      if (path === '/admin/integrations') {
        assert.equal(actor.role, 'ADMIN')
        return await route.fulfill(reply(integrationPayload(userVersion)))
      }
      if (path === '/admin/audit') {
        assert.equal(actor.role, 'ADMIN', 'LEAD_DEV must never request audit logs')
        const logs = options.auditEntries ?? [
          { id: 'log-1', actorId: admin.id, actorEmail: admin.email, targetId: member.id, targetEmail: member.email, action: 'USER_UPDATED', createdAt: new Date().toISOString(), metadata: {} },
          { id: 'log-2', actorId: admin.id, actorEmail: admin.email, targetId: admin.id, targetEmail: admin.email, action: 'ADMIN_OTP_FAILED', createdAt: new Date().toISOString(), metadata: {} },
          { id: 'log-3', actorId: null, actorEmail: null, targetId: null, targetEmail: null, action: 'USER_DELETE_REQUESTED', createdAt: new Date().toISOString(), metadata: { actorId: 'deleted-admin' } },
        ]
        const pageSize = Number(entry.query.get('pageSize') ?? 25)
        const pageNumber = Number(entry.query.get('page') ?? 1)
        const filtered = logs.filter(log => (!entry.query.get('action') || log.action === entry.query.get('action')) &&
          (!entry.query.get('actorId') || log.actorId === entry.query.get('actorId')) &&
          (!entry.query.get('targetId') || log.targetId === entry.query.get('targetId')) &&
          (!entry.query.get('from') || Date.parse(log.createdAt) >= Date.parse(entry.query.get('from'))) &&
          (!entry.query.get('to') || Date.parse(log.createdAt) <= Date.parse(entry.query.get('to'))))
        return await route.fulfill(reply(list(filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), pageNumber, filtered.length, {}, pageSize)))
      }
      throw new Error(`Unexpected API request: ${entry.method} ${path}`)
    } catch (error) {
      errors.push(error.message)
      await route.fulfill(reply({ error: error.message }, 500))
    }
  })
  t.after(async () => {
    await context.close()
    assert.deepEqual(errors, [], 'browser and mock backend must report no unexpected errors')
  })
  return { page, requests, state }
}

async function signIn(page, duplicate = false) {
  await page.goto(`${origin}/login`)
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByLabel('Password', { exact: true }).fill('correct-password')
  if (duplicate) {
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  } else await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function memoryToken(page) {
  return page.evaluate(async () => (await import('/src/lib/api.ts')).getAccessToken())
}

async function stallWrite(page, method, simulateDeadline = false, path = '/api/admin/users') {
  await page.evaluate(({ method, simulateDeadline, path }) => {
    const network = window.fetch.bind(window)
    if (simulateDeadline) AbortSignal.timeout = milliseconds => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    }
    window.fetch = (input, init) => {
      if (String(input).includes(path) && init?.method === method) {
        window.testWritePending = true
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {
          window.testWriteAborted = true
          reject(init.signal.reason)
        }, { once: true }))
      }
      return network(input, init)
    }
  }, { method, simulateDeadline, path })
}

async function screenshot(page, name) {
  const directory = process.env.ADMIN_WEB_SCREENSHOT_DIR
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: join(directory, name + '.png'), fullPage: true })
}

test('202 starts an in-memory OTP challenge, prevents duplicate login and verifies a leading-zero code', async t => {
  const { page, requests } = await app(t)
  await signIn(page, true)
  await page.waitForURL('**/login/otp')
  await page.getByRole('heading', { name: 'Check your email' }).waitFor()
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(request => request.path === '/auth/login').length, 1)
  assert.equal(requests.filter(request => request.path.startsWith('/admin/')).length, 0)
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0])
  await page.getByLabel('Verification code').fill('11112222')
  await page.getByRole('button', { name: 'Verify Code', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Invalid or expired code.' }).waitFor()
  assert.equal(await memoryToken(page), null)
  await page.getByLabel('Verification code').fill('00001234')
  await page.getByRole('button', { name: 'Verify Code', exact: true }).click()
  await page.waitForURL('**/dashboard')
  await page.getByRole('link', { name: 'Users', exact: true }).waitFor()
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(await page.getByRole('link', { name: 'Users', exact: true }).count(), 1)
  assert.equal(await page.getByRole('link', { name: 'Audit logs', exact: true }).count(), 1)
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0])
})

test('direct OTP visits and reloads cannot recover a challenge from browser storage', async t => {
  const { page } = await app(t)
  await page.goto(`${origin}/login/otp`)
  await page.waitForURL('**/login')
  await signIn(page)
  await page.waitForURL('**/login/otp')
  await page.reload()
  await page.waitForURL('**/login')
  assert.equal(await memoryToken(page), null)
})

test('resend waits 60 seconds, survives route changes, restarts its cooldown, and cancel clears the challenge', async t => {
  const { page, requests } = await app(t)
  await signIn(page)
  await page.waitForURL('**/login/otp')
  assert.equal(await page.getByRole('button', { name: /Resend Code/ }).isDisabled(), true)
  await page.clock.fastForward(30_000)
  await page.evaluate(() => { history.pushState({}, '', '/login'); dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForURL('**/login/otp')
  assert.equal(await page.getByRole('button', { name: /Resend Code/ }).isDisabled(), true)
  await page.clock.fastForward(31_000)
  await page.getByRole('button', { name: 'Resend Code', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'A new code has been sent.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Resend Code/ }).isDisabled(), true)
  assert.equal(requests.filter(request => request.path === '/auth/admin-otp/resend').length, 1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL('**/login')
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(request => request.path === '/auth/admin-otp/cancel').length, 1)
  await page.goto(`${origin}/login/otp`)
  await page.waitForURL('**/login')
})

test('login 429 displays a clear cooldown, honors Retry-After, and stops repeat submissions', async t => {
  let logins = 0
  const { page, requests } = await app(t, { handle: async entry => {
    if (entry.path === '/auth/login' && ++logins === 1) return reply({ code: 'RATE_LIMITED',
      error: 'Please wait before starting another sign-in challenge.' }, 429, { 'Retry-After': '90' })
  } })
  await signIn(page)
  await page.getByRole('status').filter({ hasText: 'Please wait before requesting another code.' }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isDisabled(), true)
  await page.clock.fastForward(61_000)
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isDisabled(), true)
  assert.equal(requests.filter(request => request.path === '/auth/login').length, 1)
  await page.clock.fastForward(31_000)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/login/otp')
})

test('expired or exhausted backend challenges return to sign-in without issuing a token', async t => {
  const { page } = await app(t, { handle: async entry => {
    if (entry.path === '/auth/verify-admin-otp') return reply({ code: 'INVALID_CHALLENGE', error: 'Challenge unavailable.' }, 400)
  } })
  await signIn(page)
  await page.waitForURL('**/login/otp')
  await page.getByLabel('Verification code').fill('00001234')
  await page.getByRole('button', { name: 'Verify Code', exact: true }).click()
  await page.waitForURL('**/login')
  await page.getByRole('alert').filter({ hasText: 'expired or reached its attempt limit' }).waitFor()
  assert.equal(await memoryToken(page), null)
})

test('expired codes disable verification and resending while allowing cancellation', async t => {
  const { page, requests } = await app(t)
  await signIn(page)
  await page.waitForURL('**/login/otp')
  await page.clock.fastForward(301_000)
  await page.getByText('This code has expired. Cancel and sign in again.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Verify Code', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /Resend Code/ }).isDisabled(), true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL('**/login')
  assert.equal(requests.filter(request => request.path === '/auth/verify-admin-otp').length, 0)
})

test('OTP resend 429 shows the specific cooldown and cancellation failures still clear local state', async t => {
  const { page, requests } = await app(t, { handle: async entry => {
    if (entry.path === '/auth/admin-otp/resend') return reply({ code: 'RATE_LIMITED', error: 'Too many requests.' }, 429)
    if (entry.path === '/auth/admin-otp/cancel') return reply({ error: 'Server temporarily unavailable.' }, 503)
  } })
  await signIn(page)
  await page.waitForURL('**/login/otp')
  await page.clock.fastForward(61_000)
  await page.getByRole('button', { name: 'Resend Code', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Please wait before requesting another code.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Resend Code/ }).isDisabled(), true)
  assert.equal(requests.filter(request => request.path === '/auth/admin-otp/resend').length, 1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL('**/login')
  await page.getByRole('alert').filter({ hasText: 'Sign-in was cancelled locally.' }).waitFor()
  assert.equal(await memoryToken(page), null)
})

test('a fresh root visit has a clean login form while expired restoration on a protected page explains the redirect', async t => {
  const fresh = await app(t)
  await fresh.page.goto(origin + '/')
  await fresh.page.waitForURL('**/login')
  await fresh.page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  assert.equal(await fresh.page.getByRole('alert').count(), 0)
  const expired = await app(t)
  await expired.page.goto(origin + '/users')
  await expired.page.waitForURL('**/login')
  await expired.page.getByRole('alert').filter({ hasText: 'Your session has expired. Please log in again.' }).waitFor()
})

test('LEAD_DEV verifies OTP, sees operations and cannot fetch platform pages through direct URLs', async t => {
  const { page, requests } = await app(t, { actor: operator })
  await signIn(page)
  await page.waitForURL('**/login/otp')
  await page.getByLabel('Verification code').fill('00001234')
  await page.getByRole('button', { name: 'Verify Code', exact: true }).click()
  await page.waitForURL('**/dashboard')
  await page.getByRole('article', { name: 'Plants registered', exact: true }).getByText('23', { exact: true }).waitFor()
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(await page.getByRole('link', { name: 'Users', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Audit logs', exact: true }).count(), 0)
  for (const path of ['/users', '/audit', '/provisioning', '/settings', '/integrations']) {
    await page.goto(`${origin}${path}`)
    await page.waitForURL('**/forbidden')
    await page.getByRole('heading', { name: 'SuperAdmin access required' }).waitFor()
  }
  await page.getByRole('link', { name: 'Devices', exact: true }).click()
  await page.getByRole('cell', { name: 'AA:BB:CC:DD:EE:FF', exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'Monstera', exact: true }).count(), 1)
  assert.equal(await page.getByRole('cell', { name: 'Online', exact: true }).count(), 1)
  assert.equal(requests.filter(request => ['/admin/users', '/admin/audit', '/admin/devices/whitelist', '/admin/settings', '/admin/integrations'].includes(request.path)).length, 0)
  assert.equal(requests.filter(request => request.path === '/auth/verify-admin-otp').length, 1)
  assert.equal(await page.getByRole('link', { name: 'Diagnostics', exact: true }).count(), 1)
  assert.ok(requests.some(request => request.path === '/admin/stats'))
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot(page, 'devices-mobile')
})

test('USER accounts are logged out and never receive admin page data', async t => {
  const { page, requests } = await app(t, { actor: member })
  await signIn(page)
  await page.getByRole('alert').filter({ hasText: 'Unauthorized: Admin access required' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/login')
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(request => request.path === '/auth/logout').length, 1)
  assert.equal(requests.filter(request => request.path.startsWith('/admin/')).length, 0)
})

test('LEAD_DEV inspects raw readings, renames with a version and unlinks the expected pairing with a reason', async t => {
  const { page, requests } = await app(t, { actor: operator, restored: true })
  await page.goto(`${origin}/devices`)
  await page.getByRole('button', { name: 'Manage Office sensor', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Device details', exact: true })
  await panel.getByRole('heading', { name: 'Office sensor', exact: true }).waitFor()
  await panel.getByRole('cell', { name: '2,180', exact: true }).waitFor()
  assert.equal(await panel.getByRole('cell', { name: 'Unavailable', exact: true }).count(), 4)
  assert.equal(await panel.getByText(member.email, { exact: true }).count(), 0)
  assert.equal(await panel.locator('time').first().getAttribute('dateTime') !== null, true)
  assert.equal(await panel.getByText('Refresh fetches stored readings.', { exact: false }).count(), 1)
  await panel.getByRole('button', { name: 'Rename', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Rename device', exact: true })
  await rename.getByLabel('Device name').fill('Living room sensor')
  assert.equal(await rename.getByRole('button', { name: 'Save name', exact: true }).isDisabled(), true)
  await rename.getByLabel('Reason', { exact: true }).fill('Match installation location')
  await rename.getByRole('button', { name: 'Save name', exact: true }).click()
  await panel.getByRole('heading', { name: 'Living room sensor', exact: true }).waitFor()
  assert.deepEqual(requests.find(request => request.method === 'PATCH' && request.path === '/admin/devices/sensor-1').body,
    { name: 'Living room sensor', updatedAt: userVersion, reason: 'Match installation location' })
  await panel.getByRole('button', { name: 'Unlink from Monstera', exact: true }).click()
  const unlink = page.getByRole('dialog', { name: 'Unlink device from plant?', exact: true })
  await unlink.getByLabel('Reason', { exact: true }).fill('Move sensor to another plant')
  await unlink.getByRole('button', { name: 'Unlink device', exact: true }).click()
  await panel.getByRole('button', { name: 'Unlink from Plant', exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Unlink from Plant', exact: true }).isDisabled(), true)
  assert.deepEqual(requests.find(request => request.path === '/admin/devices/sensor-1/unlink').body,
    { updatedAt: '2026-10-17T00:00:00.001Z', expectedPairingId: 'pairing-1', reason: 'Move sensor to another plant' })
  const reads = requests.filter(request => request.path === '/admin/devices/sensor-1/readings').length
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/devices/sensor-1/readings')
  await panel.getByRole('button', { name: 'Refresh readings', exact: true }).click()
  await refreshed
  assert.equal(requests.filter(request => request.path === '/admin/devices/sensor-1/readings').length, reads + 1)
  assert.equal(requests.filter(request => request.path.includes('/commands')).length, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot(page, 'device-details-mobile')
})

test('stale device edits require refreshing before retry and diagnostics respects deep links', async t => {
  const { page, requests } = await app(t, { actor: operator, restored: true, handle: entry =>
    entry.method === 'PATCH' && entry.path === '/admin/devices/sensor-1' ? reply({ error: 'Stale device', code: 'CONFLICT' }, 409) : null })
  await page.goto(`${origin}/diagnostics?device=sensor-1`)
  const panel = page.getByRole('dialog', { name: 'Device details', exact: true })
  await panel.getByRole('button', { name: 'Rename', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Rename device', exact: true })
  await rename.getByLabel('Device name').fill('Renamed sensor')
  await rename.getByLabel('Reason', { exact: true }).fill('Correct device name')
  await rename.getByRole('button', { name: 'Save name', exact: true }).click()
  await rename.getByRole('alert').filter({ hasText: 'This record changed after you opened it.' }).waitFor()
  assert.equal(await rename.getByRole('button', { name: 'Save name', exact: true }).isDisabled(), true)
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 1)
  await rename.getByRole('button', { name: 'Refresh and review', exact: true }).click()
  await rename.waitFor({ state: 'hidden' })
})

test('SuperAdmin force logout requires confirmation and an audit reason', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(`${origin}/users`)
  await page.getByRole('button', { name: 'Force Logout Member', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Force logout?', exact: true })
  assert.equal(requests.filter(request => request.path.endsWith('/revoke-sessions')).length, 0)
  assert.equal(await dialog.getByRole('button', { name: 'Force Logout', exact: true }).isDisabled(), true)
  await dialog.getByLabel('Reason', { exact: true }).fill('Lost signed-in phone')
  await dialog.getByRole('button', { name: 'Force Logout', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Application sessions revoked for Member.' }).waitFor()
  assert.deepEqual(requests.find(request => request.path.endsWith('/revoke-sessions')).body, { reason: 'Lost signed-in phone' })
})

test('SuperAdmin registers unclaimed hardware and revokes approval with version and audit reason', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(`${origin}/provisioning`)
  await page.getByRole('button', { name: 'Register hardware', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Register approved hardware', exact: true })
  await dialog.getByLabel('MAC address', { exact: true }).fill('AA:BB:CC:DD:EE:FF')
  await dialog.getByLabel('Label (optional)', { exact: true }).fill('New production sensor')
  await dialog.getByLabel('Reason', { exact: true }).fill('Prepare approved installation')
  await dialog.getByRole('button', { name: 'Register hardware', exact: true }).click()
  await page.getByRole('cell', { name: 'Approved / Unclaimed', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Manage approval for AA:BB:CC:DD:EE:FF', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Manage hardware approval', exact: true })
  assert.equal(await dialog.getByLabel('MAC address', { exact: true }).getAttribute('readonly'), '')
  await dialog.getByLabel('Approval', { exact: true }).selectOption('REVOKED')
  await dialog.getByLabel('Reason', { exact: true }).fill('Retire physical sensor')
  await dialog.getByRole('button', { name: 'Save approval', exact: true }).click()
  await page.getByRole('cell', { name: 'Revoked', exact: true }).waitFor()
  assert.deepEqual(requests.find(request => request.method === 'PATCH').body, { status: 'REVOKED', updatedAt: userVersion, reason: 'Retire physical sensor' })
})

test('duplicate hardware explains the MAC conflict and allows correcting the registration', async t => {
  const { page, requests } = await app(t, { restored: true, handle: entry =>
    entry.path === '/admin/devices/whitelist' && entry.method === 'POST' && entry.body.macAddress === sensor.macAddress
      ? reply({ code: 'HARDWARE_ALREADY_REGISTERED', error: 'Hardware already registered.' }, 409) : null })
  await page.goto(origin + '/provisioning')
  await page.getByRole('button', { name: 'Register hardware', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Register approved hardware', exact: true })
  await dialog.getByLabel('MAC address', { exact: true }).fill(sensor.macAddress)
  await dialog.getByLabel('Reason', { exact: true }).fill('Prepare a defense sensor')
  await dialog.getByRole('button', { name: 'Register hardware', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'This MAC address is already registered.' }).waitFor()
  assert.equal(await dialog.getByText('This record changed after you opened it.', { exact: false }).count(), 0)
  assert.equal(await dialog.getByLabel('MAC address', { exact: true }).isEnabled(), true)
  await dialog.getByLabel('MAC address', { exact: true }).fill('11:22:33:44:55:66')
  await dialog.getByRole('button', { name: 'Register hardware', exact: true }).click()
  await page.getByRole('cell', { name: '11:22:33:44:55:66', exact: true }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/admin/devices/whitelist' && entry.method === 'POST').length, 2)
})

test('provisioning distinguishes an empty registry from search and filter misses', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/provisioning')
  await page.getByText('No hardware registered.', { exact: true }).waitFor()
  await page.getByLabel('Search hardware', { exact: true }).fill('missing-sensor')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByText('No hardware matches your search.', { exact: true }).waitFor()
  assert.ok(requests.some(entry => entry.path === '/admin/devices/whitelist' && entry.query.get('q') === 'missing-sensor'))
  await page.getByLabel('Search hardware', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByText('No hardware registered.', { exact: true }).waitFor()
  await page.getByLabel('Approval', { exact: true }).selectOption('REVOKED')
  await page.getByText('No hardware matches your filters.', { exact: true }).waitFor()
})

test('device details uses readable status labels while failed telemetry remains retryable', async t => {
  const { page } = await app(t, { restored: true, handle: entry => {
    if (entry.path === '/admin/devices/sensor-1' && entry.method === 'GET') return reply({ data: {
      ...sensor, updatedAt: userVersion, connectionStatus: 'OFFLINE', lastReadingAt: null, readingError: true, pairing: null,
    } })
    if (entry.path === '/admin/devices/sensor-1/readings') return reply({ error: 'Sensor readings are temporarily unavailable.' }, 503)
  } })
  await page.goto(origin + '/devices')
  await page.getByRole('button', { name: 'Manage Office sensor', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Device details', exact: true })
  await dialog.getByText('Offline', { exact: true }).waitFor()
  await dialog.getByText('Unavailable', { exact: true }).waitFor()
  await dialog.getByRole('alert').filter({ hasText: 'Sensor readings are temporarily unavailable.' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Try again', exact: true }).isEnabled(), true)
  assert.equal(await dialog.getByText('OFFLINE', { exact: true }).count(), 0)
})

test('platform settings require explicit confirmation and send only changed fields with the version', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(`${origin}/settings`)
  await page.getByRole('switch', { name: 'Enable AI scanning', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Disable platform services?', exact: true })
  await dialog.waitFor()
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 0)
  await dialog.getByLabel('Reason', { exact: true }).fill('Pause scanning for maintenance')
  await dialog.getByRole('button', { name: 'Apply settings', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Platform settings updated.' }).waitFor()
  assert.deepEqual(requests.find(request => request.method === 'PATCH').body, { aiScanningEnabled: false, updatedAt: userVersion, reason: 'Pause scanning for maintenance' })
  await page.getByText(admin.email, { exact: false }).last().waitFor()
  assert.equal(await page.getByRole('switch', { name: 'Enable AI scanning', exact: true }).isChecked(), false)
})

test('provider monitor shows four green configuration cards, runtime model and cloud name without paid requests', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${origin}/integrations`)
  await page.getByRole('heading', { name: 'Gemini', exact: true }).waitFor()
  assert.equal(await page.getByText('Configured', { exact: true }).count(), 4)
  assert.equal(await page.getByText('Not configured', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Quota limits apply', { exact: true }).count(), 4)
  for (const name of ['Gemini', 'Pl@ntNet', 'Perenual', 'Cloudinary']) {
    const card = page.getByRole('article', { name, exact: true })
    const badge = card.getByText('Configured', { exact: true })
    assert.match(await badge.getAttribute('class'), /bg-success-bg text-success-fg/)
    assert.equal(await card.locator('time').getAttribute('datetime'), userVersion)
  }
  await page.getByRole('article', { name: 'Gemini', exact: true }).getByText('gemini-2.5-flash', { exact: true }).waitFor()
  await page.getByRole('article', { name: 'Cloudinary', exact: true }).getByText('leafcheck-plants', { exact: true }).waitFor()
  assert.equal(await page.getByText('Unverified', { exact: true }).count(), 0)
  assert.equal(await page.getByText('None recorded', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Observed application calls', { exact: true }).count(), 0)
  assert.equal(requests.filter(request => /scan|analyze|quota/.test(request.path)).length, 0)
  await screenshot(page, 'integrations-dashboard-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot(page, 'integrations-dashboard-mobile')
})

test('provider monitor updates Last Checked on refresh and preserves the previous snapshot on failure', async t => {
  let currentCheckedAt = userVersion
  let failing = false
  const { page, requests } = await app(t, { restored: true, handle: entry => {
    if (entry.path !== '/admin/integrations') return null
    return failing ? reply({ error: 'Configuration check temporarily unavailable.' }, 503) : reply(integrationPayload(currentCheckedAt))
  } })
  await page.goto(`${origin}/integrations`)
  const checked = page.getByRole('article', { name: 'Last status check', exact: true }).locator('time')
  await checked.waitFor()
  assert.equal(await checked.getAttribute('datetime'), userVersion)
  const initialChecks = requests.filter(request => request.path === '/admin/integrations').length
  currentCheckedAt = '2026-10-17T00:01:00.000Z'
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('article[aria-label="Last status check"] time')?.getAttribute('datetime') === '2026-10-17T00:01:00.000Z')
  failing = true
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Configuration check temporarily unavailable.' }).waitFor()
  assert.equal(await checked.getAttribute('datetime'), '2026-10-17T00:01:00.000Z')
  assert.equal(await page.getByText('Configured', { exact: true }).count(), 4)
  await page.getByText('Showing the last successful configuration check.', { exact: true }).waitFor()
  assert.equal(requests.filter(request => request.path === '/admin/integrations').length, initialChecks + 2)
  assert.equal(requests.filter(request => request.path.startsWith('/admin/') && request.path !== '/admin/integrations').length, 0)
})

test('provider monitor keeps missing credentials neutral and summarizes pending configuration', async t => {
  const { page } = await app(t, { restored: true, handle: entry => entry.path === '/admin/integrations'
    ? reply(integrationPayload(userVersion, ['perenual', 'cloudinary'])) : null })
  await page.goto(`${origin}/integrations`)
  const cloudinary = page.getByRole('article', { name: 'Cloudinary', exact: true })
  await cloudinary.getByRole('heading', { name: 'Cloudinary', exact: true }).waitFor()
  assert.equal(await page.getByText('Not configured', { exact: true }).count(), 2)
  assert.match(await cloudinary.getByText('Not configured', { exact: true }).getAttribute('class'), /bg-panel-muted text-secondary/)
  await cloudinary.getByText('Not set', { exact: true }).waitFor()
  assert.equal(await page.getByRole('article', { name: 'Pending configuration', exact: true }).getByText('2', { exact: false }).count(), 1)
  await page.getByText('2 services need configuration', { exact: true }).waitFor()
})

test('users table supports paginated search, creation, ban/unban and prevents self-ban', async t => {
  const users = Array.from({ length: 26 }, (_, index) => ({ id: index === 0 ? admin.id : `user-${index}`,
    name: index === 0 ? admin.name : `Person ${index}`, emailMasked: `p***${index}@example.test`, role: index === 0 ? 'ADMIN' : 'USER', isActive: true }))
  const { page, requests } = await app(t, { restored: true, users })
  await page.goto(`${origin}/users`)
  await page.getByText('Your account', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: `Ban ${admin.name}`, exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('cell', { name: 'Person 25', exact: true }).waitFor()
  assert.ok(requests.some(request => request.path === '/admin/users' && request.query.get('page') === '2'))
  await page.getByLabel('Search users').fill('Person 1')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('cell', { name: 'Person 1', exact: true }).waitFor()
  assert.equal(requests.at(-1).query.get('q'), 'Person 1')
  assert.equal(requests.at(-1).query.get('page'), '1')
  await page.getByRole('button', { name: 'Ban Person 1', exact: true }).click()
  const banDialog = page.getByRole('dialog', { name: 'Ban user?', exact: true })
  await banDialog.getByText('Are you sure you want to ban p***1@example.test?', { exact: true }).waitFor()
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 0)
  await banDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 0)
  await page.getByRole('button', { name: 'Ban Person 1', exact: true }).click()
  await banDialog.getByRole('button', { name: 'Ban user', exact: true }).click()
  await page.getByRole('button', { name: 'Unban Person 1', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Unban Person 1', exact: true }).click()
  await page.getByRole('button', { name: 'Ban Person 1', exact: true }).waitFor()
  assert.deepEqual(requests.filter(request => request.method === 'PATCH').map(request => request.body), [
    { isActive: false, updatedAt: userVersion }, { isActive: true, updatedAt: new Date(Date.parse(userVersion) + 1).toISOString() },
  ])
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  assert.equal(await page.getByRole('switch', { name: 'Account Active', exact: true }).isChecked(), true)
  await page.getByLabel('Name (optional)', { exact: true }).fill('New Operator')
  await page.getByLabel('Email', { exact: true }).fill('new@example.test')
  await page.getByLabel('Initial password', { exact: true }).fill('strong-password-1')
  await page.getByLabel('Role', { exact: true }).selectOption('LEAD_DEV')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByRole('cell', { name: 'New Operator', exact: true }).waitFor()
  assert.deepEqual(requests.find(request => request.method === 'POST' && request.path === '/admin/users').body,
    { name: 'New Operator', email: 'new@example.test', password: 'strong-password-1', role: 'LEAD_DEV', isActive: true })
  assert.equal(await page.getByRole('cell', { name: 'n***@example.test', exact: true }).count(), 1)
})

test('Create User can start a banned account and reopening the form resets Account Active to true', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  await page.getByRole('switch', { name: 'Account Active', exact: true }).uncheck()
  await page.getByLabel('Name (optional)', { exact: true }).fill('Initially banned')
  await page.getByLabel('Email', { exact: true }).fill('banned@example.test')
  await page.getByLabel('Initial password', { exact: true }).fill('unique-password-1')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Initially banned', exact: true }) })
  await row.getByRole('cell', { name: 'Banned', exact: true }).waitFor()
  assert.equal(await row.getByRole('button', { name: 'Unban Initially banned', exact: true }).count(), 1)
  assert.equal(requests.find(entry => entry.method === 'POST' && entry.path === '/admin/users').body.isActive, false)
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  assert.equal(await page.getByRole('switch', { name: 'Account Active', exact: true }).isChecked(), true)
})

test('session restoration denied for missing admin verification returns to login without fetching admin data', async t => {
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/auth/refresh') return reply({ code: 'ADMIN_VERIFICATION_REQUIRED', error: 'Complete administrator verification.' }, 403)
  } })
  await page.goto(origin + '/dashboard')
  await page.waitForURL('**/login')
  await page.getByRole('alert').filter({ hasText: 'Please sign in again and verify your administrator code.' }).waitFor()
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(entry => entry.path === '/users/me' || entry.path.startsWith('/admin/')).length, 0)
})

test('Users refreshes identical searches and recovers when another administrator removes the last page', async t => {
  const users = Array.from({ length: 26 }, (_, index) => ({ id: 'person-' + index, name: 'Person ' + index,
    emailMasked: 'p***@example.test', role: 'USER', isActive: true }))
  const { page, requests, state } = await app(t, { restored: true, users })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('cell', { name: 'Person 25', exact: true }).waitFor()
  state.users = state.users.slice(0, 25)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Page 1 of 1', { exact: true }).waitFor()
  await page.getByRole('cell', { name: 'Person 0', exact: true }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/admin/users').at(-1).query.get('page'), '1')
  const before = requests.filter(entry => entry.path === '/admin/users').length
  state.users[0].name = 'Updated elsewhere'
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('cell', { name: 'Updated elsewhere', exact: true }).waitFor()
  assert.ok(requests.filter(entry => entry.path === '/admin/users').length > before)
})

test('Create User shows invalid email and short password errors under their fields without a request', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('invalid')
  await page.getByLabel('Initial password', { exact: true }).fill('short')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.locator('#account-email-error').waitFor()
  await page.locator('#account-password-error').waitFor()
  assert.equal(await page.getByLabel('Email', { exact: true }).getAttribute('aria-invalid'), 'true')
  assert.equal(requests.filter(entry => entry.path === '/admin/users' && entry.method === 'POST').length, 0)
  await page.getByLabel('Email', { exact: true }).fill('valid@example.test')
  assert.equal(await page.locator('#account-email-error').count(), 0)
})

test('provider weak-password errors appear beneath Password and preserve entered values', async t => {
  const { page } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/admin/users' && entry.method === 'POST') return reply({ error: 'Password too weak.', code: 'WEAK_PASSWORD',
      fieldErrors: { password: 'Password too weak. Choose a longer, unique password.' } }, 400)
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('new@example.test')
  await page.getByLabel('Initial password', { exact: true }).fill('aaaaaaaa')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.locator('#account-password-error').filter({ hasText: 'Password too weak.' }).waitFor()
  assert.equal(await page.getByLabel('Initial password', { exact: true }).inputValue(), 'aaaaaaaa')
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'new@example.test')
  assert.equal(await page.getByRole('dialog').locator('.notice-error').count(), 0)
  await page.getByLabel('Initial password', { exact: true }).fill('longer-unique-password')
  assert.equal(await page.locator('#account-password-error').count(), 0)
})

test('edit validation maps backend name errors to Name and keeps the dialog open', async t => {
  const { page } = await app(t, { restored: true, handle: async entry => {
    if (entry.method === 'PATCH') return reply({ error: 'Invalid name.', code: 'INVALID_INPUT', fieldErrors: { name: 'Please choose another name.' } }, 400)
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Changed name')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.locator('#account-name-error').filter({ hasText: 'Please choose another name.' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Edit user', exact: true }).count(), 1)
})

test('audit table renders actor emails and distinguishes success, failure and requested actions', async t => {
  const { page } = await app(t, { restored: true })
  await page.goto(`${origin}/audit`)
  for (const outcome of ['Succeeded', 'Failed', 'Requested']) await page.getByRole('cell', { name: outcome, exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'Deleted account', exact: true }).count(), 1)
  assert.equal(await page.getByRole('cell', { name: 'User Updated', exact: true }).count(), 1)
  assert.equal(await page.getByRole('cell', { name: member.email, exact: true }).count(), 1)
})

test('a failed ban leaves the account active and shows the backend error', async t => {
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === `/admin/users/${member.id}` && entry.method === 'PATCH') return reply({ code: 'ADMIN_CONFLICT', error: 'Account changed. Review and retry.' }, 409)
  } })
  await page.goto(`${origin}/users`)
  await page.getByRole('button', { name: 'Ban Member', exact: true }).click()
  await page.getByRole('dialog', { name: 'Ban user?', exact: true }).getByRole('button', { name: 'Ban user', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Account changed. Review and retry.' }).waitFor()
  await page.getByRole('dialog', { name: 'Ban user?', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Member', exact: true }) })
  assert.equal(await row.getByRole('cell', { name: 'Active', exact: true }).count(), 1)
  assert.equal(await row.getByRole('button', { name: 'Ban Member', exact: true }).isEnabled(), true)
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 1)
})

test('a ban conflict requires reviewing the current account before another submission', async t => {
  const { page, requests } = await app(t, { restored: true, handle: (entry, state) => {
    if (entry.path === `/admin/users/${member.id}` && entry.method === 'PATCH') {
      const row = state.users.find(user => user.id === member.id)
      row.name = 'Updated member'
      row.updatedAt = new Date(Date.parse(userVersion) + 1).toISOString()
      return reply({ code: 'CONFLICT', error: 'This user was modified by another administrator. Please refresh.' }, 409)
    }
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Reveal emails', exact: true }).click()
  await page.getByRole('cell', { name: member.email, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Ban Member', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ban user?', exact: true })
  await dialog.getByText(`Are you sure you want to ban ${member.email}?`, { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Ban user', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'modified by another administrator' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Ban user', exact: true }).isDisabled(), true)
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, 1)
  await dialog.getByRole('button', { name: 'Close and refresh', exact: true }).click()
  await page.getByRole('button', { name: 'Ban Updated member', exact: true }).waitFor()
})

for (const failure of ['conflict', 'timeout']) test(`unban can retry after ${failure} and a table refresh without opening another dialog`, async t => {
  let writes = 0;
  const { page, requests } = await app(t, { restored: true, users: [
    { ...admin, emailMasked: 'a***@example.test', isActive: true },
    { ...member, emailMasked: 'm***@example.test', isActive: false },
  ], handle: (entry, state) => {
    if (entry.path === `/admin/users/${member.id}` && entry.method === 'PATCH' && ++writes === 1) {
      state.users.find(user => user.id === member.id).updatedAt = new Date(Date.parse(userVersion) + 1).toISOString();
      return failure === 'conflict' ? reply({ code: 'CONFLICT', error: 'Account changed. Refresh and retry.' }, 409)
        : reply({ error: 'Gateway timeout' }, 504);
    }
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Unban Member', exact: true }).click()
  await page.getByRole('alert').waitFor()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('button', { name: 'Unban Member', exact: true }).click()
  await page.getByRole('button', { name: 'Ban Member', exact: true }).waitFor()
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, 2)
  assert.equal(await page.getByRole('dialog').count(), 0)
})

test('desktop table contains maximum-length valid account text without unnecessary scrolling', async t => {
  const email = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(56) + '.test'
  const { page } = await app(t, { restored: true, users: [
    { ...admin, emailMasked: 'a***@example.test', isActive: true },
    { ...member, name: 'W'.repeat(100), email, emailMasked: 'm***@example.test', isActive: true },
  ] })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Reveal emails', exact: true }).click()
  const emailCell = page.getByRole('cell', { name: email, exact: true })
  await emailCell.waitFor()
  const region = page.getByRole('region', { name: 'User table', exact: true })
  assert.equal(await region.evaluate(node => node.scrollWidth <= node.clientWidth), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await emailCell.evaluate(node => node.scrollWidth <= node.clientWidth), true)
  await screenshot(page, 'users-1920-long-email')
})

test('user columns stay readable on small laptops and overflow is contained within the table', async t => {
  const { page } = await app(t, { restored: true })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Reveal emails', exact: true }).click()
  await page.getByRole('cell', { name: member.email, exact: true }).waitFor()
  for (const width of [1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 768 })
    const region = page.getByRole('region', { name: 'User table', exact: true })
    const row = region.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Member', exact: true }) })
    const cells = row.getByRole('cell')
    assert.ok((await cells.nth(0).boundingBox()).width >= 200)
    assert.ok((await cells.nth(1).boundingBox()).width >= 200)
    assert.ok((await cells.nth(1).boundingBox()).height < 80)
    assert.ok((await cells.nth(4).boundingBox()).width >= 150)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    const scroll = await region.evaluate(node => {
      node.scrollLeft = node.scrollWidth
      return { width: node.clientWidth, total: node.scrollWidth, left: node.scrollLeft, overflow: getComputedStyle(node).overflowX }
    })
    assert.equal(scroll.overflow, 'auto')
    if (width === 1024) { assert.ok(scroll.total > scroll.width); assert.ok(scroll.left > 0) }
    if (width === 1920) { assert.equal(scroll.total, scroll.width); assert.equal(scroll.left, 0) }
    await region.evaluate(node => { node.scrollLeft = 0 })
    await screenshot(page, `users-${width}`)
  }
})

test('a lost admin verification signs out instead of refreshing or repeatedly requesting admin data', async t => {
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/admin/users') return reply({ code: 'ADMIN_VERIFICATION_REQUIRED', error: 'Verification required.' }, 403)
  } })
  await page.goto(`${origin}/users`)
  await page.waitForURL('**/login')
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(request => request.path === '/auth/refresh').length, 1)
  assert.equal(requests.filter(request => request.path === '/auth/logout').length, 1)
})

test('table failures are retryable and degraded telemetry is reported without inventing device status', async t => {
  let unavailable = true
  const { page } = await app(t, { actor: operator, restored: true, handle: async entry => {
    if (entry.path === '/admin/devices' && unavailable) return reply({ error: 'Inventory temporarily unavailable.' }, 503)
    if (entry.path === '/admin/devices') return reply(list([{ ...sensor, connectionStatus: 'UNKNOWN' }], 1, 1, { telemetryDegraded: true }))
  } })
  await page.goto(`${origin}/devices`)
  await page.getByRole('alert').filter({ hasText: 'Inventory temporarily unavailable.' }).waitFor()
  unavailable = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByRole('cell', { name: 'Unknown', exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: 'Some sensor readings are temporarily unavailable.' }).waitFor()
})

test('Overview shows real metric cards and only the five most recent audit entries', async t => {
  const auditEntries = Array.from({ length: 7 }, (_, index) => ({ id: 'log-' + index, actorId: admin.id,
    actorEmail: admin.email, targetId: 'target-' + index, targetEmail: 'target' + index + '@example.test',
    action: 'ADMIN_LOGIN_VERIFIED', createdAt: new Date().toISOString(), metadata: {} }))
  const { page, requests } = await app(t, { restored: true, auditEntries })
  await page.goto(origin + '/dashboard')
  await page.getByRole('article', { name: 'Plants registered', exact: true }).getByText('23', { exact: true }).waitFor()
  await page.getByRole('article', { name: 'AI scans', exact: true }).getByText('48', { exact: true }).waitFor()
  await page.getByRole('cell', { name: 'target4@example.test', exact: true }).waitFor()
  assert.equal(await page.getByRole('table').getByRole('row').count(), 6)
  assert.equal(await page.getByRole('cell', { name: 'target5@example.test', exact: true }).count(), 0)
  assert.ok(requests.some(request => request.path === '/admin/audit' && request.query.get('pageSize') === '5'))
  await screenshot(page, 'overview-light')
})

test('unavailable telemetry does not turn active-device metrics into a false zero', async t => {
  const { page } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/admin/stats') return reply({ data: { totalUsers: 18, totalDevices: 2, totalPhysicalDevices: 2, activeDevices: null, totalActiveDevices: null, totalPlants: 23, totalAiScans: 48 },
      meta: { asOf: new Date().toISOString(), telemetryDegraded: true } })
  } })
  await page.goto(origin + '/dashboard')
  await page.getByRole('article', { name: 'Active devices', exact: true }).getByText('Unavailable', { exact: true }).waitFor()
  assert.equal(await page.getByRole('article', { name: 'Total users', exact: true }).getByText('18', { exact: true }).count(), 1)
  await page.getByRole('status').filter({ hasText: 'Live device connectivity is temporarily unavailable.' }).waitFor()
})

test('zero online devices still show the registered inventory total', async t => {
  const { page } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/admin/stats') return reply({ data: { totalUsers: 2, totalDevices: 2, totalPhysicalDevices: 1,
      activeDevices: 0, totalActiveDevices: 0, totalPlants: 2, totalAiScans: 5 }, meta: { asOf: new Date().toISOString(), telemetryDegraded: false } })
  } })
  await page.goto(origin + '/dashboard')
  const card = page.getByRole('article', { name: 'Active devices', exact: true })
  await card.getByText('0 online / 2 total', { exact: true }).waitFor()
  await card.getByText(/1 simulated included in total/).waitFor()
})

test('device polling updates status each minute, pauses while hidden, and refreshes on return', async t => {
  let late = false
  const { page, requests } = await app(t, { restored: true, actor: operator, handle: async entry => {
    if (entry.path === '/admin/devices') return reply(list([{ ...sensor, connectionStatus: late ? 'OFFLINE' : 'ONLINE',
      lastReadingAt: new Date(Date.now() - (late ? 31 * 60_000 : 120_000)).toISOString() }]))
  } })
  await page.goto(origin + '/devices')
  await page.getByRole('cell', { name: 'Online', exact: true }).waitFor()
  const initial = requests.filter(entry => entry.path === '/admin/devices').length
  late = true
  await page.clock.fastForward(60_001)
  await page.getByRole('cell', { name: 'Offline', exact: true }).waitFor()
  assert.ok(requests.filter(entry => entry.path === '/admin/devices').length > initial)
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }))
  const hidden = requests.filter(entry => entry.path === '/admin/devices').length
  await page.clock.fastForward(60_001)
  assert.equal(requests.filter(entry => entry.path === '/admin/devices').length, hidden)
  late = false
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('cell', { name: 'Online', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  const left = requests.filter(entry => entry.path === '/admin/devices').length
  await page.clock.fastForward(60_001)
  assert.equal(requests.filter(entry => entry.path === '/admin/devices').length, left)
})

test('system health distinguishes a telemetry outage, recovery, and unknown databases when the API fails', async t => {
  let status = 'degraded'
  const { page } = await app(t, { restored: true, actor: operator, handle: async entry => {
    if (entry.path === '/admin/health') return status === 'offline' ? reply({ error: 'Service unavailable' }, 503)
      : reply({ api: 'ok', postgres: 'ok', mongo: status === 'degraded' ? 'down' : 'ok' })
  } })
  await page.goto(origin + '/dashboard')
  const health = page.getByRole('article', { name: 'System Health', exact: true })
  await health.locator('dl > div').filter({ hasText: 'Telemetry (MongoDB)' }).getByText('Unavailable', { exact: true }).waitFor()
  assert.equal(await health.getByText('Healthy', { exact: true }).count(), 2)
  status = 'healthy'
  await page.clock.fastForward(60_001)
  await health.locator('dl > div').filter({ hasText: 'Telemetry (MongoDB)' }).getByText('Healthy', { exact: true }).waitFor()
  status = 'offline'
  await health.getByRole('button', { name: 'Refresh system health', exact: true }).click()
  await health.getByRole('alert').filter({ hasText: 'System health could not be confirmed.' }).waitFor()
  await health.locator('dl > div').filter({ hasText: 'API' }).getByText('Unavailable', { exact: true }).waitFor()
  assert.equal(await health.getByText('Unknown', { exact: true }).count(), 2)
})

test('audit filters reset pagination, include full local dates, and offer useful empty and clear states', async t => {
  const auditEntries = Array.from({ length: 30 }, (_, index) => ({ id: 'event-' + index, actorId: admin.id, actorEmail: admin.email,
    targetId: member.id, targetEmail: member.email, action: index % 2 ? 'USER_UPDATED' : 'USER_DELETED',
    createdAt: '2026-10-17T04:00:00.000Z', metadata: {} }))
  const { page, requests } = await app(t, { restored: true, auditEntries, timezoneId: 'Asia/Manila' })
  await page.goto(origin + '/audit')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByText('Page 2 of 2', { exact: true }).waitFor()
  await page.getByLabel('Action', { exact: true }).fill('user_updated')
  await page.getByLabel('From Date', { exact: true }).fill('2026-10-17')
  await page.getByLabel('To Date', { exact: true }).fill('2026-10-17')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page.getByText('1–15 of 15 results', { exact: true }).waitFor()
  const filtered = requests.filter(entry => entry.path === '/admin/audit').at(-1)
  assert.equal(filtered.query.get('page'), '1')
  assert.equal(filtered.query.get('action'), 'USER_UPDATED')
  assert.equal(filtered.query.get('from'), '2026-10-16T16:00:00.000Z')
  assert.equal(filtered.query.get('to'), '2026-10-17T15:59:59.999Z')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot(page, 'audit-filters-mobile')
  await page.getByLabel('Action', { exact: true }).fill('ADMIN_LOGIN_VERIFIED')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'No activity matches these filters.' }).waitFor()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.getByText('1–25 of 30 results', { exact: true }).waitFor()
  const cleared = requests.filter(entry => entry.path === '/admin/audit').at(-1)
  for (const key of ['action', 'from', 'to', 'actorId', 'targetId']) assert.equal(cleared.query.has(key), false)
})

test('invalid audit dates do not make a request and actor/target filters are forwarded after correction', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/audit')
  await page.getByRole('cell', { name: 'User Updated', exact: true }).waitFor()
  const before = requests.filter(entry => entry.path === '/admin/audit').length
  await page.getByLabel('From Date', { exact: true }).fill('2026-10-18')
  await page.getByLabel('To Date', { exact: true }).fill('2026-10-17')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'To Date must be on or after From Date.' }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/admin/audit').length, before)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.getByText('Actor and target filters', { exact: true }).click()
  const actorId = '00000000-0000-4000-8000-000000000001'
  await page.getByLabel('Actor ID', { exact: true }).fill(actorId)
  await page.getByLabel('Target ID', { exact: true }).fill('deleted-account')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'No activity matches these filters.' }).waitFor()
  const filtered = requests.filter(entry => entry.path === '/admin/audit').at(-1)
  assert.equal(filtered.query.get('actorId'), actorId)
  assert.equal(filtered.query.get('targetId'), 'deleted-account')
})

test('email reveal requests full addresses only when enabled and hides them again', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('cell', { name: 'm***@example.test', exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: member.email, exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Reveal emails', exact: true }).click()
  await page.getByRole('cell', { name: member.email, exact: true }).waitFor()
  assert.equal(requests.filter(request => request.path === '/admin/users').at(-1).query.get('revealEmails'), 'true')
  await page.getByRole('button', { name: 'Hide emails', exact: true }).click()
  await page.getByRole('cell', { name: 'm***@example.test', exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: member.email, exact: true }).count(), 0)
  assert.equal(requests.filter(request => request.path === '/admin/users').at(-1).query.get('revealEmails'), null)
})

test('edit dialog changes name and role, with Escape restoring focus to its trigger', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await page.getByRole('dialog', { name: 'Edit user', exact: true }).waitFor()
  await screenshot(page, 'edit-user')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: 'Edit Member', exact: true }).evaluate(element => element === document.activeElement), true)
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Updated Member')
  await page.getByLabel('Role', { exact: true }).selectOption('LEAD_DEV')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('cell', { name: 'Updated Member', exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'System Administrator', exact: true }).count(), 1)
  assert.deepEqual(requests.find(request => request.method === 'PATCH').body, { name: 'Updated Member', role: 'LEAD_DEV', updatedAt: userVersion })
})

test('name-only edits omit unchanged roles, and unchanged forms make no write', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 0)
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Name only')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('cell', { name: 'Name only', exact: true }).waitFor()
  assert.deepEqual(requests.find(request => request.method === 'PATCH').body, { name: 'Name only', updatedAt: userVersion })
})

test('a stale edit explains the conflict and requires a refresh before another save', async t => {
  const { page, requests, state } = await app(t, { restored: true, users: [
    { ...admin, emailMasked: 'a***@example.test', isActive: true },
    { ...member, role: 'ADMIN', emailMasked: 'm***@example.test', isActive: true },
  ] })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  const target = state.users.find(row => row.id === member.id)
  target.role = 'USER'
  target.updatedAt = new Date(Date.parse(userVersion) + 1).toISOString()
  await page.getByLabel('Name', { exact: true }).fill('Stale name')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'This user was modified by another administrator. Please refresh.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(), true)
  assert.deepEqual(requests.find(request => request.method === 'PATCH').body, { name: 'Stale name', updatedAt: userVersion })
  assert.equal(target.role, 'USER')
  assert.equal(target.name, 'Member')
  await page.getByRole('button', { name: 'Close and refresh', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  assert.equal(await page.getByLabel('Role', { exact: true }).inputValue(), 'USER')
})

test('Escape aborts a pending save and leaves a clear recovery message', async t => {
  const { page } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await stallWrite(page, 'PATCH')
  await page.getByLabel('Name', { exact: true }).fill('Pending change')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(() => window.testWritePending)
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Close dialog', exact: true }).isEnabled(), true)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.testWriteAborted)
  await page.getByRole('alert').filter({ hasText: 'Request cancelled. The server may already have applied the change.' }).waitFor()
  await page.getByRole('button', { name: 'Edit Member', exact: true }).waitFor({ state: 'visible' })
})

test('Cancel aborts a pending deletion without claiming the account was deleted', async t => {
  const { page } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Delete Member', exact: true }).click()
  await stallWrite(page, 'DELETE')
  await page.getByLabel('Type DELETE to confirm.').fill('DELETE')
  await page.getByRole('button', { name: 'Delete user', exact: true }).click()
  await page.waitForFunction(() => window.testWritePending)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.testWriteAborted)
  await page.getByRole('cell', { name: 'Member', exact: true }).waitFor()
  assert.equal(await page.getByText('Member deleted successfully.', { exact: true }).count(), 0)
})

test('login waits through a fifty-second cold start and shows the waking message at sixty seconds', async t => {
  const { page } = await app(t)
  await page.goto(origin + '/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByLabel('Password', { exact: true }).fill('correct-password')
  await stallWrite(page, 'POST', true, '/api/auth/login')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForFunction(() => window.testWritePending)
  await page.clock.fastForward(50000)
  assert.equal(await page.getByRole('button', { name: 'Signing in...', exact: true }).count(), 1)
  await page.clock.fastForward(10001)
  await page.getByRole('alert').filter({ hasText: 'The server is waking up. Please wait a moment and try again.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true)
  assert.equal(await memoryToken(page), null)
})

test('a stalled save times out after sixty seconds and requires review before retry', async t => {
  const { page } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await stallWrite(page, 'PATCH', true)
  await page.getByLabel('Name', { exact: true }).fill('Pending change')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(() => window.testWritePending)
  await page.clock.fastForward(59000)
  assert.equal(await page.getByRole('button', { name: 'Saving...', exact: true }).count(), 1)
  await page.clock.fastForward(1001)
  await page.getByRole('alert').filter({ hasText: 'Its result is unknown.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Close and refresh', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('cell', { name: 'Member', exact: true }).waitFor()
})

test('a gateway timeout after creation requires review instead of allowing a duplicate submission', async t => {
  const { page, requests } = await app(t, { restored: true, handle: async (entry, state) => {
    if (entry.path === '/admin/users' && entry.method === 'POST') {
      state.users.push({ id: 'committed-user', name: 'Created before timeout', role: 'USER', isActive: true,
        emailMasked: 'c***@example.test', updatedAt: userVersion })
      return reply({ error: 'Gateway timeout' }, 504)
    }
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('created@example.test')
  await page.getByLabel('Initial password', { exact: true }).fill('long-unique-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Its result is unknown.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Create account', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Close and refresh', exact: true }).click()
  await page.getByRole('cell', { name: 'Created before timeout', exact: true }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/admin/users' && entry.method === 'POST').length, 1)
})

for (const retryStatus of [204, 401]) {
  test(`logout refreshes and retries once after a 401 when the retry returns ${retryStatus}`, async t => {
    let logoutCalls = 0
    const { page, requests } = await app(t, { restored: true, handle: async (entry, state) => {
      if (entry.path !== '/auth/logout') return
      assert.equal(entry.headers.authorization, 'Bearer verified-memory-jwt')
      if (++logoutCalls === 1) return reply({ error: 'Expired', code: 'INVALID_SESSION' }, 401)
      state.signedIn = false
      return retryStatus === 204 ? { status: 204 } : reply({ error: 'Still expired' }, 401)
    } })
    await page.goto(origin + '/dashboard')
    await page.getByRole('button', { name: 'Log out', exact: true }).waitFor()
    const start = requests.length
    await page.getByRole('button', { name: 'Log out', exact: true }).click()
    await page.waitForURL('**/login')
    assert.deepEqual(requests.slice(start).filter(entry => entry.path.startsWith('/auth/')).map(entry => entry.path),
      ['/auth/logout', '/auth/refresh', '/auth/logout'])
    assert.equal(await memoryToken(page), null)
  })
}

test('logout finishes locally when the refresh attempt after a 401 is rejected', async t => {
  let logoutStarted = false
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/auth/logout') {
      logoutStarted = true
      return reply({ error: 'Expired', code: 'INVALID_SESSION' }, 401, {
        'Set-Cookie': '__Host-leafcheck-refresh=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      })
    }
    if (entry.path === '/auth/refresh' && logoutStarted) return reply({ error: 'No refresh cookie' }, 401)
  } })
  await page.goto(origin + '/dashboard')
  await page.getByRole('button', { name: 'Log out', exact: true }).waitFor()
  const start = requests.length
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await page.waitForURL('**/login')
  assert.deepEqual(requests.slice(start).filter(entry => entry.path.startsWith('/auth/')).map(entry => entry.path),
    ['/auth/logout', '/auth/refresh'])
  assert.equal(await memoryToken(page), null)
  await page.reload()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  assert.equal(await memoryToken(page), null)
})

test('failed refresh shows a session-expired alert during logout and on the login screen', async t => {
  let failRefresh = false, releaseLogout
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.method === 'PATCH') return reply({ error: 'Expired', code: 'INVALID_SESSION' }, 401)
    if (entry.path === '/auth/refresh' && failRefresh) return reply({ error: 'Refresh expired' }, 401)
    if (entry.path === '/auth/logout') return new Promise(resolve => { releaseLogout = () => resolve({ status: 204 }) })
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Ban Member', exact: true }).waitFor()
  failRefresh = true
  await page.getByRole('button', { name: 'Ban Member', exact: true }).click()
  await page.getByRole('dialog', { name: 'Ban user?', exact: true }).getByRole('button', { name: 'Ban user', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Your session has expired. Please log in again.' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/users')
  releaseLogout()
  await page.waitForURL('**/login')
  await page.getByRole('alert').filter({ hasText: 'Your session has expired. Please log in again.' }).waitFor()
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, 1)
})

test('delete requires explicit confirmation, removes the user and never offers self-deletion', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Delete Member', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete user?', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Delete user', exact: true }).isDisabled(), true)
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 0)
  await page.getByLabel('Type DELETE to confirm.').fill('DELETE')
  await page.getByRole('button', { name: 'Delete user', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Member deleted successfully.' }).waitFor()
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 1)
  assert.equal(await page.getByRole('button', { name: 'Delete ' + admin.name, exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Edit ' + admin.name, exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'Member', exact: true }).count(), 0)
})

test('last-SuperAdmin protection remains visible in the edit dialog without changing local privileges', async t => {
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === '/admin/users/' + admin.id && entry.method === 'PATCH') return reply({ code: 'LAST_ADMIN', error: 'The last active SuperAdmin cannot be removed or demoted.' }, 409)
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit ' + admin.name, exact: true }).click()
  await page.getByLabel('Role', { exact: true }).selectOption('LEAD_DEV')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'last active SuperAdmin cannot be removed' }).waitFor()
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(requests.filter(request => request.path === '/auth/logout').length, 0)
})

test('changing your own role signs out rather than retaining an obsolete admin session', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit ' + admin.name, exact: true }).click()
  await page.getByLabel('Role', { exact: true }).selectOption('LEAD_DEV')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForURL('**/login')
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(request => request.path === '/auth/logout').length, 1)
})

test('Last Seen advances with time and online status has both a dot and a text label', async t => {
  const { page } = await app(t, { actor: operator, restored: true })
  await page.goto(origin + '/devices')
  await page.getByRole('cell', { name: '2 minutes ago', exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'Online', exact: true }).locator('[aria-hidden="true"]').count(), 1)
  await page.clock.fastForward(61_000)
  await page.getByRole('cell', { name: '3 minutes ago', exact: true }).waitFor()
})

test('dark mode persists only the theme preference and remains usable on narrow screens', async t => {
  const { page } = await app(t, { restored: true })
  await page.goto(origin + '/dashboard')
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), true)
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['leafcheck-admin-theme'])
  await page.getByRole('article', { name: 'AI scans', exact: true }).getByText('48', { exact: true }).waitFor()
  await screenshot(page, 'overview-dark')
  await page.reload()
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).waitFor()
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), true)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot(page, 'overview-dark-mobile')
})

test('password warnings remain advisory and a successful change clears the banner for both staff roles', async t => {
  for (const actor of [admin, operator]) {
    let changed = false
    const warning = { daysUntilExpiry: 6, isExpiringSoon: true, isExpired: false }
    const fresh = { daysUntilExpiry: 30, isExpiringSoon: false, isExpired: false }
    const { page, requests } = await app(t, { actor, restored: true, handle: entry => {
      if (entry.path === '/users/me') return reply({ ...actor, passwordPolicy: changed ? fresh : warning })
      if (entry.path === '/auth/change-password') {
        assert.equal(entry.method, 'POST')
        assert.equal(entry.headers.authorization, 'Bearer verified-memory-jwt')
        assert.deepEqual(entry.body, { currentPassword: 'original password', newPassword: '  new password value  ' })
        changed = true
        return reply({ ...actor, passwordChangedAt: new Date().toISOString(), passwordPolicy: fresh })
      }
    } })
    await page.goto(origin + '/dashboard')
    await page.getByText('Your password expires in 6 days. Please update it soon.', { exact: false }).waitFor()
    await page.getByRole('link', { name: 'Change Password', exact: true }).click()
    await page.waitForURL('**/change-password')
    await page.getByLabel('Current Password', { exact: true }).fill('original password')
    await page.getByLabel('New Password', { exact: true }).fill('  new password value  ')
    await page.getByLabel('Confirm New Password', { exact: true }).fill('different password')
    await page.getByRole('button', { name: 'Update Password', exact: true }).click()
    await page.getByText('The new passwords do not match.', { exact: true }).waitFor()
    assert.equal(requests.filter(entry => entry.path === '/auth/change-password').length, 0)
    await page.getByLabel('Confirm New Password', { exact: true }).fill('  new password value  ')
    await page.getByRole('button', { name: 'Update Password', exact: true }).click()
    await page.getByText('Password updated successfully. Your other sessions have been signed out.', { exact: true }).waitFor()
    assert.equal(await page.getByText('Your password expires in 6 days.', { exact: false }).count(), 0)
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '')
    assert.equal(await memoryToken(page), 'verified-memory-jwt')
    assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
    assert.equal(requests.filter(entry => entry.path === '/auth/change-password').length, 1)
    assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []])
    await page.reload()
    await page.getByRole('heading', { name: 'Change Password', exact: true }).waitFor()
    assert.equal(await page.getByText('Your password expires', { exact: false }).count(), 0)
  }
})

test('expired password warnings allow dashboard access and password repair without a redirect loop', async t => {
  const { page } = await app(t, { restored: true, handle: entry => entry.path === '/users/me'
    ? reply({ ...admin, passwordPolicy: { daysUntilExpiry: 0, isExpiringSoon: true, isExpired: true } }) : undefined })
  await page.goto(origin + '/dashboard')
  await page.getByText('Your password is at least 30 days old. Please update it.', { exact: false }).waitFor()
  await page.getByRole('article', { name: 'AI scans', exact: true }).waitFor()
  assert.ok(page.url().endsWith('/dashboard'))
  await page.getByRole('link', { name: 'Change Password', exact: true }).click()
  await page.getByLabel('Current Password', { exact: true }).waitFor()
  assert.ok(page.url().endsWith('/change-password'))
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
})

test('unknown password history does not warn and anonymous users cannot open password repair', async t => {
  const restored = await app(t, { restored: true, handle: entry => entry.path === '/users/me'
    ? reply({ ...admin, passwordChangedAt: null, passwordPolicy: { daysUntilExpiry: 30, isExpiringSoon: false, isExpired: false } }) : undefined })
  await restored.page.goto(origin + '/change-password')
  await restored.page.getByLabel('Current Password', { exact: true }).waitFor()
  assert.equal(await restored.page.getByText('Your password expires', { exact: false }).count(), 0)
  const anonymous = await app(t)
  await anonymous.page.goto(origin + '/change-password')
  await anonymous.page.waitForURL('**/login')
  assert.equal(await anonymous.page.getByLabel('Current Password', { exact: true }).count(), 0)
})

test('incorrect passwords and duplicate submissions keep the session and never replay a pending change', async t => {
  let release
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path !== '/auth/change-password') return
    if (entry.body.currentPassword === 'incorrect password') return reply({ code: 'CURRENT_PASSWORD_INVALID', error: 'Your current password is incorrect.',
      fieldErrors: { currentPassword: 'Your current password is incorrect.' } }, 400)
    await new Promise(resolve => { release = resolve })
    return reply({ ...admin, passwordPolicy: { daysUntilExpiry: 30, isExpiringSoon: false, isExpired: false } })
  } })
  await page.goto(origin + '/change-password')
  await page.getByLabel('Current Password', { exact: true }).fill('incorrect password')
  await page.getByLabel('New Password', { exact: true }).fill('replacement password')
  await page.getByLabel('Confirm New Password', { exact: true }).fill('replacement password')
  await page.getByRole('button', { name: 'Update Password', exact: true }).click()
  await page.locator('#currentPassword-error').waitFor()
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  await page.getByLabel('Current Password', { exact: true }).fill('original password')
  const requestStarted = page.waitForRequest(request => request.url().endsWith('/auth/change-password') && request.postDataJSON().currentPassword === 'original password')
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  await requestStarted
  assert.equal(await page.getByRole('button', { name: 'Updating password...', exact: true }).isDisabled(), true)
  assert.equal(requests.filter(entry => entry.path === '/auth/change-password').length, 2)
  release()
  await page.getByText('Password updated successfully.', { exact: false }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
})

test('password repair refreshes an expired access token once and late responses cannot undo logout', async t => {
  let attempts = 0
  const refreshed = await app(t, { restored: true, handle: entry => {
    if (entry.path !== '/auth/change-password') return
    attempts++
    return attempts === 1 ? reply({ code: 'INVALID_SESSION', error: 'Expired access token.' }, 401)
      : reply({ ...admin, passwordPolicy: { daysUntilExpiry: 30, isExpiringSoon: false, isExpired: false } })
  } })
  await refreshed.page.goto(origin + '/change-password')
  for (const [label, value] of [['Current Password', 'original password'], ['New Password', 'replacement password'], ['Confirm New Password', 'replacement password']])
    await refreshed.page.getByLabel(label, { exact: true }).fill(value)
  await refreshed.page.getByRole('button', { name: 'Update Password', exact: true }).click()
  await refreshed.page.getByText('Password updated successfully.', { exact: false }).waitFor()
  assert.equal(attempts, 2)
  assert.equal(refreshed.requests.filter(entry => entry.path === '/auth/refresh').length, 2)

  let release
  const late = await app(t, { restored: true, handle: async entry => {
    if (entry.path !== '/auth/change-password') return
    await new Promise(resolve => { release = resolve })
    return reply({ ...admin, passwordPolicy: { daysUntilExpiry: 30, isExpiringSoon: false, isExpired: false } })
  } })
  await late.page.goto(origin + '/change-password')
  for (const [label, value] of [['Current Password', 'original password'], ['New Password', 'replacement password'], ['Confirm New Password', 'replacement password']])
    await late.page.getByLabel(label, { exact: true }).fill(value)
  const requestStarted = late.page.waitForRequest(request => request.url().endsWith('/auth/change-password'))
  await late.page.getByRole('button', { name: 'Update Password', exact: true }).click()
  await requestStarted
  await late.page.getByRole('button', { name: 'Log out', exact: true }).click()
  await late.page.waitForURL('**/login')
  const responseFinished = late.page.waitForResponse(response => response.url().endsWith('/auth/change-password'))
  release()
  await responseFinished
  assert.equal(await memoryToken(late.page), null)
  assert.ok(late.page.url().endsWith('/login'))
})

test('inactivity signs out once at five minutes despite background polling and synthetic input', async t => {
  const { page, requests } = await app(t, { restored: true, actor: operator, handle: (entry, state) => {
    // A poll already dispatched at the boundary is rejected like the real backend.
    if (entry.path.startsWith('/admin/') && !state.signedIn)
      return reply({ error: 'Expired', code: 'INVALID_SESSION' }, 401)
  } })
  await page.goto(origin + '/devices')
  await page.getByRole('cell', { name: 'Online', exact: true }).waitFor()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.mouse.move(20, 20)
  const polls = requests.filter(entry => entry.path === '/admin/devices').length
  for (let minute = 0; minute < 4; minute++) {
    const refreshed = page.waitForResponse(response => response.url().includes('/admin/devices?'))
    await page.clock.fastForward(60_000)
    await refreshed
  }
  assert.ok(requests.filter(entry => entry.path === '/admin/devices').length >= polls + 4)
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousemove')))
  await page.clock.fastForward(59_999)
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
  await page.clock.fastForward(1)
  await page.waitForURL('**/login')
  assert.equal(await memoryToken(page), null)
  await page.clock.fastForward(301_000)
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 1)
})

for (const input of ['pointerdown', 'keydown', 'mousemove']) {
  test(`inactivity is reset by trusted ${input} without changing the authenticated session`, async t => {
    const { page, requests } = await app(t, { restored: true })
    await page.goto(origin + '/dashboard')
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    await page.mouse.move(10, 10)
    await page.clock.fastForward(240_000)
    if (input === 'pointerdown') { await page.mouse.down(); await page.mouse.up() }
    else if (input === 'keydown') await page.keyboard.press('Shift')
    else await page.mouse.move(30, 30)
    await page.clock.fastForward(299_999)
    assert.equal(await memoryToken(page), 'verified-memory-jwt')
    assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
    await page.clock.fastForward(1)
    await page.waitForURL('**/login')
    assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 1)
  })
}

test('inactivity allows a fifty-second save started near the old deadline to finish', async t => {
  let release, started
  const pending = new Promise(resolve => { started = resolve })
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.method === 'PATCH') {
      started()
      await new Promise(resolve => { release = resolve })
    }
  } })
  await page.goto(origin + '/users')
  await page.getByRole('button', { name: 'Edit Member', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Renamed during cold start')
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.mouse.move(10, 10)
  await page.clock.fastForward(290_000)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await pending
  await page.clock.fastForward(50_000)
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
  release()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('cell', { name: 'Renamed during cold start', exact: true }).waitFor()
  assert.equal(requests.filter(entry => entry.method === 'PATCH').length, 1)
})

test('inactivity checks elapsed time on tab return before accepting new activity', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/dashboard')
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }))
  await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 301_000))
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForURL('**/login')
  await page.mouse.move(30, 30)
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 1)
})

test('inactivity cleanup leaves a new sign-in its full deadline after manual logout', async t => {
  const { page, requests } = await app(t, { restored: true })
  await page.goto(origin + '/dashboard')
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.clock.fastForward(240_000)
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await page.waitForURL('**/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByLabel('Password', { exact: true }).fill('correct-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/login/otp')
  await page.getByLabel('Verification code').fill('00001234')
  await page.getByRole('button', { name: 'Verify Code', exact: true }).click()
  await page.waitForURL('**/dashboard')
  await page.mouse.move(20, 20)
  await page.clock.fastForward(61_000)
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 1)
  await page.clock.fastForward(239_000)
  await page.waitForURL('**/login')
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 2)
})

test('inactivity logout finishes locally after an expired JWT and rejected refresh without a loop', async t => {
  const { page, requests } = await app(t, { restored: true, handle: (entry, state) => {
    if (entry.path === '/auth/logout') {
      state.signedIn = false
      return reply({ error: 'Expired', code: 'INVALID_SESSION' }, 401, {
        'Set-Cookie': '__Host-leafcheck-refresh=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      })
    }
  } })
  await page.goto(origin + '/dashboard')
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  const start = requests.length
  await page.clock.fastForward(301_000)
  await page.waitForURL('**/login')
  assert.deepEqual(requests.slice(start).filter(entry => entry.path.startsWith('/auth/')).map(entry => entry.path),
    ['/auth/logout', '/auth/refresh'])
  assert.equal(await memoryToken(page), null)
  await page.reload()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
})

test('inactivity logout retains the server sign-out warning when the backend is unavailable', async t => {
  const { page, requests } = await app(t, { restored: true, handle: entry => {
    if (entry.path === '/auth/logout') return reply({ error: 'Unavailable' }, 503)
  } })
  await page.goto(origin + '/dashboard')
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  await page.clock.fastForward(301_000)
  await page.waitForURL('**/login')
  await page.getByRole('alert').filter({ hasText: 'Unable to confirm server sign-out.' }).waitFor()
  assert.equal(await memoryToken(page), null)
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 1)
})

async function fillRecovery(page, code = '00123456', password = 'replacement password') {
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByLabel('Recovery code', { exact: true }).fill(code)
  await page.getByLabel('New password', { exact: true }).fill(password)
  await page.getByLabel('Confirm new password', { exact: true }).fill(password)
}

test('recovery preserves leading zeros, prevents duplicate submissions and returns to password-plus-OTP login', async t => {
  const { page, requests } = await app(t, { handle: entry => {
    if (entry.path === '/auth/forgot-password') return reply({
      message: 'If an eligible account exists, a recovery code has been sent.', resendAfter: 60,
    }, 202)
    if (entry.path === '/auth/reset-password') {
      assert.deepEqual(entry.body, { email: 'admin@example.test', code: '00123456', newPassword: '  replacement password  ' })
      assert.equal(entry.headers.authorization, undefined)
      assert.equal(entry.headers['x-auth-client'], undefined)
      return { status: 204 }
    }
  } })
  await page.goto(origin + '/login')
  await page.getByLabel('Email', { exact: true }).fill('ADMIN@EXAMPLE.TEST')
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
  await page.waitForURL('**/forgot-password')
  await page.getByRole('heading', { name: 'Forgot password', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'admin@example.test')
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  await page.waitForURL('**/reset-password')
  assert.equal(requests.filter(entry => entry.path === '/auth/forgot-password').length, 1)
  assert.equal(await page.getByLabel('Recovery code', { exact: true }).getAttribute('type'), 'text')
  await fillRecovery(page, '00123456', '  replacement password  ')
  await page.getByLabel('Confirm new password', { exact: true }).fill('different password')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'The new passwords do not match.' }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/auth/reset-password').length, 0)
  await page.getByLabel('Confirm new password', { exact: true }).fill('  replacement password  ')
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  await page.waitForURL('**/login')
  await page.getByRole('status').filter({ hasText: 'Your password has been reset.' }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/auth/reset-password').length, 1)
  assert.equal(requests.filter(entry => entry.path === '/auth/otp/verify' || entry.path === '/auth/verify-admin-otp').length, 0)
  assert.equal(await memoryToken(page), null)
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0])
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(history.state)), /00123456|replacement password/)
  assert.doesNotMatch(page.url(), /00123456|replacement|admin@/)
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByLabel('Password', { exact: true }).fill('  replacement password  ')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/login/otp')
  assert.equal(await memoryToken(page), null)
  await page.getByLabel('Verification code').fill('00001234')
  await page.getByRole('button', { name: 'Verify Code', exact: true }).click()
  await page.waitForURL('**/dashboard')
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
})

test('recovery routes allow anonymous direct visits and reloads without inactivity or auth redirects', async t => {
  const { page, requests } = await app(t)
  for (const [path, heading] of [['/forgot-password', 'Forgot password'], ['/reset-password', 'Reset password']]) {
    await page.goto(origin + path)
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    await page.clock.fastForward(301_000)
    assert.equal(new URL(page.url()).pathname, path)
    await page.reload()
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    assert.equal(await memoryToken(page), null)
  }
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
  assert.equal(requests.filter(entry => entry.path.startsWith('/admin/')).length, 0)
})

test('recovery does not interrupt a pending administrator challenge or a verified session', async t => {
  const pending = await app(t)
  await signIn(pending.page)
  await pending.page.waitForURL('**/login/otp')
  for (const path of ['/forgot-password', '/reset-password']) {
    await pending.page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')) }, path)
    await pending.page.waitForURL('**/login/otp')
  }
  await pending.page.clock.fastForward(301_000)
  assert.equal(pending.requests.filter(entry => entry.path === '/auth/logout').length, 0)
  const verified = await app(t, { restored: true })
  await verified.page.goto(origin + '/forgot-password')
  await verified.page.waitForURL('**/dashboard')
  assert.equal(await memoryToken(verified.page), 'verified-memory-jwt')
})

test('recovery resend retains its cooldown across reloads and honors a backend 429', async t => {
  let sends = 0
  const { page, requests } = await app(t, { handle: entry => {
    if (entry.path !== '/auth/forgot-password') return
    if (++sends === 2) return reply({ error: 'Please wait before requesting another code.' }, 429, { 'Retry-After': '90' })
    return reply({ message: 'If an eligible account exists, a recovery code has been sent.', resendAfter: 60 }, 202)
  } })
  await page.goto(origin + '/forgot-password')
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click()
  await page.waitForURL('**/reset-password')
  assert.equal(await page.getByRole('button', { name: /Resend code/ }).isDisabled(), true)
  await page.clock.fastForward(61_000)
  await page.getByRole('button', { name: 'Resend code', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Please wait before requesting another code.' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Reset password', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Resend code/ }).isDisabled(), true)
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'admin@example.test')
  await page.clock.fastForward(91_000)
  await page.getByLabel('Recovery code', { exact: true }).fill('00000000')
  await page.getByRole('button', { name: 'Resend code', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'If an eligible account exists, a new recovery code has been sent.' }).waitFor()
  assert.equal(await page.getByLabel('Recovery code', { exact: true }).inputValue(), '')
  assert.equal(sends, 3)
  assert.equal(requests.filter(entry => entry.path === '/auth/logout').length, 0)
})

test('recovery validates email, code and password locally and keeps rejected codes inline', async t => {
  const { page, requests } = await app(t, { handle: entry => {
    if (entry.path === '/auth/reset-password') return reply({ error: 'Invalid or expired code. Request a new one.', code: 'INVALID_CODE' }, 400)
  } })
  await page.goto(origin + '/forgot-password')
  await page.getByLabel('Email', { exact: true }).fill('invalid')
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Enter a valid email address.' }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/auth/forgot-password').length, 0)
  await page.goto(origin + '/reset-password')
  await fillRecovery(page, '1234567', 'short')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Enter the eight-digit recovery code' }).waitFor()
  await page.getByRole('alert').filter({ hasText: 'Password must contain 8–128 characters.' }).waitFor()
  assert.equal(requests.filter(entry => entry.path === '/auth/reset-password').length, 0)
  await fillRecovery(page, '00000000')
  const refreshes = requests.filter(entry => entry.path === '/auth/refresh').length
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Invalid or expired code.' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/reset-password')
  assert.equal(requests.filter(entry => entry.path === '/auth/refresh').length, refreshes)
  assert.equal(requests.filter(entry => entry.path === '/auth/reset-password').length, 1)
  assert.equal(await memoryToken(page), null)
})

for (const failure of ['server', 'network']) {
  test(`recovery never replays an uncertain ${failure} outcome and requires a fresh code`, async t => {
    const { page, requests } = await app(t, { handle: entry => {
      if (entry.path === '/auth/reset-password') return reply({ error: 'Unavailable' }, 503)
      if (entry.path === '/auth/forgot-password') return reply({ resendAfter: 60 }, 202)
    } })
    let attempts = 0
    if (failure === 'network') await page.route('**/api/auth/reset-password', async route => { attempts++; await route.abort('failed') })
    await page.goto(origin + '/reset-password')
    await fillRecovery(page)
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
    await page.getByRole('alert').filter({ hasText: 'Your password may have changed.' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Reset password', exact: true }).isDisabled(), true)
    await page.locator('form').evaluate(form => form.requestSubmit())
    assert.equal(failure === 'network' ? attempts : requests.filter(entry => entry.path === '/auth/reset-password').length, 1)
    assert.equal(await memoryToken(page), null)
    await page.getByRole('button', { name: 'Resend code', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'a new recovery code has been sent.' }).waitFor()
    assert.equal(await page.getByLabel('Recovery code', { exact: true }).inputValue(), '')
    assert.equal(await page.getByRole('button', { name: 'Reset password', exact: true }).isEnabled(), true)
  })
}

test('recovery ignores a late send-code response after the user returns to login', async t => {
  let release, started
  const pending = new Promise(resolve => { started = resolve })
  const { page } = await app(t, { handle: async entry => {
    if (entry.path !== '/auth/forgot-password') return
    started()
    await new Promise(resolve => { release = resolve })
    return reply({ resendAfter: 60 }, 202)
  } })
  await page.goto(origin + '/login')
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click()
  await pending
  await page.goBack()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  const finished = page.waitForResponse(response => response.url().endsWith('/auth/forgot-password'))
  release()
  await finished
  await page.clock.runFor(20)
  assert.equal(new URL(page.url()).pathname, '/login')
  assert.equal(await memoryToken(page), null)
})
