import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, ApiError, getAccessToken, onSessionExpired, refreshAccessToken, setAccessToken, waitForRefresh } from '../lib/api'
import { isAdminUser, isRecord, readAccessToken, readAdminChallenge, readChallengeTiming, readUser, type AdminChallenge, type LoginResult } from '../lib/auth'
import { SessionContext, type AdminUser, type SessionStatus } from './session'

const jsonPost = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const
const cancelled = () => new DOMException('The session has changed.', 'AbortError')
const sessionExpiredMessage = 'Your session has expired. Please log in again.'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>('restoring')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<AdminChallenge | null>(null)
  const [otpBusy, setOtpBusy] = useState(false)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  const mounted = useRef(false)
  const operation = useRef(0)
  const restoreFlight = useRef<Promise<void> | null>(null)
  const logoutFlight = useRef<Promise<void> | null>(null)
  const loginPending = useRef(false)
  const challengeRef = useRef<AdminChallenge | null>(null)
  const otpFlight = useRef<Promise<void> | null>(null)

  const updateChallenge = useCallback((value: AdminChallenge | null) => {
    challengeRef.current = value
    setChallenge(value)
  }, [])

  useEffect(() => { navigateRef.current = navigate }, [navigate])

  const performLogout = useCallback((allowRefresh: boolean, waitForOtp = true, reason: string | null = null): Promise<void> => {
    if (logoutFlight.current) return logoutFlight.current
    const current = ++operation.current
    const token = getAccessToken()
    setAccessToken(null)
    setUser(null)
    updateChallenge(null)
    setStatus('signingOut')
    // Show the reason during sign-out and retain it on the login screen.
    setSessionError(reason)
    const flight = (async () => {
      try {
        // A verification response can set a cookie; revoke it after it settles.
        if (waitForOtp) await otpFlight.current?.catch(() => {})
        await waitForRefresh()
        await apiFetch('/auth/logout', {
          ...jsonPost, body: '{}',
          headers: { ...jsonPost.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          retryOnUnauthorized: false,
        }).catch(async error => {
          if (!(error instanceof ApiError) || error.status !== 401 || !allowRefresh) throw error
          await refreshAccessToken()
          await apiFetch('/auth/logout', { ...jsonPost, body: '{}', retryOnUnauthorized: false })
        })
      } catch (error) {
        if (!reason && mounted.current && current === operation.current && !(error instanceof ApiError && error.status === 401)) {
          setSessionError('Unable to confirm server sign-out. Your local session has been cleared.')
        }
      } finally {
        if (current === operation.current) {
          setAccessToken(null)
          if (mounted.current) {
            setUser(null)
            setStatus('anonymous')
            navigateRef.current('/login', { replace: true })
          }
        }
      }
    })().finally(() => { logoutFlight.current = null })
    logoutFlight.current = flight
    return flight
  }, [updateChallenge])

  const logout = useCallback(() => performLogout(true), [performLogout])

  const restoreSession = useCallback((): Promise<void> => {
    if (challengeRef.current) return Promise.resolve()
    if (restoreFlight.current) return restoreFlight.current
    const current = operation.current
    const hadSession = getAccessToken() !== null
    setStatus('restoring')
    setSessionError(null)
    const flight = (async () => {
      try {
        await refreshAccessToken()
        if (!mounted.current || current !== operation.current) return
        const response = await apiFetch('/users/me', { retryOnUnauthorized: false })
        const payload: unknown = await response.json()
        const restoredUser = readUser(payload)
        if (!mounted.current || current !== operation.current) return
        if (!isAdminUser(restoredUser)) {
          await performLogout(false)
          return
        }
        setUser(restoredUser)
        setStatus('authenticated')
      } catch (error) {
        if (!mounted.current || current !== operation.current) return
        setAccessToken(null)
        setUser(null)
        setStatus('anonymous')
        if (error instanceof ApiError && error.code === 'ADMIN_VERIFICATION_REQUIRED') {
          setSessionError('Please sign in again and verify your administrator code.')
        } else if (hadSession || ['/dashboard', '/users', '/devices', '/audit', '/forbidden'].includes(window.location.pathname.replace(/\/+$/, ''))) {
          setSessionError(sessionExpiredMessage)
        } else if (!(error instanceof ApiError && error.status === 401)) {
          setSessionError('Unable to restore your session. Please sign in again.')
        }
      }
    })().finally(() => { restoreFlight.current = null })
    restoreFlight.current = flight
    return flight
  }, [performLogout])

  const acceptSession = useCallback(async (payload: unknown) => {
    setAccessToken(readAccessToken(payload))
    try {
      const authenticatedUser = readUser(isRecord(payload) ? payload.user : undefined)
      if (!isAdminUser(authenticatedUser)) throw new Error('Unauthorized: Admin access required')
      updateChallenge(null)
      setUser(authenticatedUser)
      setStatus('authenticated')
    } catch (error) {
      // Do not leave a rejected account's refresh cookie behind.
      await performLogout(false, false)
      throw error
    }
  }, [performLogout, updateChallenge])

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    if (challengeRef.current) return { status: 'otp_required' }
    if (loginPending.current) throw new Error('Sign-in is already in progress.')
    loginPending.current = true
    try {
      await restoreFlight.current
      await logoutFlight.current
      const current = ++operation.current
      setAccessToken(null)
      setUser(null)
      setSessionError(null)
      setStatus('authenticating')
      try {
        const response = await apiFetch('/auth/login', { ...jsonPost, body: JSON.stringify({ email: email.trim(), password }) })
        const payload: unknown = await response.json()
        if (!mounted.current || current !== operation.current) throw cancelled()
        if (response.status === 202) {
          updateChallenge(readAdminChallenge(payload))
          setStatus('otp_required')
          return { status: 'otp_required' }
        }
        if (response.status !== 200) throw new Error('Invalid authentication response.')
        await acceptSession(payload)
        return { status: 'authenticated' }
      } catch (error) {
        if (mounted.current && current === operation.current) {
          setAccessToken(null)
          setUser(null)
          setStatus('anonymous')
        }
        throw error
      }
    } finally { loginPending.current = false }
  }, [acceptSession, updateChallenge])

  const requireChallenge = useCallback(() => {
    const pending = challengeRef.current
    if (!pending) throw new Error('Your sign-in challenge has ended. Please sign in again.')
    if (otpFlight.current) throw new Error('Please wait for the current request to finish.')
    return pending
  }, [])

  const finishInvalidChallenge = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.code === 'INVALID_CHALLENGE') {
      updateChallenge(null)
      setAccessToken(null)
      setUser(null)
      setStatus('anonymous')
      setSessionError('Your sign-in challenge expired or reached its attempt limit. Please sign in again.')
    }
  }, [updateChallenge])

  const verifyAdminOtp = useCallback((challengeToken: string, code: string): Promise<void> => {
    const pending = requireChallenge()
    if (challengeToken !== pending.challengeToken) throw cancelled()
    if (!/^[0-9]{8}$/.test(code)) throw new Error('Enter the 8-digit code from your email.')
    if (Date.now() >= pending.expiresAt) throw new Error('This code has expired. Cancel and sign in again.')
    const current = operation.current
    setOtpBusy(true)
    const flight = (async () => {
      try {
        const response = await apiFetch('/auth/verify-admin-otp', {
          ...jsonPost, body: JSON.stringify({ challengeToken, code }),
        })
        const payload: unknown = await response.json()
        if (!mounted.current || current !== operation.current) throw cancelled()
        if (response.status !== 200) throw new Error('Invalid authentication response.')
        await acceptSession(payload)
      } catch (error) {
        if (mounted.current && current === operation.current) finishInvalidChallenge(error)
        throw error
      }
    })().finally(() => { otpFlight.current = null; if (mounted.current) setOtpBusy(false) })
    otpFlight.current = flight
    return flight
  }, [acceptSession, finishInvalidChallenge, requireChallenge])

  const resendAdminOtp = useCallback((): Promise<void> => {
    const pending = requireChallenge()
    if (Date.now() < pending.resendAvailableAt) throw new Error('Please wait before requesting another code.')
    if (Date.now() >= pending.expiresAt) throw new Error('This code has expired. Cancel and sign in again.')
    const current = operation.current
    setOtpBusy(true)
    const flight = (async () => {
      try {
        const response = await apiFetch('/auth/admin-otp/resend', {
          ...jsonPost, body: JSON.stringify({ challengeToken: pending.challengeToken }),
        })
        const payload: unknown = await response.json()
        if (!mounted.current || current !== operation.current) throw cancelled()
        updateChallenge({ ...pending, ...readChallengeTiming(payload) })
      } catch (error) {
        if (mounted.current && current === operation.current) {
          finishInvalidChallenge(error)
          if (error instanceof ApiError && error.status === 429) {
            updateChallenge({ ...pending, resendAvailableAt: Date.now() + Math.max(60, error.retryAfter ?? 60) * 1000 })
          }
        }
        throw error
      }
    })().finally(() => { otpFlight.current = null; if (mounted.current) setOtpBusy(false) })
    otpFlight.current = flight
    return flight
  }, [finishInvalidChallenge, requireChallenge, updateChallenge])

  const cancelAdminOtp = useCallback((): Promise<void> => {
    const pending = requireChallenge()
    ++operation.current
    setOtpBusy(true)
    setSessionError(null)
    const flight = (async () => {
      try {
        await apiFetch('/auth/admin-otp/cancel', { ...jsonPost, body: JSON.stringify({ challengeToken: pending.challengeToken }) })
      } catch (error) {
        if (mounted.current && !(error instanceof ApiError && error.code === 'INVALID_CHALLENGE')) {
          setSessionError('Sign-in was cancelled locally. Server cancellation could not be confirmed; the code will expire shortly.')
        }
      } finally {
        setAccessToken(null)
        if (mounted.current) {
          updateChallenge(null)
          setUser(null)
          setStatus('anonymous')
        }
      }
    })().finally(() => { otpFlight.current = null; if (mounted.current) setOtpBusy(false) })
    otpFlight.current = flight
    return flight
  }, [requireChallenge, updateChallenge])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = onSessionExpired(() => performLogout(false, true, sessionExpiredMessage))
    void restoreSession()
    return () => { mounted.current = false; unsubscribe() }
  }, [performLogout, restoreSession])

  return (
    <SessionContext.Provider value={{ user, status, sessionError, challenge, otpBusy, login, logout, restoreSession, verifyAdminOtp, resendAdminOtp, cancelAdminOtp }}>
      {sessionError && status === 'signingOut' && <div role="alert" className="notice-error fixed top-4 right-4 left-4 z-50 mx-auto max-w-xl shadow-lg">{sessionError}</div>}
      {children}
    </SessionContext.Provider>
  )
}
