import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'

import {
  aiCaption,
  aiContentPlan,
  analyticsDashboard,
  connectAccount,
  competitorAnalyze,
  createClient,
  createOfflineCampaign,
  createPost,
  createReport,
  listCalendarPosts,
  listClients,
  listPosts,
  listReports,
  publishNow,
  schedulePost,
  updateClient,
  type CalendarEvent,
  type Client,
  type ContentPlanItem,
  type Post,
  type ReportListItem,
} from '../lib/api'
import { clearAuth, useAuthStore } from '../lib/auth'
import { useToast } from '../lib/toast'

import { Calendar as BigCalendar, dateFnsLocalizer, type Event } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { endOfMonth, endOfWeek, format, getDay, parse, startOfMonth, startOfWeek } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

type NavKey = 'Dashboard' | 'Clients' | 'Posts' | 'Calendar' | 'Analytics' | 'Reports'

function NavIcon({ k }: { k: NavKey }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }
  const stroke = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (k === 'Dashboard') {
    return (
      <svg {...common}>
        <path {...stroke} d="M4 13.5V6.8c0-.8.7-1.5 1.5-1.5h4.2c.8 0 1.5.7 1.5 1.5v6.7c0 .8-.7 1.5-1.5 1.5H5.5C4.7 15 4 14.3 4 13.5Z" />
        <path {...stroke} d="M12.8 17.2V10.5c0-.8.7-1.5 1.5-1.5h4.2c.8 0 1.5.7 1.5 1.5v6.7c0 .8-.7 1.5-1.5 1.5h-4.2c-.8 0-1.5-.7-1.5-1.5Z" />
      </svg>
    )
  }
  if (k === 'Clients') {
    return (
      <svg {...common}>
        <path {...stroke} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <path {...stroke} d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path {...stroke} d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path {...stroke} d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  }
  if (k === 'Posts') {
    return (
      <svg {...common}>
        <path {...stroke} d="M12 20h9" />
        <path {...stroke} d="M12 4h9" />
        <path {...stroke} d="M4 6h6v6H4V6Z" />
        <path {...stroke} d="M4 14h6v6H4v-6Z" />
      </svg>
    )
  }
  if (k === 'Calendar') {
    return (
      <svg {...common}>
        <path {...stroke} d="M7 3v3" />
        <path {...stroke} d="M17 3v3" />
        <path {...stroke} d="M4 8h16" />
        <path {...stroke} d="M6 6h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
      </svg>
    )
  }
  if (k === 'Analytics') {
    return (
      <svg {...common}>
        <path {...stroke} d="M4 19V5" />
        <path {...stroke} d="M4 19h16" />
        <path {...stroke} d="M8 15v-3" />
        <path {...stroke} d="M12 15V8" />
        <path {...stroke} d="M16 15v-6" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path {...stroke} d="M7 7h10v10H7V7Z" />
      <path {...stroke} d="M7 12h10" />
      <path {...stroke} d="M12 7v10" />
    </svg>
  )
}

const calendarLocalizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { id: idLocale },
})

function prettyErrorMessage(raw: string): { title: string; detail: string } {
  const s = String(raw || '').trim()
  const low = s.toLowerCase()
  if (low.includes('unauthorized')) return { title: 'Sesi habis', detail: 'Login ulang untuk lanjut.' }
  if (low.includes('status code 404') || low.includes('http 404') || low.includes('not found')) {
    return { title: 'Live feed tidak tersedia', detail: 'Sinkronisasi belum aktif di server ini.' }
  }
  if (low.includes('network') || low.includes('failed to fetch') || low.includes('timeout')) {
    return { title: 'Koneksi bermasalah', detail: 'Periksa koneksi lalu coba lagi.' }
  }
  return { title: 'Terjadi kesalahan', detail: s || 'Coba lagi.' }
}

