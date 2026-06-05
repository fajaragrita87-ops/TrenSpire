import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { type Client, listClients } from '../lib/api'
import { clearAccessToken } from '../lib/auth'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const count = useMemo(() => clients.length, [clients.length])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await listClients()
        if (!cancelled) setClients(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load clients'
        if (!cancelled) setError(msg)
        if (String(msg).toLowerCase().includes('unauthorized')) {
          clearAccessToken()
          navigate('/login', { replace: true })
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [navigate])

  function logout() {
    clearAccessToken()
    navigate('/login', { replace: true })
  }

  return (
    <div className="page page-dashboard">
      <div className="topbar">
        <div>
          <div className="title">Dashboard</div>
          <div className="muted">Client count: {count}</div>
        </div>
        <button type="button" onClick={logout} className="secondary">
          Logout
        </button>
      </div>

      <div className="card">
        <h2>Clients</h2>
        {isLoading ? <div className="muted">Loading...</div> : null}
        {error ? <div className="error">{error}</div> : null}
        {!isLoading && !error && clients.length === 0 ? (
          <div className="muted">Belum ada client</div>
        ) : null}

        {!isLoading && !error && clients.length > 0 ? (
          <ul className="list">
            {clients.map((c) => (
              <li key={c.id} className="list-item">
                <div className="list-title">{c.name}</div>
                <div className="muted">
                  {c.social_accounts?.length ? (
                    <>
                      Social: {c.social_accounts.map((s) => s.platform).join(', ')}
                    </>
                  ) : (
                    <>No social accounts</>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
