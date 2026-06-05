import { clearAccessToken, getAccessToken, setAccessToken } from './auth'

export type LoginResponse = {
  access_token: string
  token_type: string
  expires_at: string
  user: {
    id: string
    agency_id: string
    email: string
    role: string
    name?: string
  }
  agency: {
    id: string
    name: string
    logo_url?: string
  }
}

export type Client = {
  id: string
  agency_id: string
  name: string
  logo_url?: string
  report_brand_name?: string
  created_at: string
  updated_at: string
  social_accounts?: Array<{
    id: string
    client_id: string
    platform: string
    external_account_id?: string
    username?: string
    expires_at?: string
    connected_at?: string
    created_at: string
    updated_at: string
  }>
}

async function apiFetch<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  const isJsonBody =
    typeof init.body === 'string' && init.body.trim().startsWith('{')
  if (isJsonBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (init.auth !== false) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()

  if (res.status === 401) {
    clearAccessToken()
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const parsed = text ? JSON.parse(text) : null
      if (parsed?.error) message = String(parsed.error)
    } catch {
      if (text) message = text
    }
    throw new Error(message)
  }

  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const body = JSON.stringify({ email, password })
  const res = await apiFetch<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body,
    auth: false,
  })
  setAccessToken(res.access_token)
  return res
}

export async function listClients(): Promise<Client[]> {
  const res = await apiFetch<{ data: Client[] }>('/api/v1/clients', {
    method: 'GET',
  })
  return res.data ?? []
}

