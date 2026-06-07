import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { authGoogleStart, authMe, authWhatsAppRequestOTP, authWhatsAppVerifyOTP, login, register } from '../lib/api'
import { setAccessToken, setRefreshToken, useAuthStore } from '../lib/auth'
import { useToast } from '../lib/toast'

export default function LoginPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loginAuth, setLoginAuth] = useState<'email' | 'whatsapp' | 'google'>('email')
  const [registerAuth, setRegisterAuth] = useState<'email' | 'whatsapp' | 'google'>('email')
  const [logoSrc, setLogoSrc] = useState('/trenspire.png')

  const [agencyName, setAgencyName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingOTP, setIsSendingOTP] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = useMemo(() => {
    if (mode === 'register') return 'REGISTER'
    return 'LOGIN'
  }, [mode])

  const subtitle = useMemo(() => {
    if (mode === 'register') return 'Buat workspace baru, lalu mulai kontrol konten & report.'
    return 'Login untuk masuk dashboard.'
  }, [mode])

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = '/trenspire.png'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (r >= 248 && g >= 248 && b >= 248) {
            data[i + 3] = 0
            continue
          }
          if (r >= 235 && g >= 235 && b >= 235) {
            const a = data[i + 3]
            data[i + 3] = Math.max(0, a - 220)
          }
        }
        ctx.putImageData(imageData, 0, 0)
        const url = canvas.toDataURL('image/png')
        if (!cancelled) setLogoSrc(url)
      } catch {
        if (!cancelled) setLogoSrc('/trenspire.png')
      }
    }
    img.onerror = () => {
      if (!cancelled) setLogoSrc('/trenspire.png')
    }
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const hash = window.location.hash?.startsWith('#') ? window.location.hash.slice(1) : ''
    if (!hash) return
    const params = new URLSearchParams(hash)
    const access = params.get('access_token') ?? ''
    const refresh = params.get('refresh_token') ?? ''
    if (!access || !refresh) return

    window.history.replaceState({}, document.title, window.location.pathname + window.location.search)
    setAccessToken(access)
    setRefreshToken(refresh)

    void (async () => {
      try {
        const me = await authMe()
        useAuthStore.getState().setSession({
          accessToken: access,
          refreshToken: refresh,
          user: me.user,
          agency: me.agency,
        })
        toast.push({ kind: 'success', title: 'Login berhasil' })
        navigate('/', { replace: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Login gagal'
        setError(msg)
        toast.push({ kind: 'error', title: 'Login gagal', message: msg })
      }
    })()
  }, [navigate, toast])

  async function onRequestOTP() {
    if (isSendingOTP) return
    setIsSendingOTP(true)
    setError(null)
    try {
      const res = await authWhatsAppRequestOTP({ phone: phone.trim() })
      if (res.dev_code) setOtp(res.dev_code)
      toast.push({
        kind: 'success',
        title: res.sent ? 'OTP terkirim' : 'OTP siap',
        message: res.sent ? 'Cek WhatsApp kamu.' : 'Mode dev: OTP ditampilkan otomatis.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal kirim OTP'
      setError(msg)
      toast.push({ kind: 'error', title: 'Gagal kirim OTP', message: msg })
    } finally {
      setIsSendingOTP(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      if (mode === 'login') {
        if (loginAuth === 'google') {
          const start = await authGoogleStart({ mode: 'login' })
          window.location.href = start.auth_url
          return
        }
        if (loginAuth === 'whatsapp') {
          const res = await authWhatsAppVerifyOTP({
            mode: 'login',
            phone: phone.trim(),
            otp: otp.trim(),
          })
          useAuthStore.getState().setSession({
            accessToken: res.access_token,
            refreshToken: res.refresh_token,
            user: res.user,
            agency: res.agency,
          })
          toast.push({ kind: 'success', title: 'Login berhasil' })
          navigate('/', { replace: true })
          return
        }
        const res = await login(email.trim().toLowerCase(), password)
        useAuthStore.getState().setSession({
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          user: res.user,
          agency: res.agency,
        })
        toast.push({ kind: 'success', title: 'Login berhasil' })
        navigate('/', { replace: true })
        return
      }

      if (registerAuth === 'whatsapp') {
        const res = await authWhatsAppVerifyOTP({
          mode: 'register',
          phone: phone.trim(),
          otp: otp.trim(),
          agency_name: agencyName.trim(),
          name: name.trim() || undefined,
          logo_url: '/trenspire.png',
          primary_color: '#5b00ff',
        })
        useAuthStore.getState().setSession({
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          user: res.user,
          agency: res.agency,
        })
        toast.push({ kind: 'success', title: 'Akun berhasil dibuat' })
        navigate('/', { replace: true })
        return
      }
      if (registerAuth === 'google') {
        const start = await authGoogleStart({
          mode: 'register',
          agency_name: agencyName.trim(),
          name: name.trim(),
        })
        window.location.href = start.auth_url
        return
      }

      const res = await register({
        agency_name: agencyName.trim(),
        email: email.trim().toLowerCase(),
        password,
        name: name.trim() || undefined,
        logo_url: '/trenspire.png',
        primary_color: '#5b00ff',
      })
      useAuthStore.getState().setSession({
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        user: res.user,
        agency: res.agency,
      })
      toast.push({ kind: 'success', title: 'Akun berhasil dibuat' })
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : mode === 'register' ? 'Register gagal' : 'Login gagal'
      setError(msg)
      toast.push({ kind: 'error', title: mode === 'register' ? 'Register gagal' : 'Login gagal', message: msg })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-neo-page">
      <div className="auth-neo-shell">
        <div className="auth-neo-left">
          <img className="auth-neo-logo" src={logoSrc} alt="TrendSpire" />
          <div className="auth-neo-ticker" aria-hidden="true">
            <div className="auth-neo-ticker-track">
              <div className="auth-neo-ticker-item">
                <div className="auth-neo-ticker-line left" />
                <div className="auth-neo-ticker-text">SMARTER CONTENT. STRONGER CONNECTIONS.</div>
                <div className="auth-neo-ticker-line right" />
              </div>
              <div className="auth-neo-ticker-item">
                <div className="auth-neo-ticker-line left" />
                <div className="auth-neo-ticker-text">SMARTER CONTENT. STRONGER CONNECTIONS.</div>
                <div className="auth-neo-ticker-line right" />
              </div>
              <div className="auth-neo-ticker-item">
                <div className="auth-neo-ticker-line left" />
                <div className="auth-neo-ticker-text">SMARTER CONTENT. STRONGER CONNECTIONS.</div>
                <div className="auth-neo-ticker-line right" />
              </div>
            </div>
          </div>
        </div>

        <div className="auth-neo-right">
          <button
            type="button"
            className="auth-neo-register"
            onClick={() => {
              const next = mode === 'login' ? 'register' : 'login'
              setMode(next)
              if (next === 'login') {
                setLoginAuth('email')
              } else {
                setRegisterAuth('email')
              }
              setError(null)
            }}
          >
            {mode === 'login' ? 'Register' : 'Back to Login'}
          </button>

          <div className="auth-neo-formwrap">
            <div className="auth-neo-lines" aria-hidden="true">
              <div className="auth-neo-line l1" />
              <div className="auth-neo-line l2" />
              <div className="auth-neo-node n1" />
              <div className="auth-neo-node n2" />
              <div className="auth-neo-stem" />
            </div>

            <form onSubmit={onSubmit} className="auth-neo-form">
              {mode === 'login' ? (
                <div className="auth-neo-authopts">
                  <button
                    type="button"
                    className={loginAuth === 'email' ? 'auth-neo-authopt active' : 'auth-neo-authopt'}
                    onClick={() => {
                      setLoginAuth('email')
                      setError(null)
                    }}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    className={loginAuth === 'whatsapp' ? 'auth-neo-authopt active' : 'auth-neo-authopt'}
                    onClick={() => {
                      setLoginAuth('whatsapp')
                      setError(null)
                    }}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    className={loginAuth === 'google' ? 'auth-neo-authopt active' : 'auth-neo-authopt'}
                    onClick={() => {
                      setLoginAuth('google')
                      setError(null)
                    }}
                  >
                    Google
                  </button>
                </div>
              ) : null}

              {mode === 'register' ? (
                <>
                  <div className="auth-neo-authopts">
                    <button
                      type="button"
                      className={registerAuth === 'email' ? 'auth-neo-authopt active' : 'auth-neo-authopt'}
                      onClick={() => {
                        setRegisterAuth('email')
                        setError(null)
                      }}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      className={registerAuth === 'whatsapp' ? 'auth-neo-authopt active' : 'auth-neo-authopt'}
                      onClick={() => {
                        setRegisterAuth('whatsapp')
                        setError(null)
                      }}
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      className={registerAuth === 'google' ? 'auth-neo-authopt active' : 'auth-neo-authopt'}
                      onClick={() => {
                        setRegisterAuth('google')
                        setError(null)
                      }}
                    >
                      Google
                    </button>
                  </div>

                  <label className="auth-neo-field">
                    <span>Agency / Company</span>
                    <input
                      value={agencyName}
                      onChange={(e) => setAgencyName(e.target.value)}
                      placeholder="Nama agency / company"
                      required
                    />
                  </label>
                  <label className="auth-neo-field">
                    <span>Nama kamu</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Opsional" />
                  </label>

                  {registerAuth === 'email' ? (
                    <>
                      <label className="auth-neo-field">
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
                      <label className="auth-neo-field">
                        <span>Password</span>
                        <input
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          type="password"
                          autoComplete="new-password"
                          placeholder="Minimal 8 karakter"
                          required
                        />
                      </label>
                    </>
                  ) : null}

                  {registerAuth === 'whatsapp' ? (
                    <>
                      <label className="auth-neo-field">
                        <span>Nomor WhatsApp</span>
                        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+62..." required />
                      </label>
                      <label className="auth-neo-field">
                        <span>Kode OTP</span>
                        <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="123456" />
                      </label>
                      <button type="button" className="auth-neo-forgot" onClick={onRequestOTP} disabled={isSendingOTP}>
                        {isSendingOTP ? 'Sending...' : 'Kirim OTP'}
                      </button>
                    </>
                  ) : null}

                  {registerAuth === 'google' ? (
                    <div className="auth-neo-note">Klik tombol bulat untuk lanjut Google.</div>
                  ) : null}
                </>
              ) : (
                <>
                  {loginAuth === 'google' ? (
                    <div className="auth-neo-note">Klik tombol bulat untuk lanjut Google.</div>
                  ) : loginAuth === 'whatsapp' ? (
                    <>
                      <label className="auth-neo-field">
                        <span>Nomor WhatsApp</span>
                        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+62..." required />
                      </label>
                      <label className="auth-neo-field">
                        <span>Kode OTP</span>
                        <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="123456" />
                      </label>
                      <button type="button" className="auth-neo-forgot" onClick={onRequestOTP} disabled={isSendingOTP}>
                        {isSendingOTP ? 'Sending...' : 'Kirim OTP'}
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="auth-neo-field">
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
                      <label className="auth-neo-field">
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
                    </>
                  )}
                </>
              )}

              <div className="auth-neo-meta">
                <label className="auth-neo-remember">
                  <input type="checkbox" />
                  <span>Remember Password</span>
                </label>
                <button
                  type="button"
                  className="auth-neo-forgot"
                  onClick={() => toast.push({ kind: 'info', title: 'Forgot password', message: 'Fitur reset password menyusul.' })}
                >
                  Forgot password?
                </button>
              </div>

              {error ? <div className="error">{error}</div> : null}
            </form>

            <button
              type="button"
              className="auth-neo-circle"
              disabled={isSubmitting}
              onClick={() => {
                const fake = { preventDefault() {} } as unknown as React.FormEvent
                void onSubmit(fake)
              }}
            >
              {isSubmitting ? '...' : title}
            </button>
          </div>

          <div className="auth-neo-help">
            {subtitle}
          </div>
        </div>
      </div>
    </div>
  )
}
