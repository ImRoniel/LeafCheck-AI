import { isRecord, readAccessToken } from './auth'

const baseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')

// Access tokens deliberately live only in memory, never browser storage.
let accessToken: string | null = null
let sessionVersion = 0
let refreshFlight: Promise<void> | null = null
let expirationFlight: Promise<void> | null = null
let sessionExpiredHandler: (() => Promise<void>) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
  sessionVersion++
}

export function getAccessToken(): string | null {
  return accessToken
}

export function onSessionExpired(handler: () => Promise<void>): () => void {
  sessionExpiredHandler = handler
  return () => {
    if (sessionExpiredHandler === handler) sessionExpiredHandler = null
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly retryAfter: number | undefined

  constructor(status: number, message: string, code?: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let payload: unknown
    try { payload = await response.json() } catch { /* Non-JSON errors use the HTTP fallback. */ }
    const retryHeader = response.headers.get('Retry-After')
    const retryAfter = retryHeader === null ? NaN : /^[0-9]+$/.test(retryHeader)
      ? Number(retryHeader) : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000)
    return new ApiError(
      response.status,
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error : response.statusText || `API request failed (${response.status}).`,
      isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined,
    )
  }
}

export interface ApiOptions extends RequestInit {
  retryOnUnauthorized?: boolean
}

const sessionChanged = () => new DOMException('The session has changed.', 'AbortError')

async function request(path: string, options: RequestInit): Promise<Response> {
  if (!baseUrl) {
    throw new Error('Set VITE_API_URL in admin-web/.env before making API requests.')
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('API paths must start with a single slash.')
  }

  const headers = new Headers(options.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  // Required by the existing backend for browser authentication requests.
  headers.set('X-CSRF-Protection', '1')
  if (accessToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`)

  return fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })
}

/** Shared by restoration and 401 retries; discard results from a previous session. */
export function refreshAccessToken(): Promise<void> {
  if (refreshFlight) return refreshFlight
  const version = sessionVersion
  const flight = (async () => {
    const response = await request('/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!response.ok) throw await ApiError.fromResponse(response)
    const payload: unknown = await response.json()
    const token = readAccessToken(payload)
    if (version !== sessionVersion) throw sessionChanged()
    accessToken = token
  })().finally(() => {
    if (refreshFlight === flight) refreshFlight = null
  })
  refreshFlight = flight
  return flight
}

export async function waitForRefresh(): Promise<void> {
  // A logout waits for the cookie response before submitting its revocation.
  await refreshFlight?.catch(() => {})
}

async function expireSession(version: number): Promise<void> {
  if (version !== sessionVersion) return
  if (!expirationFlight) {
    const flight = (async () => {
      if (sessionExpiredHandler) await sessionExpiredHandler()
      else {
        setAccessToken(null)
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.replace('/login')
        }
      }
    })().finally(() => {
      if (expirationFlight === flight) expirationFlight = null
    })
    expirationFlight = flight
  }
  await expirationFlight
}

/** Paths are relative to VITE_API_URL, for example /auth/login. */
export async function apiFetch(path: string, options: ApiOptions = {}): Promise<Response> {
  const { retryOnUnauthorized = !path.startsWith('/auth/'), ...init } = options
  const version = sessionVersion
  const attemptedToken = accessToken
  let response = await request(path, init)
  init.signal?.throwIfAborted()
  if (retryOnUnauthorized && version !== sessionVersion) throw sessionChanged()

  if (response.status === 401 && retryOnUnauthorized) {
    try {
      if (accessToken === attemptedToken) await refreshAccessToken()
      if (version !== sessionVersion) throw sessionChanged()
    } catch (error) {
      if (!init.signal?.aborted) await expireSession(version)
      throw error
    }
    init.signal?.throwIfAborted()
    response = await request(path, init)
    if (version !== sessionVersion) throw sessionChanged()
  }
  if (!response.ok) {
    const error = await ApiError.fromResponse(response)
    if (retryOnUnauthorized && (response.status === 401 || error.code === 'ADMIN_VERIFICATION_REQUIRED')) {
      await expireSession(version)
    }
    throw error
  }

  return response
}
