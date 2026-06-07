import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { login } from '../lib/api'
import { useAuthStore } from '../lib/auth'
import { useToast } from '../lib/toast'

export default function LoginPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await login(email.trim().toLowerCase(), password)
      useAuthStore.getState().setSession({
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        user: res.user,
        agency: res.agency,
      })
      toast.push({ kind: 'success', title: 'Login berhasil' })
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login gagal'
      setError(msg)
      toast.push({ kind: 'error', title: 'Login gagal', message: msg })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1>trendSpire</h1>
        <p className="muted">Login untuk masuk dashboard</p>

        <form onSubmit={onSubmit} className="form">
          <label className="field">
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="email@domain.com"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Minimal 8 karakter"
              required
            />
          </label>

          {error ? <div className="error">{error}</div> : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Loading...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
