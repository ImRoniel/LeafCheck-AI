import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, ApiError, getAccessToken, onSessionExpired, refreshAccessToken, setAccessToken, waitForRefresh } from '../lib/api'
import { isAdminUser, isRecord, readAccessToken, readUser, type AuthUser } from '../lib/auth'
import { SessionContext, type AdminUser, type SessionStatus } from './session'

const jsonPost = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const
const cancelled = () => new DOMException('The session has changed.', 'AbortError')

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>('restoring')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  const mounted = useRef(false)
  const operation = useRef(0)
  const restoreFlight = useRef<Promise<void> | null>(null)
  const logoutFlight = useRef<Promise<void> | null>(null)
  const loginPending = useRef(false)

  useEffect(() => { navigateRef.current = navigate }, [navigate])

  const performLogout = useCallback((allowRefresh: boolean): Promise<void> => {
    if (logoutFlight.current) return logoutFlight.current
    const current = ++operation.current
    const token = getAccessToken()
    setAccessToken(null)
    setUser(null)
    setStatus('signingOut')
    setSessionError(null)
    const flight = (async () => {
      try {
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
        if (mounted.current && current === operation.current && !(error instanceof ApiError && error.status === 401)) {
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
  }, [])

  const logout = useCallback(() => performLogout(true), [performLogout])

  const restoreSession = useCallback((): Promise<void> => {
    if (restoreFlight.current) return restoreFlight.current
    const current = operation.current
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
        if (!(error instanceof ApiError && error.status === 401)) {
          setSessionError('Unable to restore your session. Please sign in again.')
        }
      }
    })().finally(() => { restoreFlight.current = null })
    restoreFlight.current = flight
    return flight
  }, [performLogout])

  const login = useCallback(async (email: string, password: string): Promise<void> => {
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
        setAccessToken(readAccessToken(payload))
        let authenticatedUser: AuthUser
        try { authenticatedUser = readUser(isRecord(payload) ? payload.user : undefined) }
        catch (error) { await performLogout(false); throw error }
        if (!isAdminUser(authenticatedUser)) {
          await performLogout(false)
          throw new Error('Unauthorized: Admin access required')
        }
        setUser(authenticatedUser)
        setStatus('authenticated')
      } catch (error) {
        if (mounted.current && current === operation.current) {
          setAccessToken(null)
          setUser(null)
          setStatus('anonymous')
        }
        throw error
      }
    } finally { loginPending.current = false }
  }, [performLogout])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = onSessionExpired(() => performLogout(false))
    void restoreSession()
    return () => { mounted.current = false; unsubscribe() }
  }, [performLogout, restoreSession])

  return (
    <SessionContext.Provider value={{ user, status, sessionError, login, logout, restoreSession }}>
      {children}
    </SessionContext.Provider>
  )
}
