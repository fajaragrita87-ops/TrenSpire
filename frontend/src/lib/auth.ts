import { create } from 'zustand'

const tokenKey = 'trendspire.access_token'
const refreshTokenKey = 'trendspire.refresh_token'
const userKey = 'trendspire.user'
const agencyKey = 'trendspire.agency'

export type AuthUser = {
  id: string
  agency_id: string
  email: string
  role: string
  name?: string
}

export type AuthAgency = {
  id: string
  name: string
  logo_url?: string
  primary_color?: string
}

type AuthState = {
  accessToken: string | null
  refreshToken: string | null
  user: AuthUser | null
  agency: AuthAgency | null
  setSession: (session: {
    accessToken: string
    refreshToken: string
    user: AuthUser
    agency: AuthAgency
  }) => void
  clear: () => void
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: localStorage.getItem(tokenKey),
  refreshToken: localStorage.getItem(refreshTokenKey),
  user: readJson<AuthUser>(userKey),
  agency: readJson<AuthAgency>(agencyKey),
  setSession: ({ accessToken, refreshToken, user, agency }) => {
    localStorage.setItem(tokenKey, accessToken)
    localStorage.setItem(refreshTokenKey, refreshToken)
    writeJson(userKey, user)
    writeJson(agencyKey, agency)
    set({ accessToken, refreshToken, user, agency })
  },
  clear: () => {
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(refreshTokenKey)
    localStorage.removeItem(userKey)
    localStorage.removeItem(agencyKey)
    set({ accessToken: null, refreshToken: null, user: null, agency: null })
  },
}))

export function getAccessToken(): string | null {
  return localStorage.getItem(tokenKey)
}

export function setAccessToken(token: string): void {
  localStorage.setItem(tokenKey, token)
  useAuthStore.setState({ accessToken: token })
}

export function clearAccessToken(): void {
  localStorage.removeItem(tokenKey)
  useAuthStore.setState({ accessToken: null })
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(refreshTokenKey)
}

export function setRefreshToken(token: string): void {
  localStorage.setItem(refreshTokenKey, token)
  useAuthStore.setState({ refreshToken: token })
}

export function clearRefreshToken(): void {
  localStorage.removeItem(refreshTokenKey)
  useAuthStore.setState({ refreshToken: null })
}

export function clearAuth(): void {
  useAuthStore.getState().clear()
}
