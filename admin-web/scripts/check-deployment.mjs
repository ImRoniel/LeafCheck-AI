import { pathToFileURL } from 'node:url'

/** Read-only smoke checks: no credentials, login attempts, or application writes. */
export async function checkDeployment(input, request = fetch) {
  const origin = new URL(input)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('Provide an HTTPS web origin, or an HTTP loopback origin for local verification.')
  }
  const checks = []
  for (const path of ['/login', '/dashboard', '/users', '/login/otp']) {
    const response = await request(new URL(path, origin), {
      headers: { Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    const html = await response.text()
    if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/html') || !/<div\s+id=["']root["']/.test(html)) {
      throw new Error(`SPA route ${path} did not return the app's index.html.`)
    }
    checks.push(`PASS SPA ${path}`)
  }
  const denied = await request(new URL('/api/admin/health', origin), {
    headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  const payload = await denied.json().catch(() => null)
  if (denied.status !== 401 || payload?.code !== 'INVALID_SESSION') {
    throw new Error('The same-origin /api proxy must return the backend JSON 401, not an HTML fallback or public health data.')
  }
  checks.push('PASS /api forwarding and unauthenticated denial')
  const preflight = await request(new URL('/api/admin/users', origin), {
    method: 'OPTIONS', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Origin: origin.origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-csrf-protection' },
  })
  const headers = preflight.headers.get('Access-Control-Allow-Headers')?.toLowerCase().split(',').map(value => value.trim()) ?? []
  if (!preflight.ok || preflight.headers.get('Access-Control-Allow-Origin') !== origin.origin ||
      preflight.headers.get('Access-Control-Allow-Credentials') !== 'true' ||
      !headers.includes('authorization') || !headers.includes('x-csrf-protection')) {
    throw new Error('The backend must allow this exact browser origin, credentials, Authorization, and X-CSRF-Protection.')
  }
  checks.push('PASS exact origin and credentialed CORS preflight')
  return checks
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run check:deployment --workspace=admin-web -- https://your-admin-host')
    for (const check of await checkDeployment(process.argv[2])) console.log(check)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment verification failed.')
    process.exitCode = 1
  }
}
