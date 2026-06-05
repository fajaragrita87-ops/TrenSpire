const tokenKey = 'trendspire.access_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(tokenKey)
}

export function setAccessToken(token: string): void {
  localStorage.setItem(tokenKey, token)
}

export function clearAccessToken(): void {
  localStorage.removeItem(tokenKey)
}

