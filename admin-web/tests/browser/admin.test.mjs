import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

let vite, browser, origin
const admin = { id: 'admin-1', email: 'admin@example.test', name: 'Platform Admin', role: 'ADMIN' }
const operator = { id: 'operator-1', email: 'operator@example.test', name: 'Operations', role: 'LEAD_DEV' }
const member = { id: 'member-1', email: 'member@example.test', name: 'Member', role: 'USER' }
const sensor = { id: 'sensor-1', macAddress: 'AA:BB:CC:DD:EE:FF', name: 'Office sensor',
  plants: [{ id: 'plant-1', name: 'Monstera' }], connectionStatus: 'ONLINE' }
const reply = (body, status = 200, headers = {}) => ({ status, body: JSON.stringify(body), contentType: 'application/json', headers })
const list = (data, page = 1, total = data.length, meta = {}) => ({ data,
  pagination: { page, pageSize: 25, total, totalPages: Math.ceil(total / 25) }, meta })

before(async () => {
  process.env.VITE_API_URL = '/api'
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  })
  await vite.listen()
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})

after(async () => { await browser?.close(); await vite?.close() })

async function app(t, options = {}) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  const errors = []
  const requests = []
  const actor = options.actor ?? admin
  const state = { signedIn: options.restored ?? false, challenges: 0,
    users: options.users ?? [{ id: admin.id, name: admin.name, emailMasked: 'a***@example.test', role: 'ADMIN', isActive: true },
      { id: member.id, name: member.name, emailMasked: 'm***@example.test', role: 'USER', isActive: true }] }
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
        if (actor.role !== 'ADMIN') {
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
      if (path === '/admin/users' && entry.method === 'POST') {
        const user = { id: 'created-user', name: entry.body.name ?? null, emailMasked: 'n***@example.test',
          role: entry.body.role, isActive: true }
        state.users.unshift(user)
        return await route.fulfill(reply({ data: user }, 201))
      }
      if (path.startsWith('/admin/users/') && entry.method === 'PATCH') {
        const user = state.users.find(row => row.id === path.split('/').at(-1))
        assert.ok(user)
        user.isActive = entry.body.isActive
        return await route.fulfill(reply({ data: user }))
      }
      if (path === '/admin/users') {
        assert.equal(actor.role, 'ADMIN', 'LEAD_DEV must never request the users endpoint')
        const pageNumber = Number(entry.query.get('page'))
        const query = entry.query.get('q')?.toLowerCase() ?? ''
        const users = state.users.filter(row => `${row.name} ${row.emailMasked}`.toLowerCase().includes(query))
        return await route.fulfill(reply(list(users.slice((pageNumber - 1) * 25, pageNumber * 25), pageNumber, users.length)))
      }
      if (path === '/admin/devices') return await route.fulfill(reply(list([sensor])))
      if (path === '/admin/audit') {
        assert.equal(actor.role, 'ADMIN', 'LEAD_DEV must never request audit logs')
        return await route.fulfill(reply(list([
          { id: 'log-1', actorId: admin.id, targetId: member.id, action: 'USER_UPDATED', createdAt: new Date().toISOString(), metadata: {} },
          { id: 'log-2', actorId: admin.id, targetId: admin.id, action: 'ADMIN_OTP_FAILED', createdAt: new Date().toISOString(), metadata: {} },
          { id: 'log-3', actorId: null, targetId: null, action: 'USER_DELETE_REQUESTED', createdAt: new Date().toISOString(), metadata: { actorId: 'deleted-admin' } },
        ])))
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

test('LEAD_DEV signs in immediately, sees operational devices and cannot fetch users or audit via direct URLs', async t => {
  const { page, requests } = await app(t, { actor: operator })
  await signIn(page)
  await page.waitForURL('**/dashboard')
  assert.equal(await memoryToken(page), 'verified-memory-jwt')
  assert.equal(await page.getByRole('link', { name: 'Users', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Audit logs', exact: true }).count(), 0)
  for (const path of ['/users', '/audit']) {
    await page.goto(`${origin}${path}`)
    await page.waitForURL('**/forbidden')
    await page.getByRole('heading', { name: 'SuperAdmin access required' }).waitFor()
  }
  await page.getByRole('link', { name: 'Devices', exact: true }).click()
  await page.getByRole('cell', { name: 'AA:BB:CC:DD:EE:FF', exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'Monstera', exact: true }).count(), 1)
  assert.equal(await page.getByRole('cell', { name: 'Online', exact: true }).count(), 1)
  assert.equal(requests.filter(request => ['/admin/users', '/admin/audit', '/auth/verify-admin-otp'].includes(request.path)).length, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
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

test('users table supports paginated search, creation, ban/unban and prevents self-ban', async t => {
  const users = Array.from({ length: 26 }, (_, index) => ({ id: index === 0 ? admin.id : `user-${index}`,
    name: index === 0 ? admin.name : `Person ${index}`, emailMasked: `p***${index}@example.test`, role: index === 0 ? 'ADMIN' : 'USER', isActive: true }))
  const { page, requests } = await app(t, { restored: true, users })
  await page.goto(`${origin}/users`)
  await page.getByRole('cell', { name: 'Your account', exact: true }).waitFor()
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
  await page.getByRole('button', { name: 'Unban Person 1', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Unban Person 1', exact: true }).click()
  await page.getByRole('button', { name: 'Ban Person 1', exact: true }).waitFor()
  assert.deepEqual(requests.filter(request => request.method === 'PATCH').map(request => request.body), [{ isActive: false }, { isActive: true }])
  await page.getByRole('button', { name: 'Create User', exact: true }).click()
  await page.getByLabel('Name (optional)', { exact: true }).fill('New Operator')
  await page.getByLabel('Email', { exact: true }).fill('new@example.test')
  await page.getByLabel('Initial password', { exact: true }).fill('strong-password-1')
  await page.getByLabel('Role', { exact: true }).selectOption('LEAD_DEV')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByRole('cell', { name: 'New Operator', exact: true }).waitFor()
  assert.deepEqual(requests.find(request => request.method === 'POST' && request.path === '/admin/users').body,
    { name: 'New Operator', email: 'new@example.test', password: 'strong-password-1', role: 'LEAD_DEV' })
  assert.equal(await page.getByRole('cell', { name: 'n***@example.test', exact: true }).count(), 1)
})

test('audit table renders actor IDs and distinguishes success, failure and requested actions', async t => {
  const { page } = await app(t, { restored: true })
  await page.goto(`${origin}/audit`)
  for (const outcome of ['Succeeded', 'Failed', 'Requested']) await page.getByRole('cell', { name: outcome, exact: true }).waitFor()
  assert.equal(await page.getByRole('cell', { name: 'deleted-admin', exact: true }).count(), 1)
  assert.equal(await page.getByRole('cell', { name: 'USER_UPDATED', exact: true }).count(), 1)
})

test('a failed ban leaves the account active and shows the backend error', async t => {
  const { page, requests } = await app(t, { restored: true, handle: async entry => {
    if (entry.path === `/admin/users/${member.id}` && entry.method === 'PATCH') return reply({ code: 'ADMIN_CONFLICT', error: 'Account changed. Review and retry.' }, 409)
  } })
  await page.goto(`${origin}/users`)
  await page.getByRole('button', { name: 'Ban Member', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Account changed. Review and retry.' }).waitFor()
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Member', exact: true }) })
  assert.equal(await row.getByRole('cell', { name: 'Active', exact: true }).count(), 1)
  assert.equal(await row.getByRole('button', { name: 'Ban Member', exact: true }).isEnabled(), true)
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 1)
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