const navItems: Array<{ key: NavKey; label: string }> = [
  { key: 'Dashboard', label: 'Dashboard' },
  { key: 'Clients', label: 'Clients' },
  { key: 'Posts', label: 'Posts' },
  { key: 'Calendar', label: 'Calendar' },
  { key: 'Analytics', label: 'Analytics' },
  { key: 'Reports', label: 'Reports' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const user = useAuthStore((s) => s.user)
  const agency = useAuthStore((s) => s.agency)
  const [activeNav, setActiveNav] = useState<NavKey>('Dashboard')
  const [moduleFX, setModuleFX] = useState<{ key: NavKey; title: string; hint: string; seq: number } | null>(null)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [intelOpen, setIntelOpen] = useState(false)
  const [intelClientId, setIntelClientId] = useState<string | null>(null)
  const [intelInitialTab, setIntelInitialTab] = useState<'profile' | 'competitor' | 'offline'>('profile')
  const [intelAutoGenerate, setIntelAutoGenerate] = useState(false)
  const [refreshSeq, setRefreshSeq] = useState(0)
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsError, setPostsError] = useState<string | null>(null)
  const lastUpdate = useMemo(() => new Date().toLocaleString(), [])
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const v = localStorage.getItem('theme')
    return v === 'light' || v === 'dark' ? v : 'system'
  })

  const intelClient = useMemo(() => clients.find((c) => c.id === intelClientId) ?? null, [clients, intelClientId])

  function openIntel(clientId: string, tab: 'profile' | 'competitor' | 'offline', autoGenerate: boolean) {
    setIntelClientId(clientId)
    setIntelInitialTab(tab)
    setIntelAutoGenerate(autoGenerate)
    setIntelOpen(true)
  }

  function activateNav(next: NavKey) {
    setActiveNav(next)
    const map: Record<NavKey, { title: string; hint: string }> = {
      Dashboard: { title: 'CONTROL ROOM', hint: 'Booting overview layer…' },
      Clients: { title: 'CLIENTS', hint: 'Loading brand graph…' },
      Posts: { title: 'POST OPS', hint: 'Sync queue & schedulers…' },
      Calendar: { title: 'CALENDAR', hint: 'Rendering timeline…' },
      Analytics: { title: 'ANALYTICS', hint: 'Sampling live signals…' },
      Reports: { title: 'REPORTS', hint: 'Preparing PDF pipeline…' },
    }
    setModuleFX((prev) => ({ key: next, title: map[next].title, hint: map[next].hint, seq: (prev?.seq ?? 0) + 1 }))
  }

  useEffect(() => {
    if (!moduleFX) return
    const t = window.setTimeout(() => setModuleFX(null), 720)
    return () => window.clearTimeout(t)
  }, [moduleFX])

  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
      localStorage.removeItem('theme')
      return
    }
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      setPostsLoading(true)
      setPostsError(null)
      try {
        const clientData = await listClients()
        if (!cancelled) setClients(clientData)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load clients'
        if (!cancelled) setError(msg)
        toast.push({ kind: 'error', title: 'Gagal load clients', message: msg })
        if (String(msg).toLowerCase().includes('unauthorized')) {
          navigate('/login', { replace: true })
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }

      try {
        const postData = await listPosts({ limit: 200 })
        if (!cancelled) setPosts(postData)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load posts'
        if (!cancelled) setPostsError(msg)
        toast.push({ kind: 'error', title: 'Gagal load posts', message: msg })
        if (String(msg).toLowerCase().includes('unauthorized')) {
          navigate('/login', { replace: true })
        }
      } finally {
        if (!cancelled) setPostsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [navigate, toast])

  async function reloadClients() {
    setIsLoading(true)
    setError(null)
    try {
      const data = await listClients()
      setClients(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal load clients'
      setError(msg)
      toast.push({ kind: 'error', title: 'Gagal load clients', message: msg })
      if (String(msg).toLowerCase().includes('unauthorized')) {
        navigate('/login', { replace: true })
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function reloadPosts() {
    setPostsLoading(true)
    setPostsError(null)
    try {
      const data = await listPosts({ limit: 200 })
      setPosts(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal load posts'
      setPostsError(msg)
      toast.push({ kind: 'error', title: 'Gagal load posts', message: msg })
      if (String(msg).toLowerCase().includes('unauthorized')) {
        navigate('/login', { replace: true })
      }
    } finally {
      setPostsLoading(false)
    }
  }

  function bumpRefresh() {
    setRefreshSeq((v) => v + 1)
  }

  function logout() {
    clearAuth()
    toast.push({ kind: 'info', title: 'Logout' })
    navigate('/login', { replace: true })
  }

  const totalClients = clients.length
  const connectedAccounts = useMemo(() => countConnectedAccounts(clients), [clients])
  const scheduledPosts = useMemo(
    () => posts.filter((p) => p.status === 'scheduled' || p.status === 'queued').length,
    [posts],
  )
  const topClients = useMemo(() => clients.slice(0, 6), [clients])

  return (
    <div className="dash-page">
      <div className="dash-shell" data-nav={activeNav}>
        <ModuleFXOverlay fx={moduleFX} />
        <div className="dash-header">
          <div className="dash-header-left">
            <div className="dash-brand">
              <div className="dash-logo" aria-hidden="true">
                TS
              </div>
              <div>
                <div className="dash-title">TrendSpire</div>
                <div className="dash-subtitle">{agency?.name ?? 'Agency'}</div>
              </div>
            </div>

            <div className="dash-status-row" aria-label="Status">
              <div className={error ? 'dash-chip bad' : isLoading ? 'dash-chip warn' : 'dash-chip ok'}>
                Clients {error ? 'OFF' : isLoading ? 'SYNC' : 'LIVE'}
              </div>
              <div className={postsError ? 'dash-chip bad' : postsLoading ? 'dash-chip warn' : 'dash-chip ok'}>
                Posts {postsError ? 'OFF' : postsLoading ? 'SYNC' : 'LIVE'}
              </div>
              <div className="dash-chip neutral">
                Smart Ops
              </div>
            </div>
          </div>

          <div className="dash-meta">
            <div className="dash-meta-item">
              <div className="dash-meta-label">Last Update</div>
              <div className="dash-meta-value">{lastUpdate}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
                setTheme(next)
                toast.push({
                  kind: 'info',
                  title: 'Theme',
                  message: next === 'system' ? 'System' : next === 'light' ? 'Light mode' : 'Dark mode',
                })
              }}
              className="dash-ghost-btn"
            >
              {theme === 'system' ? 'Theme · Auto' : theme === 'light' ? 'Theme · Light' : 'Theme · Dark'}
            </button>
            <button type="button" onClick={logout} className="dash-ghost-btn">
              Logout
            </button>
          </div>
        </div>

        <div className="dash-body">
          <div className="dash-grid">
          <section className="dash-card dash-left">
            <div className="dash-segment">
              <div className="dash-segment-title">Navigation</div>
              <div className="dash-nav">
                {navItems.map((item) => (
                  <div key={item.key}>
                    <button
                      type="button"
                      className={activeNav === item.key ? 'dash-nav-item active' : 'dash-nav-item'}
                      onClick={() => activateNav(item.key)}
                    >
                      <span className="dash-nav-icon" aria-hidden="true">
                        <NavIcon k={item.key} />
                      </span>
                      <span className="dash-nav-label">{item.label}</span>
                    </button>
                    {item.key === 'Reports' ? (
                      <button type="button" className="dash-nav-help" onClick={() => setIsGuideOpen(true)}>
                        Tentang & panduan
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="dash-segment">
              <div className="dash-segment-title">Account</div>
              <div className="dash-kv">
                <div className="dash-kv-row">
                  <div className="dash-kv-key">Agency</div>
                  <div className="dash-kv-val">{agency?.name ?? '-'}</div>
                </div>
                <div className="dash-kv-row">
                  <div className="dash-kv-key">User</div>
                  <div className="dash-kv-val">{user?.name ?? user?.email ?? '-'}</div>
                </div>
                <div className="dash-kv-row">
                  <div className="dash-kv-key">Role</div>
                  <div className="dash-kv-val">{user?.role ?? '-'}</div>
                </div>
              </div>
            </div>

            <div className="dash-segment">
              <div className="dash-segment-title">
                Clients <span className="dash-badge">{totalClients}</span>
              </div>
              {isLoading ? <div className="muted">Loading...</div> : null}
              {error ? <div className="error">{error}</div> : null}
              {!isLoading && !error && topClients.length === 0 ? (
                <div className="muted">Belum ada client</div>
              ) : null}
              {!isLoading && !error && topClients.length > 0 ? (
                <ul className="dash-mini-list">
                  {topClients.map((c) => (
                    <li key={c.id} className="dash-mini-item">
                      <div className="dash-mini-name">{c.name}</div>
                      <div className="dash-mini-meta">
                        {c.social_accounts?.length
                          ? c.social_accounts.map((s) => s.platform).join(', ')
                          : 'no social'}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <section className="dash-metrics">
            <div className="dash-metric-card grad-purple">
              <div className="dash-metric-top">
                <div className="dash-metric-title">Total Clients</div>
                <div className="dash-metric-sub">{isLoading ? 'Loading' : 'Live'}</div>
              </div>
              <div className="dash-metric-value">{String(totalClients)}</div>
            </div>
            <div className="dash-metric-card grad-gold">
              <div className="dash-metric-top">
                <div className="dash-metric-title">Connected Accounts</div>
                <div className="dash-metric-sub">{isLoading ? 'Loading' : 'Live'}</div>
              </div>
              <div className="dash-metric-value">{String(connectedAccounts)}</div>
            </div>
            <div className="dash-metric-card grad-teal">
              <div className="dash-metric-top">
                <div className="dash-metric-title">Scheduled Posts</div>
                <div className="dash-metric-sub">{postsLoading ? 'Loading' : 'Live'}</div>
              </div>
              <div className="dash-metric-value">{String(scheduledPosts)}</div>
            </div>
          </section>

          <section className="dash-card dash-chart">
            <div className="dash-card-head">
              <div className="dash-card-title dash-card-title-row">
                <span className="dash-card-title-icon" aria-hidden="true">
                  <NavIcon k={activeNav} />
                </span>
                <span>{activeNav === 'Dashboard' ? 'Control Room' : activeNav}</span>
              </div>
              <ModeHUD nav={activeNav} syncing={isLoading || postsLoading} />
            </div>
            {activeNav === 'Clients' ? (
              <div className="dash-stack">
                <CreateClientForm
                  onCreate={async (input) => {
                    const created = await createClient(input)
                    toast.push({ kind: 'success', title: 'Client dibuat', message: created.name })
                    await reloadClients()
                    bumpRefresh()
                  }}
                />
                <ClientIntelQuickPanel clients={clients} isLoading={isLoading} error={error} onOpenIntel={openIntel} />
                <ClientsTable
                  clients={clients}
                  isLoading={isLoading}
                  error={error}
                  onOpenIntel={(clientId) => {
                    openIntel(clientId, 'profile', false)
                  }}
                  onConnectInstagram={async (clientId) => {
                    try {
                      const res = await connectAccount('instagram', clientId)
                      toast.push({ kind: 'info', title: 'Redirect OAuth', message: 'Membuka halaman connect Instagram' })
                      window.location.href = res.auth_url
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Gagal connect IG'
                      toast.push({ kind: 'error', title: 'Gagal connect IG', message: msg })
                    }
                  }}
                />
              </div>
            ) : activeNav === 'Calendar' ? (
              <CalendarPanel clients={clients} refreshSeq={refreshSeq} />
            ) : activeNav === 'Posts' ? (
              <PostsPanel
                clients={clients}
                isClientsLoading={isLoading}
                clientsError={error}
                posts={posts}
                isPostsLoading={postsLoading}
                postsError={postsError}
                onReloadPosts={reloadPosts}
                onDidMutate={() => {
                  bumpRefresh()
                  void reloadPosts()
                }}
              />
            ) : activeNav === 'Analytics' ? (
              <AnalyticsPanel refreshSeq={refreshSeq} />
            ) : activeNav === 'Reports' ? (
              <ReportsPanel
                clients={clients}
                isLoading={isLoading}
                error={error}
                onDidMutate={() => {
                  bumpRefresh()
                }}
              />
            ) : activeNav === 'Dashboard' && !isLoading && !error && clients.length === 0 ? (
              <OnboardingPanel onGoClients={() => activateNav('Clients')} />
            ) : (
              <DashboardPanel
                clients={clients}
                isClientsLoading={isLoading}
                clientsError={error}
                posts={posts}
                isPostsLoading={postsLoading}
                postsError={postsError}
                onReloadPosts={reloadPosts}
                onOpenIntel={openIntel}
              />
            )}
          </section>

          <section className="dash-card dash-bars">
            <div className="dash-card-head">
              <div className="dash-card-title">Analytics</div>
            </div>
            <AnalyticsSummaryCard refreshSeq={refreshSeq} />
          </section>

          <section className="dash-card dash-donut">
            <div className="dash-card-head">
              <div className="dash-card-title">Upcoming Posts</div>
            </div>
            <UpcomingPostsCard refreshSeq={refreshSeq} />
          </section>

          <section className="dash-card dash-ambient">
            <div className="dash-card-head">
              <div className="dash-card-title">Signal Field</div>
              <div className="dash-card-subtitle">{isLoading || postsLoading ? 'SYNCING' : 'LIVE'}</div>
            </div>
            <AmbientPanel
              nav={activeNav}
              syncing={isLoading || postsLoading}
              signals={{ clients: totalClients, connected: connectedAccounts, scheduled: scheduledPosts }}
            />
          </section>

          <section className="dash-card dash-expenses">
            <div className="dash-card-head">
              <div className="dash-card-title">Recent Reports</div>
            </div>
            <RecentReportsCard refreshSeq={refreshSeq} />
          </section>
          </div>
        </div>
        <GuideModal open={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
        {intelOpen ? (
          <ClientIntelModal
            client={intelClient}
            initialTab={intelInitialTab}
            autoGenerate={intelAutoGenerate}
            onClose={() => setIntelOpen(false)}
            onDidMutate={() => {
              void reloadClients()
              bumpRefresh()
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function ModuleFXOverlay({ fx }: { fx: { key: NavKey; title: string; hint: string; seq: number } | null }) {
  if (!fx) return null
  return (
    <div key={fx.seq} className="dash-modulefx-overlay" aria-hidden="true">
      <div className="dash-modulefx-card">
        <div className="dash-modulefx-title">{fx.title}</div>
        <div className="dash-modulefx-hint">{fx.hint}</div>
        <div className="dash-modulefx-scan" />
      </div>
    </div>
  )
}

function ModeHUD({ nav, syncing }: { nav: NavKey; syncing: boolean }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const t = window.setInterval(() => setStep((v) => (v + 1) % 1000000), 900)
    return () => window.clearInterval(t)
  }, [])

  const label = useMemo(() => {
    const pulse = syncing ? 'SYNC' : 'LIVE'
    const table: Record<NavKey, string[]> = {
      Dashboard: [`${pulse} · SYSTEM OVERVIEW`, 'ROUTING SIGNALS', 'STABILITY CHECK'],
      Clients: [`${pulse} · BRAND GRAPH`, 'ACCOUNT LINKS', 'INTEL READY'],
      Posts: [`${pulse} · QUEUE OPS`, 'SCHEDULER ONLINE', 'PUBLISH PIPE'],
      Calendar: [`${pulse} · TIMELINE`, 'TIME WINDOWS', 'EXECUTE MAP'],
      Analytics: [`${pulse} · SIGNALS`, 'KPI SAMPLER', 'TREND DETECTOR'],
      Reports: [`${pulse} · PDF PIPELINE`, 'MAGIC LINK', 'CLIENT DELIVERY'],
    }
    const arr = table[nav]
    return arr[step % arr.length]
  }, [nav, step, syncing])

  return (
    <div className="dash-modehud" aria-label="Mode">
      <span className="dash-modehud-text">{label}</span>
      <span className="dash-modehud-caret" aria-hidden="true" />
    </div>
  )
}

function AmbientPanel({
  nav,
  syncing,
  signals,
}: {
  nav: NavKey
  syncing: boolean
  signals: { clients: number; connected: number; scheduled: number }
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const dxRef = useRef(0)
  const dyRef = useRef(0)

  const tone = syncing ? 'sync' : 'live'
  const headline = useMemo(() => {
    const map: Record<NavKey, string> = {
      Dashboard: 'SYSTEM RADAR',
      Clients: 'BRAND NETWORK',
      Posts: 'QUEUE MOTION',
      Calendar: 'TIMELINE SWEEP',
      Analytics: 'SIGNAL WAVE',
      Reports: 'PDF PIPELINE',
    }
    return map[nav]
  }, [nav])

  const readout = useMemo(() => {
    const tag = syncing ? 'SYNC' : 'LIVE'
    return `${tag} · ${headline}`
  }, [headline, syncing])

  const energy = useMemo(() => {
    const c = Math.max(0, signals.clients || 0)
    const a = Math.max(0, signals.connected || 0)
    const s = Math.max(0, signals.scheduled || 0)
    const raw = c * 0.08 + a * 0.14 + s * 0.22
    return Math.max(0.12, Math.min(1, raw))
  }, [signals.clients, signals.connected, signals.scheduled])

  const style = useMemo<CSSProperties>(() => {
    const amp = Math.round(12 + energy * 62)
    const waveMs = Math.round((syncing ? 1280 : 1580) - energy * 420)
    const radarMs = Math.round((syncing ? 2100 : 2600) - energy * 520)
    return {
      '--amp': `${amp}%`,
      '--wave-ms': `${waveMs}ms`,
      '--radar-ms': `${radarMs}ms`,
    } as CSSProperties
  }, [energy, syncing])

  function scheduleWrite() {
    if (rafRef.current != null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const el = ref.current
      if (!el) return
      const dx = dxRef.current
      const dy = dyRef.current
      el.style.setProperty('--dx', `${dx.toFixed(2)}px`)
      el.style.setProperty('--dy', `${dy.toFixed(2)}px`)
      el.style.setProperty('--dx2', `${(-dx * 0.6).toFixed(2)}px`)
      el.style.setProperty('--dy2', `${(-dy * 0.6).toFixed(2)}px`)
    })
  }

  function onPointerMove(e: ReactPointerEvent) {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / Math.max(1, r.width)
    const y = (e.clientY - r.top) / Math.max(1, r.height)
    dxRef.current = (x - 0.5) * 16
    dyRef.current = (y - 0.5) * 12
    scheduleWrite()
  }

  function onPointerLeave() {
    dxRef.current = 0
    dyRef.current = 0
    scheduleWrite()
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div
      ref={ref}
      className={`dash-ambient-panel ${tone}`}
      style={style}
      aria-label="Signal Field"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="dash-ambient-top">
        <div className="dash-ambient-left">
          <div className="dash-ambient-readout">{readout}</div>
          <div className="dash-ambient-stats">
            <span className="dash-ambient-stat">clients {String(signals.clients)}</span>
            <span className="dash-ambient-stat">connected {String(signals.connected)}</span>
            <span className="dash-ambient-stat">scheduled {String(signals.scheduled)}</span>
          </div>
        </div>
        <div className="dash-ambient-mode">{nav.toUpperCase()}</div>
      </div>
      <div className="dash-ambient-particles" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="dash-ambient-particle" style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="dash-ambient-holo" aria-hidden="true" />
      <div className="dash-ambient-sheen" aria-hidden="true" />
      <div className="dash-ambient-grid">
        <div className="dash-ambient-radar" aria-hidden="true">
          <div className="dash-ambient-ring" />
          <div className="dash-ambient-ring" />
          <div className="dash-ambient-sweep" />
          <div className="dash-ambient-ping" />
          <div className="dash-ambient-dot a" />
          <div className="dash-ambient-dot b" />
          <div className="dash-ambient-dot c" />
        </div>
        <div className="dash-ambient-wave" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="dash-ambient-bar" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      </div>
    </div>
  )
}

type TerminalContext = {
  clientName: string
  industry: string
  location: string
  mode: 'competitor' | 'offline' | 'plan'
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function useTypewriterText(input: string, seq: number, opts?: { maxChars?: number; cps?: number }) {
  const maxChars = opts?.maxChars ?? 5200
  const cps = opts?.cps ?? 120
  const [out, setOut] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const target = input.length > maxChars ? input.slice(0, maxChars) : input
    setOut('')
    setDone(false)
    if (!target) {
      setDone(true)
      return
    }
    let i = 0
    const msPerTick = 16
    const charsPerTick = Math.max(1, Math.round((cps * msPerTick) / 1000))
    const t = window.setInterval(() => {
      i = Math.min(target.length, i + charsPerTick)
      setOut(target.slice(0, i))
      if (i >= target.length) {
        window.clearInterval(t)
        setDone(true)
      }
    }, msPerTick)
    return () => window.clearInterval(t)
  }, [cps, input, maxChars, seq])

  const rest = input.length > maxChars ? input.slice(maxChars) : ''
  const full = done ? out + rest : out
  return { text: full, done }
}

function TerminalPanel({
  seq,
  title,
  running,
  error,
  data,
  context,
}: {
  seq: number
  title: string
  running: boolean
  error: string | null
  data: unknown
  context: TerminalContext
}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setTick((v) => (v + 1) % 1000000), 180)
    return () => window.clearInterval(t)
  }, [running])

  const bootLines = useMemo(() => {
    const stamp = () => new Date().toLocaleTimeString('id-ID', { hour12: false })
    const seed = [
      `[${stamp()}] TS/OPS :: INIT`,
      `[${stamp()}] TARGET   :: ${context.clientName}`,
      `[${stamp()}] PROFILE  :: industry=${context.industry} geo=${context.location}`,
      `[${stamp()}] MODE     :: ${context.mode === 'competitor' ? 'COMPETITOR_SWEEP' : 'OFFLINE_CAMPAIGN_PARSE'}`,
      `[${stamp()}] CHANNEL  :: secure://intel.bus`,
    ]
    return seed.join('\n')
  }, [context.clientName, context.industry, context.location, context.mode])

  const runningLine = useMemo(() => {
    if (!running) return ''
    const frames = ['▍', '▎', '▏', '▎']
    const dots = ['.', '..', '...', '....']
    const f = frames[tick % frames.length]
    const d = dots[tick % dots.length]
    const step =
      context.mode === 'competitor'
        ? ['enumerating competitors', 'capturing offers', 'mapping channels', 'scoring opportunities', 'writing quick wins'][tick % 5]
        : context.mode === 'offline'
          ? ['parsing brief', 'extracting assets', 'detecting touchpoints', 'building roadmap', 'ranking activations'][tick % 5]
          : ['compiling signals', 'drafting plan items', 'balancing angles', 'packing captions', 'finalizing schedule'][tick % 5]
    return `[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] RUN      :: ${step}${d} ${f}`
  }, [context.mode, running, tick])

  const resultBlock = useMemo(() => {
    if (!data) return ''
    const payload = safeJSONStringify(data)
    return [
      `[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] OK       :: payload decoded`,
      `[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] STREAM   :: json://intel.payload`,
      payload,
    ].join('\n')
  }, [data])

  const errorBlock = useMemo(() => {
    if (!error) return ''
    return [
      `[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] FAIL     :: ${String(error)}`,
      `[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] TRACE    :: op aborted`,
    ].join('\n')
  }, [error])

  const fullText = useMemo(() => {
    const parts = [bootLines]
    if (runningLine) parts.push(runningLine)
    if (!running && errorBlock) parts.push(errorBlock)
    if (!running && resultBlock) parts.push(resultBlock)
    return parts.filter(Boolean).join('\n')
  }, [bootLines, errorBlock, resultBlock, running, runningLine])

  const { text } = useTypewriterText(fullText, seq, { maxChars: 7200, cps: 210 })
  const showCursor = running || (text.length > 0 && !data && !error)

  return (
    <div className="dash-terminal">
      <div className="dash-terminal-head">
        <div className="dash-terminal-title">{title}</div>
        <div className="dash-terminal-meta">
          {running ? 'LIVE' : error ? 'ERROR' : data ? 'READY' : 'IDLE'} · {context.mode.toUpperCase()}
        </div>
      </div>
      <div className="dash-terminal-body" role="status" aria-live="polite">
        <pre className="dash-terminal-pre">
          {text}
          {showCursor ? <span className="dash-terminal-cursor" /> : null}
        </pre>
      </div>
    </div>
  )
}

function countConnectedAccounts(clients: Client[]): number {
  let n = 0
  for (const c of clients) {
    for (const s of c.social_accounts ?? []) {
      if (s.connected_at) n += 1
    }
  }
  return n
}

function DashNotice({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string
  detail: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="dash-notice" role="status">
      <div className="dash-notice-title">{title}</div>
      <div className="dash-notice-detail">{detail}</div>
      {actionLabel && onAction ? (
        <button type="button" className="dash-notice-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function FlowDiagram({
  clientsCount,
  connectedAccounts,
  scheduledPosts,
}: {
  clientsCount: number
  connectedAccounts: number
  scheduledPosts: number
}) {
  return (
    <div className="dash-flow" aria-label="Flow">
      <div className="dash-flow-head">
        <div className="dash-flow-title">Trend Map</div>
        <div className="dash-flow-sub">TECH · FUTURE · SMART · ART</div>
      </div>
      <div className="dash-flow-track" aria-hidden="true">
        <div className="dash-flow-line" />
      </div>
      <div className="dash-flow-grid">
        <div className="dash-flow-node">
          <div className="dash-flow-node-icon">
            <NavIcon k="Clients" />
          </div>
          <div className="dash-flow-node-title">Clients</div>
          <div className="dash-flow-node-meta">{clientsCount}</div>
        </div>
        <div className="dash-flow-node">
          <div className="dash-flow-node-icon">
            <NavIcon k="Clients" />
          </div>
          <div className="dash-flow-node-title">OAuth</div>
          <div className="dash-flow-node-meta">{connectedAccounts}</div>
        </div>
        <div className="dash-flow-node">
          <div className="dash-flow-node-icon">
            <NavIcon k="Posts" />
          </div>
          <div className="dash-flow-node-title">Schedule</div>
          <div className="dash-flow-node-meta">{scheduledPosts}</div>
        </div>
        <div className="dash-flow-node">
          <div className="dash-flow-node-icon">
            <NavIcon k="Reports" />
          </div>
          <div className="dash-flow-node-title">Reports</div>
          <div className="dash-flow-node-meta">PDF</div>
        </div>
      </div>
    </div>
  )
}

function DashboardPanel({
  clients,
  isClientsLoading,
  clientsError,
  posts,
  isPostsLoading,
  postsError,
  onReloadPosts,
  onOpenIntel,
}: {
  clients: Client[]
  isClientsLoading: boolean
  clientsError: string | null
  posts: Post[]
  isPostsLoading: boolean
  postsError: string | null
  onReloadPosts: () => Promise<void>
  onOpenIntel: (clientId: string, tab: 'profile' | 'competitor' | 'offline', autoGenerate: boolean) => void
}) {
  const toast = useToast()

  const connected = useMemo(() => countConnectedAccounts(clients), [clients])
  const scheduled = useMemo(() => posts.filter((p) => p.status === 'scheduled' || p.status === 'queued').length, [posts])

  return (
    <div className="dash-stack">
      <FlowDiagram clientsCount={clients.length} connectedAccounts={connected} scheduledPosts={scheduled} />
      <div className="dash-form-card">
        <div className="dash-segment-title">Client Intelligence</div>
        {isClientsLoading ? <div className="muted">Sinkron...</div> : null}
        {clientsError ? <DashNotice {...prettyErrorMessage(clientsError)} /> : null}
        {!isClientsLoading && !clientsError && clients.length === 0 ? <div className="muted">Buat client untuk mulai competitor insight & offline campaign.</div> : null}
        {!isClientsLoading && !clientsError && clients.length > 0 ? (
          <div className="dash-mini-list">
            {clients.slice(0, 4).map((c) => {
              const hasIndustry = Boolean((c.industry ?? '').trim())
              return (
                <div key={c.id} className="dash-mini-item">
                  <div className="dash-mini-name">{c.name}</div>
                  <div className="dash-mini-meta">{hasIndustry ? `industry: ${c.industry}` : 'industry: -'}</div>
                  <div className="dash-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="dash-small-btn"
                      onClick={() => {
                        if (!hasIndustry) {
                          onOpenIntel(c.id, 'profile', false)
                          return
                        }
                        onOpenIntel(c.id, 'competitor', true)
                      }}
                    >
                      {hasIndustry ? 'Competitor Scan' : 'Set Industry'}
                    </button>
                    <button type="button" className="dash-small-btn" onClick={() => onOpenIntel(c.id, 'offline', false)}>
                      Offline Campaign
                    </button>
                    <button type="button" className="dash-small-btn" onClick={() => onOpenIntel(c.id, 'profile', false)}>
                      Profile
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      <div className="dash-form-card">
        <div className="dash-segment-title">Activity</div>
        <div className="dash-actions" style={{ marginBottom: 10 }}>
          <button type="button" className="dash-small-btn" onClick={() => void onReloadPosts()} disabled={isPostsLoading}>
            {isPostsLoading ? 'Sinkron...' : 'Sync sekarang'}
          </button>
        </div>

        {isClientsLoading || isPostsLoading ? <div className="muted">Sinkronisasi data...</div> : null}
        {clientsError ? <DashNotice {...prettyErrorMessage(clientsError)} /> : null}
        {postsError ? <DashNotice {...prettyErrorMessage(postsError)} actionLabel="Retry" onAction={() => void onReloadPosts()} /> : null}

        {!isPostsLoading && !postsError ? (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Execute At</th>
                  <th>Platforms</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="dash-td-muted">
                      Belum ada aktivitas
                    </td>
                  </tr>
                ) : (
                  posts.slice(0, 12).map((p) => (
                    <tr key={p.id}>
                      <td className="dash-td-strong">{p.client_name}</td>
                      <td>{p.status}</td>
                      <td>{p.execute_at ? new Date(p.execute_at).toLocaleString('id-ID') : '-'}</td>
                      <td>{p.platforms.join(', ')}</td>
                      <td>
                        <button
                          type="button"
                          className="dash-small-btn"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(p.content)
                              toast.push({ kind: 'success', title: 'Copied', message: 'Content disalin' })
                            } catch {
                              toast.push({ kind: 'error', title: 'Gagal copy', message: 'Copy manual dari teks' })
                            }
                          }}
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}

type CalendarUIEvent = Event & {
  id: string
  resource: {
    clientId: string
    clientName: string
    postId: string
    platforms: string[]
    status: string
  }
}

function CalendarPanel({ clients, refreshSeq }: { clients: Client[]; refreshSeq: number }) {
  const toast = useToast()
  const [viewDate, setViewDate] = useState(() => new Date())
  const [clientId, setClientId] = useState('')
  const [events, setEvents] = useState<CalendarUIEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualSeq, setManualSeq] = useState(0)

  const range = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 1 })
    return { start, end }
  }, [viewDate])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await listCalendarPosts({
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          client_id: clientId || undefined,
        })
        if (cancelled) return
        setEvents(
          rows.map((e) => ({
            id: e.id,
            title: e.title,
            start: new Date(e.start),
            end: new Date(e.end),
            resource: {
              clientId: e.client_id,
              clientName: e.client_name,
              postId: e.post_id,
              platforms: e.platforms,
              status: e.status,
            },
          })),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load calendar'
        if (!cancelled) setError(msg)
        const is404 =
          String(msg).toLowerCase().includes('status code 404') ||
          String(msg).toLowerCase().includes('http 404') ||
          String(msg).toLowerCase().includes('not found')
        if (!is404) {
          toast.push({ kind: 'error', title: 'Gagal load calendar', message: msg })
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [clientId, manualSeq, range.end, range.start, refreshSeq, toast])

  const palette = ['#7c3aed', '#f5b400', '#0fa79d', '#3b82f6', '#ef4444', '#f97316']

  function colorForClient(id: string): string {
    if (!id) return palette[0]
    let h = 0
    for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return palette[h % palette.length]
  }

  return (
    <div className="dash-stack">
      <div className="dash-actions">
        <label className="field" style={{ minWidth: 220 }}>
          <span>Client</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {isLoading ? <div className="muted">Sinkron...</div> : null}
        {error ? (
          <DashNotice
            {...prettyErrorMessage(error)}
            actionLabel="Retry"
            onAction={() => {
              setManualSeq((v) => v + 1)
            }}
          />
        ) : null}
      </div>

      <div style={{ height: 520 }}>
        <BigCalendar
          localizer={calendarLocalizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          onNavigate={(d: Date) => setViewDate(d)}
          views={['month', 'week', 'day', 'agenda']}
          defaultView="month"
          messages={{
            next: 'Next',
            previous: 'Prev',
            today: 'Today',
            month: 'Month',
            week: 'Week',
            day: 'Day',
            agenda: 'Agenda',
            date: 'Date',
            time: 'Time',
            event: 'Event',
            noEventsInRange: 'Tidak ada scheduled post di range ini',
          }}
          eventPropGetter={(ev: CalendarUIEvent) => {
            const e = ev
            const bg = colorForClient(e.resource?.clientId ?? '')
            return {
              style: {
                backgroundColor: bg,
                borderRadius: 10,
                border: '0',
                color: '#0b1020',
                padding: '2px 6px',
                fontWeight: 800,
              },
            }
          }}
          tooltipAccessor={(ev: CalendarUIEvent) => {
            const e = ev
            const p = e.resource?.platforms?.length ? ` (${e.resource.platforms.join(', ')})` : ''
            return `${e.title}${p}`
          }}
        />
      </div>
    </div>
  )
}

function AnalyticsSummaryCard({ refreshSeq }: { refreshSeq: number }) {
  const toast = useToast()
  const [data, setData] = useState<Awaited<ReturnType<typeof analyticsDashboard>> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualSeq, setManualSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        const d = await analyticsDashboard()
        if (!cancelled) setData(d)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load analytics'
        if (!cancelled) setError(msg)
        const is404 =
          String(msg).toLowerCase().includes('status code 404') ||
          String(msg).toLowerCase().includes('http 404') ||
          String(msg).toLowerCase().includes('not found')
        if (!is404) {
          toast.push({ kind: 'error', title: 'Gagal load analytics', message: msg })
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [manualSeq, refreshSeq, toast])

  const blended = data?.blended
  const engagementRatePct = blended ? `${(blended.engagement_rate * 100).toFixed(2)}%` : '-'

  return (
    <div>
      {isLoading ? <div className="muted">Sinkron...</div> : null}
      {error ? (
        <DashNotice
          {...prettyErrorMessage(error)}
          actionLabel="Retry"
          onAction={() => {
            setManualSeq((v) => v + 1)
          }}
        />
      ) : null}
      {!isLoading && !error && data ? (
        <div className="dash-kv">
          <div className="dash-kv-row">
            <div className="dash-kv-key">Date</div>
            <div className="dash-kv-val">{data.date}</div>
          </div>
          <div className="dash-kv-row">
            <div className="dash-kv-key">Clients</div>
            <div className="dash-kv-val">{String(data.clients_count)}</div>
          </div>
          <div className="dash-kv-row">
            <div className="dash-kv-key">Alerts 24h</div>
            <div className="dash-kv-val">{String(data.alerts_last_24h)}</div>
          </div>
          <div className="dash-kv-row">
            <div className="dash-kv-key">Followers</div>
            <div className="dash-kv-val">{String(blended?.followers ?? 0)}</div>
          </div>
          <div className="dash-kv-row">
            <div className="dash-kv-key">Impressions</div>
            <div className="dash-kv-val">{String(blended?.impressions ?? 0)}</div>
          </div>
          <div className="dash-kv-row">
            <div className="dash-kv-key">Engagement</div>
            <div className="dash-kv-val">{engagementRatePct}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function UpcomingPostsCard({ refreshSeq }: { refreshSeq: number }) {
  const toast = useToast()
  const [rows, setRows] = useState<CalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualSeq, setManualSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        const start = new Date()
        start.setHours(start.getHours() - 1)
        const end = new Date()
        end.setDate(end.getDate() + 14)
        const data = await listCalendarPosts({ start: start.toISOString(), end: end.toISOString() })
        if (!cancelled) setRows(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load upcoming posts'
        if (!cancelled) setError(msg)
        const is404 =
          String(msg).toLowerCase().includes('status code 404') ||
          String(msg).toLowerCase().includes('http 404') ||
          String(msg).toLowerCase().includes('not found')
        if (!is404) {
          toast.push({ kind: 'error', title: 'Gagal load upcoming posts', message: msg })
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [manualSeq, refreshSeq, toast])

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()).slice(0, 6)
  }, [rows])

  return (
    <div className="dash-rail">
      <div className="dash-rail-meta">Horizon · 14 hari</div>
      <div className="dash-rail-body">
        {isLoading ? <div className="muted">Sinkron...</div> : null}
        {!isLoading && error ? (
          <DashNotice
            {...prettyErrorMessage(error)}
            actionLabel="Retry"
            onAction={() => {
              setManualSeq((v) => v + 1)
            }}
          />
        ) : null}
        {!isLoading && !error && sorted.length === 0 ? <div className="muted">Belum ada post terjadwal</div> : null}
        {!isLoading && !error && sorted.length > 0 ? (
          <div className="dash-mini-list">
            {sorted.map((e) => (
              <div key={e.id} className="dash-mini-item">
                <div className="dash-mini-name">{e.client_name}</div>
                <div className="dash-mini-meta">
                  {new Date(e.start).toLocaleString('id-ID')} · {e.platforms.join(', ')}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RecentReportsCard({ refreshSeq }: { refreshSeq: number }) {
  const toast = useToast()
  const [rows, setRows] = useState<ReportListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualSeq, setManualSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await listReports({ limit: 6 })
        if (!cancelled) setRows(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load reports'
        if (!cancelled) setError(msg)
        const is404 =
          String(msg).toLowerCase().includes('status code 404') ||
          String(msg).toLowerCase().includes('http 404') ||
          String(msg).toLowerCase().includes('not found')
        if (!is404) {
          toast.push({ kind: 'error', title: 'Gagal load reports', message: msg })
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [manualSeq, refreshSeq, toast])

  return (
    <div className="dash-rail">
      <div className="dash-rail-meta">Magic Link · PDF</div>
      <div className="dash-rail-body">
        {isLoading ? <div className="muted">Sinkron...</div> : null}
        {!isLoading && error ? (
          <DashNotice
            {...prettyErrorMessage(error)}
            actionLabel="Retry"
            onAction={() => {
              setManualSeq((v) => v + 1)
            }}
          />
        ) : null}
        {!isLoading && !error && rows.length === 0 ? <div className="muted">Belum ada report</div> : null}
        {!isLoading && !error && rows.length > 0 ? (
          <div className="dash-mini-list">
            {rows.map((r) => (
              <div key={r.token} className="dash-mini-item">
                <div className="dash-mini-name">{r.client_name}</div>
                <div className="dash-mini-meta">
                  {new Date(r.created_at).toLocaleString('id-ID')} · views {r.view_count} · downloads {r.download_count}
                </div>
                <div className="dash-actions" style={{ marginTop: 8 }}>
                  <a className="dash-small-btn" href={r.magic_link_url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <a className="dash-small-btn" href={r.download_url} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ClientIntelModal({
  client,
  initialTab,
  autoGenerate,
  onClose,
  onDidMutate,
}: {
  client: Client | null
  initialTab: 'profile' | 'competitor' | 'offline'
  autoGenerate: boolean
  onClose: () => void
  onDidMutate: () => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<'profile' | 'competitor' | 'offline'>(() => initialTab)

  const [industry, setIndustry] = useState(() => client?.industry ?? '')
  const [location, setLocation] = useState(() => client?.location ?? '')
  const [reportBrandName, setReportBrandName] = useState(() => client?.report_brand_name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [compLoading, setCompLoading] = useState(false)
  const [compError, setCompError] = useState<string | null>(null)
  const [compResult, setCompResult] = useState<unknown>(null)
  const [compRunSeq, setCompRunSeq] = useState(0)

  const [planDays, setPlanDays] = useState(7)
  const [planPlatform, setPlanPlatform] = useState<'facebook' | 'x' | 'tiktok'>('facebook')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planItems, setPlanItems] = useState<ContentPlanItem[] | null>(null)
  const [planRunSeq, setPlanRunSeq] = useState(0)
  const [planStartDate, setPlanStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  })
  const [planStartTime, setPlanStartTime] = useState('10:00')
  const [planScheduling, setPlanScheduling] = useState(false)
  const [planScheduleError, setPlanScheduleError] = useState<string | null>(null)

  const [offlineFile, setOfflineFile] = useState<File | null>(null)
  const [offlineLoading, setOfflineLoading] = useState(false)
  const [offlineError, setOfflineError] = useState<string | null>(null)
  const [offlineResult, setOfflineResult] = useState<unknown>(null)
  const [offlineRunSeq, setOfflineRunSeq] = useState(0)

  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const apiTarget = import.meta.env.VITE_API_TARGET || 'http://localhost:8080'

  useEffect(() => {
    if (!client) return
    if (!autoGenerate) return
    if (initialTab !== 'competitor') return
    if (!industry.trim()) return
    if (compLoading || compResult) return
    void (async () => {
      setCompRunSeq((v) => v + 1)
      setCompLoading(true)
      setCompError(null)
      setCompResult(null)
      try {
        const data = await competitorAnalyze({ client_id: client.id })
        setCompResult(data)
        toast.push({ kind: 'success', title: 'Competitor Insight siap' })
        onDidMutate()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal generate competitor insight'
        setCompError(msg)
        toast.push({ kind: 'error', title: 'Competitor Insight', message: msg })
      } finally {
        setCompLoading(false)
      }
    })()
  }, [autoGenerate, client, compLoading, compResult, industry, initialTab, onDidMutate, toast])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  if (!client) return null

  async function downloadPDF() {
    if (!client) return
    setPdfLoading(true)
    setPdfError(null)
    try {
      const res = await createReport(client.id, {})
      const url = res.download_url ? res.download_url : `${apiTarget}/r/${res.token}/download`
      const abs = /^https?:\/\//i.test(url) ? url : `${apiTarget}${url.startsWith('/') ? url : `/${url}`}`
      window.open(abs, '_blank', 'noopener,noreferrer')
      toast.push({ kind: 'success', title: 'PDF siap' })
      onDidMutate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal download PDF'
      setPdfError(msg)
      toast.push({ kind: 'error', title: 'Gagal download PDF', message: msg })
    } finally {
      setPdfLoading(false)
    }
  }

  function buildPostContentFromPlanItem(it: ContentPlanItem): string {
    const parts: string[] = []
    if (it.caption) parts.push(it.caption.trim())
    const cta = (it.cta ?? '').trim()
    if (cta && !parts.join('\n').includes(cta)) parts.push(cta)
    const tags = (it.hashtags ?? []).map((t) => String(t).trim()).filter(Boolean)
    if (tags.length) parts.push(tags.join(' '))
    return parts.filter(Boolean).join('\n\n').trim()
  }

  function computeExecuteAtISO(day: number, timeStr: string): string | null {
    const base = String(planStartDate || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null
    const time = String(timeStr || '').trim()
    const m = /^(\d{2}):(\d{2})$/.exec(time)
    if (!m) return null
    const hh = Number(m[1])
    const mm = Number(m[2])
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
    const d = new Date(`${base}T00:00:00`)
    if (Number.isNaN(d.getTime())) return null
    d.setDate(d.getDate() + Math.max(0, day - 1))
    d.setHours(hh, mm, 0, 0)
    return d.toISOString()
  }

  async function generatePlan() {
    if (!client) return
    setPlanRunSeq((v) => v + 1)
    setPlanLoading(true)
    setPlanError(null)
    setPlanScheduleError(null)
    setPlanItems(null)
    try {
      const res = await aiContentPlan({ client_id: client.id, horizon_days: planDays, platforms: [planPlatform] })
      const items = (res.items ?? []).slice(0, planDays)
      setPlanItems(items)
      toast.push({ kind: 'success', title: 'Content plan siap' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal bikin content plan'
      setPlanError(msg)
      toast.push({ kind: 'error', title: 'Content plan', message: msg })
    } finally {
      setPlanLoading(false)
    }
  }

  async function createScheduledPostsFromPlan() {
    if (!client) return
    if (!planItems || planItems.length === 0) return
    setPlanScheduling(true)
    setPlanScheduleError(null)
    try {
      for (const it of planItems) {
        const platform = String(it.platform || '').toLowerCase().trim()
        if (platform === 'instagram') {
          throw new Error('Instagram butuh media. Pilih platform facebook/x/tiktok untuk auto-schedule.')
        }
        const executeAt = computeExecuteAtISO(it.day, (it.time ?? planStartTime) || planStartTime)
        if (!executeAt) throw new Error('Start date/time tidak valid')
        const content = buildPostContentFromPlanItem(it)
        if (!content) throw new Error('Plan item kosong')
        const created = await createPost({ client_id: client.id, content, platforms: [platform] })
        await schedulePost(created.id, executeAt)
      }
      toast.push({ kind: 'success', title: 'Posts terjadwal', message: `Total ${planItems.length} post` })
      onDidMutate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal schedule posts'
      setPlanScheduleError(msg)
      toast.push({ kind: 'error', title: 'Schedule posts', message: msg })
    } finally {
      setPlanScheduling(false)
    }
  }

  return (
    <div
      className="dash-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Client Intelligence"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dash-modal" role="document" style={{ width: 1100, maxWidth: '100%' }}>
        <div className="dash-modal-head">
          <div>
            <div className="dash-modal-title">Client Intelligence</div>
            <div className="dash-modal-sub">{client?.name ?? '-'}</div>
          </div>
          <div className="dash-actions">
            <button type="button" className="dash-small-btn" onClick={() => void downloadPDF()} disabled={!client || pdfLoading}>
              {pdfLoading ? 'Menyiapkan PDF...' : 'Download PDF'}
            </button>
            <button type="button" className="dash-modal-close" onClick={onClose}>
              Tutup
            </button>
          </div>
        </div>

        <div className="dash-modal-body">
          {!client ? (
            <DashNotice title="Client tidak ditemukan" detail="Tutup modal lalu coba lagi." />
          ) : (
            <div className="dash-lab-wrap">
              {pdfError ? <DashNotice {...prettyErrorMessage(pdfError)} /> : null}
              <div className="dash-lab-tabs" role="tablist" aria-label="Client Intelligence Tabs">
                <button
                  type="button"
                  className={tab === 'profile' ? 'dash-lab-tab active' : 'dash-lab-tab'}
                  onClick={() => setTab('profile')}
                >
                  Brand Profile
                </button>
                <button
                  type="button"
                  className={tab === 'competitor' ? 'dash-lab-tab active' : 'dash-lab-tab'}
                  onClick={() => setTab('competitor')}
                >
                  Competitor Insight
                </button>
                <button
                  type="button"
                  className={tab === 'offline' ? 'dash-lab-tab active' : 'dash-lab-tab'}
                  onClick={() => setTab('offline')}
                >
                  Offline Campaign
                </button>
              </div>

              {tab === 'profile' ? (
                <div className="dash-lab-panel">
                  <div className="dash-lab-grid">
                    <label className="field">
                      <span>Report Brand Name</span>
                      <input value={reportBrandName} onChange={(e) => setReportBrandName(e.target.value)} placeholder="Nama brand di report" />
                    </label>
                    <label className="field">
                      <span>Industry</span>
                      <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Contoh: Kecantikan" />
                    </label>
                    <label className="field">
                      <span>Location</span>
                      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Contoh: Jakarta" />
                    </label>
                  </div>
                  {profileError ? <DashNotice {...prettyErrorMessage(profileError)} /> : null}
                  <div className="dash-actions">
                    <button
                      type="button"
                      className="dash-small-btn"
                      disabled={savingProfile}
                      onClick={async () => {
                        setSavingProfile(true)
                        setProfileError(null)
                        try {
                          await updateClient(client.id, {
                            report_brand_name: reportBrandName.trim() || undefined,
                            industry: industry.trim() || undefined,
                            location: location.trim() || undefined,
                          })
                          toast.push({ kind: 'success', title: 'Client diupdate' })
                          onDidMutate()
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : 'Gagal update client'
                          setProfileError(msg)
                          toast.push({ kind: 'error', title: 'Gagal update client', message: msg })
                        } finally {
                          setSavingProfile(false)
                        }
                      }}
                    >
                      {savingProfile ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === 'competitor' ? (
                <div className="dash-lab-panel">
                  {!industry.trim() ? (
                    <DashNotice title="Industry belum diisi" detail="Isi Brand Profile dulu, lalu generate Competitor Insight." />
                  ) : null}
                  {compError ? <DashNotice {...prettyErrorMessage(compError)} /> : null}
                  <div className="dash-actions">
                    <button
                      type="button"
                      className="dash-small-btn"
                      disabled={compLoading || !industry.trim()}
                      onClick={async () => {
                        setCompRunSeq((v) => v + 1)
                        setCompLoading(true)
                        setCompError(null)
                        setCompResult(null)
                        try {
                          const data = await competitorAnalyze({ client_id: client.id })
                          setCompResult(data)
                          toast.push({ kind: 'success', title: 'Competitor Insight siap' })
                          onDidMutate()
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : 'Gagal generate competitor insight'
                          setCompError(msg)
                          toast.push({ kind: 'error', title: 'Competitor Insight', message: msg })
                        } finally {
                          setCompLoading(false)
                        }
                      }}
                    >
                      {compLoading ? 'Analyzing...' : 'Generate'}
                    </button>
                  </div>

                  {compLoading || compResult || compError ? (
                    <TerminalPanel
                      seq={compRunSeq}
                      title="COMPETITOR INTELLIGENCE"
                      running={compLoading}
                      error={compError}
                      data={compResult}
                      context={{
                        clientName: client.name,
                        industry: industry.trim() || '-',
                        location: location.trim() || '-',
                        mode: 'competitor',
                      }}
                    />
                  ) : null}

                  <div className="dash-form-card" style={{ marginTop: 12 }}>
                    <div className="dash-segment-title">Convert to Plan</div>
                    {planError ? <DashNotice {...prettyErrorMessage(planError)} /> : null}
                    {planScheduleError ? <DashNotice {...prettyErrorMessage(planScheduleError)} /> : null}
                    <div className="dash-actions" style={{ alignItems: 'end' }}>
                      <label className="field" style={{ minWidth: 160 }}>
                        <span>Horizon</span>
                        <select value={String(planDays)} onChange={(e) => setPlanDays(Number(e.target.value))}>
                          <option value="7">7 hari</option>
                          <option value="14">14 hari</option>
                        </select>
                      </label>
                      <label className="field" style={{ minWidth: 170 }}>
                        <span>Platform</span>
                        <select
                          value={planPlatform}
                          onChange={(e) => {
                            const v = e.target.value
                            if (v === 'facebook' || v === 'x' || v === 'tiktok') setPlanPlatform(v)
                          }}
                        >
                          <option value="facebook">facebook</option>
                          <option value="x">x</option>
                          <option value="tiktok">tiktok</option>
                        </select>
                      </label>
                      <label className="field" style={{ minWidth: 160 }}>
                        <span>Start Date</span>
                        <input type="date" value={planStartDate} onChange={(e) => setPlanStartDate(e.target.value)} />
                      </label>
                      <label className="field" style={{ minWidth: 140 }}>
                        <span>Start Time</span>
                        <input type="time" value={planStartTime} onChange={(e) => setPlanStartTime(e.target.value)} />
                      </label>
                      <button
                        type="button"
                        className="dash-small-btn"
                        disabled={planLoading || !industry.trim()}
                        onClick={() => void generatePlan()}
                      >
                        {planLoading ? 'Generating...' : 'Generate Plan'}
                      </button>
                      <button
                        type="button"
                        className="dash-small-btn"
                        disabled={planScheduling || !planItems || planItems.length === 0}
                        onClick={() => void createScheduledPostsFromPlan()}
                      >
                        {planScheduling ? 'Scheduling...' : 'Create & Schedule'}
                      </button>
                    </div>

                    {planLoading || planItems || planError ? (
                      <TerminalPanel
                        seq={planRunSeq}
                        title="CONTENT PLAN"
                        running={planLoading}
                        error={planError}
                        data={planItems ? { items: planItems } : null}
                        context={{
                          clientName: client.name,
                          industry: industry.trim() || '-',
                          location: location.trim() || '-',
                          mode: 'plan',
                        }}
                      />
                    ) : null}

                    {planItems && planItems.length ? (
                      <div className="dash-mini-list" style={{ marginTop: 10 }}>
                        {planItems.map((it) => (
                          <div key={`${it.day}-${it.platform}`} className="dash-mini-item">
                            <div className="dash-mini-name">
                              Day {String(it.day)} · {String(it.platform)} · {String(it.time ?? planStartTime)}
                            </div>
                            <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                              {it.title}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {tab === 'offline' ? (
                <div className="dash-lab-panel">
                  <div className="dash-lab-grid">
                    <label className="field">
                      <span>File</span>
                      <input
                        type="file"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null
                          setOfflineFile(f)
                        }}
                      />
                    </label>
                  </div>
                  {offlineError ? <DashNotice {...prettyErrorMessage(offlineError)} /> : null}
                  <div className="dash-actions">
                    <button
                      type="button"
                      className="dash-small-btn"
                      disabled={offlineLoading || !offlineFile}
                      onClick={async () => {
                        if (!offlineFile) return
                        setOfflineRunSeq((v) => v + 1)
                        setOfflineLoading(true)
                        setOfflineError(null)
                        setOfflineResult(null)
                        try {
                          const res = await createOfflineCampaign({ client_id: client.id, file: offlineFile })
                          setOfflineResult(res.data)
                          toast.push({ kind: 'success', title: 'Offline campaign extracted' })
                          onDidMutate()
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : 'Gagal extract offline campaign'
                          setOfflineError(msg)
                          toast.push({ kind: 'error', title: 'Offline Campaign', message: msg })
                        } finally {
                          setOfflineLoading(false)
                        }
                      }}
                    >
                      {offlineLoading ? 'Extracting...' : 'Extract'}
                    </button>
                  </div>

                  {offlineLoading || offlineResult || offlineError ? (
                    <TerminalPanel
                      seq={offlineRunSeq}
                      title="OFFLINE CAMPAIGN PARSER"
                      running={offlineLoading}
                      error={offlineError}
                      data={offlineResult}
                      context={{
                        clientName: client.name,
                        industry: industry.trim() || '-',
                        location: location.trim() || '-',
                        mode: 'offline',
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ClientsTable({
  clients,
  isLoading,
  error,
  limit,
  onOpenIntel,
  onConnectInstagram,
}: {
  clients: Client[]
  isLoading: boolean
  error: string | null
  limit?: number
  onOpenIntel: (clientId: string) => void
  onConnectInstagram?: (clientId: string) => Promise<void>
}) {
  if (isLoading) {
    return (
      <div className="dash-skeleton-list" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="dash-skeleton-row">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        ))}
      </div>
    )
  }
  if (error) return <div className="error">{error}</div>

  const rows = typeof limit === 'number' ? clients.slice(0, Math.max(0, limit)) : clients

  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Industry</th>
            <th>Platforms</th>
            <th>Connected</th>
            {onConnectInstagram ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={onConnectInstagram ? 4 : 3} className="dash-td-muted">
                <div className="dash-empty">
                  <div className="dash-empty-illus" aria-hidden="true" />
                  <div className="dash-empty-title">Belum ada client</div>
                  <div className="dash-empty-meta">Tambahkan client pertama untuk mulai connect akun social & generate report.</div>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((c) => {
              const platforms = (c.social_accounts ?? []).map((s) => s.platform)
              const connected = (c.social_accounts ?? []).filter((s) => Boolean(s.connected_at)).length
              return (
                <tr key={c.id}>
                  <td className="dash-td-strong">{c.name}</td>
                  <td>{c.industry ? c.industry : '-'}</td>
                  <td>{platforms.length ? platforms.join(', ') : '-'}</td>
                  <td>{String(connected)}</td>
                  {onConnectInstagram ? (
                    <td>
                      <div className="dash-actions">
                        <button type="button" className="dash-small-btn" onClick={() => void onConnectInstagram(c.id)}>
                          Connect IG
                        </button>
                        <button
                          type="button"
                          className="dash-small-btn"
                          onClick={() => {
                            onOpenIntel(c.id)
                          }}
                        >
                          Intelligence
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })
          )}
        </tbody>
      </table>

    </div>
  )
}

function CreateClientForm({
  onCreate,
}: {
  onCreate: (input: { name: string; logo_url?: string; report_brand_name?: string; industry?: string; location?: string }) => Promise<void>
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [logoURL, setLogoURL] = useState('')
  const [reportBrandName, setReportBrandName] = useState('')
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        logo_url: logoURL.trim() || undefined,
        report_brand_name: reportBrandName.trim() || undefined,
        industry: industry.trim() || undefined,
        location: location.trim() || undefined,
      })
      setName('')
      setLogoURL('')
      setReportBrandName('')
      setIndustry('')
      setLocation('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal buat client'
      setError(msg)
      toast.push({ kind: 'error', title: 'Gagal buat client', message: msg })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dash-form-card">
      <div className="dash-segment-title">Add Client</div>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama client" required />
        </label>
        <label className="field">
          <span>Logo URL</span>
          <input
            value={logoURL}
            onChange={(e) => setLogoURL(e.target.value)}
            placeholder="https://..."
            inputMode="url"
          />
        </label>
        <label className="field">
          <span>Report Brand Name</span>
          <input
            value={reportBrandName}
            onChange={(e) => setReportBrandName(e.target.value)}
            placeholder="Nama brand di report"
          />
        </label>
        <label className="field">
          <span>Industry</span>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Contoh: Kecantikan" />
        </label>
        <label className="field">
          <span>Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Contoh: Jakarta" />
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Create'}
        </button>
      </form>
    </div>
  )
}

function PostsPanel({
  clients,
  isClientsLoading,
  clientsError,
  posts,
  isPostsLoading,
  postsError,
  onReloadPosts,
  onDidMutate,
}: {
  clients: Client[]
  isClientsLoading: boolean
  clientsError: string | null
  posts: Post[]
  isPostsLoading: boolean
  postsError: string | null
  onReloadPosts: () => Promise<void>
  onDidMutate: () => void
}) {
  const toast = useToast()
  const [clientId, setClientId] = useState('')
  const [platforms, setPlatforms] = useState<Array<'instagram' | 'facebook' | 'tiktok' | 'x'>>(['instagram'])
  const [content, setContent] = useState('')
  const [mediaURLsText, setMediaURLsText] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [idea, setIdea] = useState('')
  const [tone, setTone] = useState<'friendly' | 'professional' | 'funny' | 'sales'>('friendly')
  const [aiPlatform, setAIPlatform] = useState<'instagram' | 'facebook' | 'tiktok' | 'x'>('instagram')
  const [isAIGenerating, setIsAIGenerating] = useState(false)
  const [aiError, setAIError] = useState<string | null>(null)
  const [variants, setVariants] = useState<string[]>([])

  const effectiveClientId = clientId || clients[0]?.id || ''

  function togglePlatform(p: 'instagram' | 'facebook' | 'tiktok' | 'x') {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  async function generateAI() {
    const contentIdea = (idea || content).trim()
    if (!contentIdea) {
      setAIError('Isi content idea dulu')
      return
    }
    setIsAIGenerating(true)
    setAIError(null)
    setVariants([])
    try {
      const res = await aiCaption({ content_idea: contentIdea, platform: aiPlatform, tone })
      setVariants(res.variants ?? [])
      toast.push({ kind: 'success', title: 'AI Caption siap' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate caption'
      setAIError(msg)
      toast.push({ kind: 'error', title: 'Gagal generate caption', message: msg })
    } finally {
      setIsAIGenerating(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!effectiveClientId) return

    const trimmedContent = content.trim()
    if (!trimmedContent) {
      setSubmitError('Content wajib diisi')
      return
    }
    if (platforms.length === 0) {
      setSubmitError('Pilih minimal 1 platform')
      return
    }

    const mediaURLs = mediaURLsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    if (platforms.includes('instagram') && mediaURLs.length === 0) {
      setSubmitError('Instagram butuh minimal 1 media URL')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const created = await createPost({
        client_id: effectiveClientId,
        content: trimmedContent,
        platforms,
        media_urls: mediaURLs.length ? mediaURLs : undefined,
      })

      if (scheduleAt) {
        const iso = new Date(scheduleAt).toISOString()
        await schedulePost(created.id, iso)
      }

      toast.push({ kind: 'success', title: 'Post dibuat' })
      setContent('')
      setMediaURLsText('')
      setScheduleAt('')
      onDidMutate()
      await onReloadPosts()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal create post'
      setSubmitError(msg)
      toast.push({ kind: 'error', title: 'Gagal create post', message: msg })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dash-stack">
      <div className="dash-form-card">
        <div className="dash-segment-title">Create Post</div>
        {isClientsLoading ? <div className="muted">Loading clients...</div> : null}
        {clientsError ? <div className="error">{clientsError}</div> : null}
        {submitError ? <div className="error">{submitError}</div> : null}
        <form className="form" onSubmit={submit} style={{ gap: 10 }}>
          <label className="field">
            <span>Client</span>
            <select value={effectiveClientId} onChange={(e) => setClientId(e.target.value)} disabled={clients.length === 0}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Platforms</span>
            <div className="dash-actions">
              {(['instagram', 'facebook', 'tiktok', 'x'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="dash-small-btn"
                  onClick={() => togglePlatform(p)}
                  style={{
                    opacity: platforms.includes(p) ? 1 : 0.5,
                    borderColor: platforms.includes(p) ? 'var(--accent-border)' : 'var(--dash-border)',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Content</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="Tulis caption"
            />
          </label>

          <label className="field">
            <span>Media URLs (1 per baris)</span>
            <textarea
              value={mediaURLsText}
              onChange={(e) => setMediaURLsText(e.target.value)}
              rows={3}
              placeholder="https://..."
            />
          </label>

          <label className="field">
            <span>Schedule (opsional)</span>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </label>

          <button type="submit" disabled={isSubmitting || !effectiveClientId}>
            {isSubmitting ? 'Saving...' : 'Create'}
          </button>
        </form>
      </div>

      <div className="dash-form-card">
        <div className="dash-segment-title">AI Caption</div>
        {aiError ? <div className="error">{aiError}</div> : null}
        <div className="form" style={{ gap: 10 }}>
          <label className="field">
            <span>Content Idea</span>
            <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Ide konten" />
          </label>
          <div className="dash-actions">
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              <span>Platform</span>
              <select
                value={aiPlatform}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'instagram' || v === 'facebook' || v === 'tiktok' || v === 'x') setAIPlatform(v)
                }}
              >
                <option value="instagram">instagram</option>
                <option value="facebook">facebook</option>
                <option value="tiktok">tiktok</option>
                <option value="x">x</option>
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              <span>Tone</span>
              <select
                value={tone}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'friendly' || v === 'professional' || v === 'funny' || v === 'sales') setTone(v)
                }}
              >
                <option value="friendly">friendly</option>
                <option value="professional">professional</option>
                <option value="funny">funny</option>
                <option value="sales">sales</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={() => void generateAI()} disabled={isAIGenerating}>
            {isAIGenerating ? 'Generating...' : 'Generate'}
          </button>

          {variants.length ? (
            <div className="dash-mini-list" style={{ marginTop: 6 }}>
              {variants.map((v, i) => (
                <div key={i} className="dash-mini-item" style={{ display: 'grid', gap: 8 }}>
                  <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                    {v}
                  </div>
                  <div className="dash-actions">
                    <button
                      type="button"
                      className="dash-small-btn"
                      onClick={() => {
                        setContent(v)
                        toast.push({ kind: 'success', title: 'Dipakai', message: 'Caption dimasukkan ke Content' })
                      }}
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      className="dash-small-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(v)
                          toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                        } catch {
                          toast.push({ kind: 'error', title: 'Gagal copy', message: 'Copy manual dari teks' })
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="dash-form-card">
        <div className="dash-segment-title">
          Posts <span className="dash-badge">{String(posts.length)}</span>
        </div>
        <div className="dash-actions" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="dash-small-btn"
            onClick={() => {
              void onReloadPosts()
            }}
            disabled={isPostsLoading}
          >
            {isPostsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {postsError ? <div className="error">{postsError}</div> : null}
        {!isPostsLoading ? (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Execute At</th>
                  <th>Platforms</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="dash-td-muted">
                      Belum ada post
                    </td>
                  </tr>
                ) : (
                  posts.slice(0, 20).map((p) => (
                    <tr key={p.id}>
                      <td className="dash-td-strong">{p.client_name}</td>
                      <td>{p.status}</td>
                      <td>{p.execute_at ? new Date(p.execute_at).toLocaleString('id-ID') : '-'}</td>
                      <td>{p.platforms.join(', ')}</td>
                      <td>
                        <div className="dash-actions">
                          <button
                            type="button"
                            className="dash-small-btn"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(p.content)
                                toast.push({ kind: 'success', title: 'Copied', message: 'Content disalin' })
                              } catch {
                                toast.push({ kind: 'error', title: 'Gagal copy', message: 'Copy manual dari teks' })
                              }
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="dash-small-btn"
                            disabled={p.status === 'queued' || p.status === 'published'}
                            onClick={async () => {
                              try {
                                await publishNow(p.id)
                                toast.push({ kind: 'success', title: 'Queued', message: 'Publish dimasukkan ke queue' })
                                onDidMutate()
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : 'Gagal publish'
                                toast.push({ kind: 'error', title: 'Gagal publish', message: msg })
                              }
                            }}
                          >
                            Publish Now
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Loading posts...</div>
        )}
      </div>
    </div>
  )
}

function AnalyticsPanel({ refreshSeq }: { refreshSeq: number }) {
  return (
    <div className="dash-stack">
      <AnalyticsSummaryCard refreshSeq={refreshSeq} />
    </div>
  )
}

function ReportsPanel({
  clients,
  isLoading,
  error,
  onDidMutate,
}: {
  clients: Client[]
  isLoading: boolean
  error: string | null
  onDidMutate: () => void
}) {
  const toast = useToast()
  const [clientId, setClientId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)
  const [magicLinkURL, setMagicLinkURL] = useState<string | null>(null)
  const [downloadURL, setDownloadURL] = useState<string | null>(null)

  const apiTarget = import.meta.env.VITE_API_TARGET || 'http://localhost:8080'
  const effectiveClientId = clientId || clients[0]?.id || ''

  async function generate() {
    if (!effectiveClientId) return
    setIsGenerating(true)
    setGenError(null)
    setToken(null)
    setMagicLink(null)
    setMagicLinkURL(null)
    setDownloadURL(null)
    try {
      const res = await createReport(effectiveClientId, {
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
      })
      setToken(res.token)
      setMagicLink(res.magic_link)
      const url = res.magic_link_url ? res.magic_link_url : `${apiTarget}${res.magic_link}`
      setMagicLinkURL(res.magic_link_url ? res.magic_link_url : `${apiTarget}${res.magic_link}`)
      setDownloadURL(res.download_url ? res.download_url : `${apiTarget}/r/${res.token}/download`)
      toast.push({ kind: 'success', title: 'Report dibuat', message: 'Magic link siap dibuka' })
      window.open(url, '_blank', 'noopener,noreferrer')
      onDidMutate()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Gagal generate report')
      toast.push({ kind: 'error', title: 'Gagal generate report', message: err instanceof Error ? err.message : '' })
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="dash-stack">
      <div className="dash-form-card">
        <div className="dash-segment-title">Generate Report PDF</div>
        {isLoading ? <div className="muted">Loading clients...</div> : null}
        {error ? <div className="error">{error}</div> : null}
        {!isLoading && !error && clients.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty-illus" aria-hidden="true" />
            <div className="dash-empty-title">Belum ada client</div>
            <div className="dash-empty-meta">Buat client dulu, lalu generate report.</div>
          </div>
        ) : null}
        {!isLoading && !error && clients.length > 0 ? (
          <div className="form" style={{ gap: 10 }}>
            <label className="field">
              <span>Client</span>
              <select value={effectiveClientId} onChange={(e) => setClientId(e.target.value)}>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="dash-actions">
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                <span>Start Date</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                <span>End Date</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
            {genError ? <div className="error">{genError}</div> : null}
            <button type="button" onClick={() => void generate()} disabled={!effectiveClientId || isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate & Open'}
            </button>
            {token && magicLink ? (
              <div className="dash-placeholder-item">
                <div className="dash-placeholder-title">Magic Link</div>
                <div className="dash-placeholder-meta">
                  <a href={magicLinkURL ?? `${apiTarget}${magicLink}`} target="_blank" rel="noreferrer">
                    {magicLinkURL ?? `${apiTarget}${magicLink}`}
                  </a>
                </div>
                <div className="dash-actions">
                  <button
                    type="button"
                    className="dash-small-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(magicLinkURL ?? `${apiTarget}${magicLink}`)
                        toast.push({ kind: 'success', title: 'Copied', message: 'Magic link disalin' })
                      } catch {
                        toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual dari link' })
                      }
                    }}
                  >
                    Copy Link
                  </button>
                  <a className="dash-small-btn" href={downloadURL ?? `${apiTarget}/r/${token}/download`} target="_blank" rel="noreferrer">
                    Download PDF
                  </a>
                </div>
                <div className="dash-placeholder-meta" style={{ marginTop: 8 }}>
                  Bisa di-bookmark di HP dan dishare ke client.
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function OnboardingPanel({ onGoClients }: { onGoClients: () => void }) {
  return (
    <div className="dash-onboard">
      <div className="dash-onboard-hero">
        <div className="dash-onboard-orb" aria-hidden="true" />
        <div className="dash-onboard-title">Find the Trend</div>
        <div className="dash-onboard-sub">Build · Schedule · Analyze · Report</div>
      </div>
      <FlowDiagram clientsCount={0} connectedAccounts={0} scheduledPosts={0} />
      <div className="dash-form-card">
        <div className="dash-segment-title">Intelligence Setup</div>
        <div className="muted">Buat client dulu (isi Industry), baru Competitor Insight & Offline Campaign bisa jalan.</div>
        <div className="dash-actions" style={{ marginTop: 10 }}>
          <button type="button" className="dash-small-btn" onClick={onGoClients}>
            Create Client
          </button>
        </div>
      </div>
    </div>
  )
}

function ClientIntelQuickPanel({
  clients,
  isLoading,
  error,
  onOpenIntel,
}: {
  clients: Client[]
  isLoading: boolean
  error: string | null
  onOpenIntel: (clientId: string, tab: 'profile' | 'competitor' | 'offline', autoGenerate: boolean) => void
}) {
  const [clientId, setClientId] = useState('')
  const effectiveClientId = clientId || clients[0]?.id || ''
  const client = useMemo(() => clients.find((c) => c.id === effectiveClientId) ?? null, [clients, effectiveClientId])

  const hasIndustry = Boolean((client?.industry ?? '').trim())

  return (
    <div className="dash-form-card">
      <div className="dash-segment-title">Client Intelligence</div>
      {isLoading ? <div className="muted">Sinkron...</div> : null}
      {!isLoading && error ? <DashNotice {...prettyErrorMessage(error)} /> : null}
      {!isLoading && !error && clients.length === 0 ? <div className="muted">Belum ada client. Buat dulu, lalu generate competitor insight & offline campaign.</div> : null}
      {!isLoading && !error && clients.length > 0 ? (
        <div className="dash-actions" style={{ alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 260, flex: 1 }}>
            <span>Client</span>
            <select value={effectiveClientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="dash-small-btn"
            disabled={!client}
            onClick={() => {
              if (!client) return
              if (!hasIndustry) {
                onOpenIntel(client.id, 'profile', false)
                return
              }
              onOpenIntel(client.id, 'competitor', true)
            }}
          >
            {hasIndustry ? 'Competitor Scan' : 'Set Industry'}
          </button>
          <button
            type="button"
            className="dash-small-btn"
            disabled={!client}
            onClick={() => {
              if (!client) return
              onOpenIntel(client.id, 'offline', false)
            }}
          >
            Offline Campaign
          </button>
          <button
            type="button"
            className="dash-small-btn"
            disabled={!client}
            onClick={() => {
              if (!client) return
              onOpenIntel(client.id, 'profile', false)
            }}
          >
            Profile
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="dash-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Tentang & panduan"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dash-modal" role="document">
        <div className="dash-modal-head">
          <div>
            <div className="dash-modal-title">Tentang & panduan</div>
            <div className="dash-modal-sub">Flow singkat biar client kamu tinggal pakai.</div>
          </div>
          <button type="button" className="dash-modal-close" onClick={onClose}>
            Tutup
          </button>
        </div>

        <div className="dash-modal-body">
          <div className="dash-guide-grid">
            <div className="dash-guide-card">
              <div className="dash-guide-title">1) Tambah client</div>
              <div className="dash-guide-meta">Masuk Clients → isi Name → Create.</div>
            </div>
            <div className="dash-guide-card">
              <div className="dash-guide-title">2) Connect Instagram</div>
              <div className="dash-guide-meta">Clients → Connect IG → login Meta/IG → kembali ke dashboard.</div>
            </div>
            <div className="dash-guide-card">
              <div className="dash-guide-title">3) Generate report</div>
              <div className="dash-guide-meta">Reports → pilih client → Generate & Open.</div>
            </div>
            <div className="dash-guide-card">
              <div className="dash-guide-title">4) Share magic link</div>
              <div className="dash-guide-meta">Klik Copy Link → kirim ke client. Link bisa dibuka tanpa login.</div>
            </div>
          </div>

          <div className="dash-guide-note">
            Kalau login kelempar lagi ke halaman login: token expired/unauthorized → login ulang.
          </div>
        </div>
      </div>
    </div>
  )
}
