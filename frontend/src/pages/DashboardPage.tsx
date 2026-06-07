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
  aiHashtags,
  aiContentPlan,
  aiTrendPlan,
  clientTimeline,
  connectAccount,
  competitorAnalyze,
  createClient,
  createOfflineCampaign,
  createPost,
  createReport,
  explodingTopics,
  googleTrendsTrending,
  listCalendarPosts,
  listClients,
  listPosts,
  listReports,
  publishNow,
  schedulePost,
  similarwebTraffic,
  updateAgency,
  uploadAgencyLogo,
  updateClient,
  type CalendarEvent,
  type Client,
  type ContentPlanItem,
  type ClientTimelineEvent,
  type ExplodingTopicsResponse,
  type GoogleTrendsResponse,
  type SimilarwebTrafficResponse,
  type Post,
  type ReportListItem,
} from '../lib/api'
import { clearAuth, useAuthStore } from '../lib/auth'
import { useToast } from '../lib/toast'

import { Calendar as BigCalendar, dateFnsLocalizer, type Event } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { endOfMonth, endOfWeek, format, getDay, parse, startOfMonth, startOfWeek } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

type NavKey = 'Dashboard' | 'Clients' | 'Posts' | 'Calendar' | 'Analytics' | 'Reports' | 'Settings'

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
  if (k === 'Settings') {
    return (
      <svg {...common}>
        <path
          {...stroke}
          d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        />
        <path
          {...stroke}
          d="M19.4 15a7.9 7.9 0 0 0 .1-1l1.6-1.2-1.6-2.8-1.9.6a7.7 7.7 0 0 0-1.7-1l-.3-2h-3.2l-.3 2a7.7 7.7 0 0 0-1.7 1l-1.9-.6-1.6 2.8L4.5 14a7.9 7.9 0 0 0 .1 1 7.9 7.9 0 0 0-.1 1L3 17.2 4.6 20l1.9-.6c.5.4 1.1.7 1.7 1l.3 2h3.2l.3-2c.6-.3 1.2-.6 1.7-1l1.9.6 1.6-2.8-1.6-1.2c.1-.3.1-.7.1-1Z"
        />
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
  { key: 'Settings', label: 'Settings' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const user = useAuthStore((s) => s.user)
  const agency = useAuthStore((s) => s.agency)
  const [brandLogoOK, setBrandLogoOK] = useState(true)
  const [activeNav, setActiveNav] = useState<NavKey>('Dashboard')
  const [moduleFX, setModuleFX] = useState<{ key: NavKey; title: string; hint: string; seq: number } | null>(null)
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
      Settings: { title: 'SETTINGS', hint: 'Loading workspace config…' },
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
  const brandLogoSrc = (agency?.logo_url ?? '').trim() || '/trendspire-logo.png'

  useEffect(() => {
    setBrandLogoOK(true)
  }, [brandLogoSrc])

  return (
    <div className="dash-page">
      <div className="dash-shell" data-nav={activeNav}>
        <ModuleFXOverlay fx={moduleFX} />
        <div className="dash-header">
          <div className="dash-header-left">
            <div className="dash-brand">
              <div className="dash-logo" aria-hidden="true">
                {brandLogoOK ? (
                  <img
                    key={brandLogoSrc}
                    src={brandLogoSrc}
                    alt=""
                    draggable={false}
                    onLoad={() => {
                      setBrandLogoOK(true)
                    }}
                    onError={() => {
                      setBrandLogoOK(false)
                    }}
                  />
                ) : (
                  'TS'
                )}
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

          <section className="dash-card dash-topmid">
            <div className="dash-metrics">
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
            </div>
            <ClientGrowthSmartCard clients={clients} isLoading={isLoading} error={error} />
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
            <div className="dash-card-body dash-card-body-scroll">
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
                  onConnectTikTok={async (clientId) => {
                    try {
                      const res = await connectAccount('tiktok', clientId)
                      toast.push({ kind: 'info', title: 'Redirect OAuth', message: 'Membuka halaman connect TikTok' })
                      window.location.href = res.auth_url
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Gagal connect TikTok'
                      toast.push({ kind: 'error', title: 'Gagal connect TikTok', message: msg })
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
                <AnalyticsPanel clients={clients} isLoading={isLoading} error={error} />
              ) : activeNav === 'Reports' ? (
                <ReportsPanel
                  clients={clients}
                  isLoading={isLoading}
                  error={error}
                  onDidMutate={() => {
                    bumpRefresh()
                  }}
                />
              ) : activeNav === 'Settings' ? (
                <SettingsPanel
                  agency={agency}
                  userRole={user?.role ?? ''}
                  theme={theme}
                  onThemeChange={setTheme}
                  onSaved={(nextAgency) => {
                    const st = useAuthStore.getState()
                    const accessToken = st.accessToken
                    const refreshToken = st.refreshToken
                    const u = st.user
                    if (!accessToken || !refreshToken || !u) return
                    st.setSession({
                      accessToken,
                      refreshToken,
                      user: u,
                      agency: { ...((st.agency ?? { id: nextAgency.id, name: nextAgency.name }) as any), ...nextAgency },
                    })
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
            </div>
          </section>

          <section className="dash-card dash-donut">
            <div className="dash-card-head">
              <div className="dash-card-title">Upcoming Posts</div>
            </div>
            <UpcomingPostsCard refreshSeq={refreshSeq} onOpenCalendar={() => activateNav('Calendar')} />
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
        {intelOpen ? (
          <ClientIntelModal
            client={intelClient}
            initialTab={intelInitialTab}
            autoGenerate={intelAutoGenerate}
            onClose={() => setIntelOpen(false)}
            onDidMutate={() => {
              void reloadClients()
              void reloadPosts()
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
      Settings: [`${pulse} · WORKSPACE`, 'BRAND IDENTITY', 'ACCESS CONTROL'],
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
      Settings: 'WORKSPACE CONFIG',
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

function TrendRadarPanel({ clients }: { clients: Client[] }) {
  const toast = useToast()
  const [source, setSource] = useState<'google' | 'exploding' | 'similarweb'>('google')

  const [geo, setGeo] = useState('ID')
  const [explodingCategory, setExplodingCategory] = useState('marketing')
  const [explodingType, setExplodingType] = useState<'all' | 'regular' | 'exploding' | 'peaked'>('exploding')
  const [domain, setDomain] = useState('chatgpt.com')
  const [country, setCountry] = useState('us')

  const [googleData, setGoogleData] = useState<GoogleTrendsResponse | null>(null)
  const [explodingData, setExplodingData] = useState<ExplodingTopicsResponse | null>(null)
  const [similarwebData, setSimilarwebData] = useState<SimilarwebTrafficResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)

  const [captionPlatform, setCaptionPlatform] = useState<'facebook' | 'x' | 'tiktok'>('tiktok')
  const [captionTone, setCaptionTone] = useState<'smart' | 'hype' | 'luxury'>('smart')
  const [captionOpen, setCaptionOpen] = useState<string | null>(null)
  const [captionLoading, setCaptionLoading] = useState(false)
  const [captionError, setCaptionError] = useState<string | null>(null)
  const [captionVariants, setCaptionVariants] = useState<string[] | null>(null)
  const [hashtagsLoading, setHashtagsLoading] = useState(false)
  const [hashtagsError, setHashtagsError] = useState<string | null>(null)
  const [hashtags, setHashtags] = useState<string[] | null>(null)

  const [planDays, setPlanDays] = useState(7)
  const [planClientId, setPlanClientId] = useState('')
  const effectivePlanClientId = planClientId || clients[0]?.id || ''
  const [planOpen, setPlanOpen] = useState<string | null>(null)
  const [planMode, setPlanMode] = useState<'quick' | 'strategic' | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planItems, setPlanItems] = useState<ContentPlanItem[] | null>(null)

  const [watch, setWatch] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('trendspire.watchlist.trends')
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string').slice(0, 50)
      return []
    } catch {
      return []
    }
  })

  function setWatchPersist(next: string[]) {
    const out = Array.from(new Set(next.map((s) => String(s || '').trim()).filter(Boolean))).slice(0, 50)
    setWatch(out)
    try {
      localStorage.setItem('trendspire.watchlist.trends', JSON.stringify(out))
    } catch {}
  }

  function toggleWatch(keyword: string) {
    const k = String(keyword || '').trim()
    if (!k) return
    if (watch.includes(k)) {
      setWatchPersist(watch.filter((x) => x !== k))
      toast.push({ kind: 'info', title: 'Untracked', message: k })
      return
    }
    setWatchPersist([k, ...watch])
    toast.push({ kind: 'success', title: 'Tracked', message: k })
  }

  async function generateCaptions(keyword: string) {
    const idea = String(keyword || '').trim()
    if (!idea) return
    setCaptionLoading(true)
    setCaptionError(null)
    setHashtags(null)
    setHashtagsError(null)
    setCaptionOpen(idea)
    setCaptionVariants(null)
    try {
      const res = await aiCaption({ content_idea: idea, platform: captionPlatform, tone: captionTone })
      setCaptionVariants(res.variants ?? [])
      if (!res.variants?.length) setCaptionError('Tidak ada output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate caption'
      setCaptionError(msg)
    } finally {
      setCaptionLoading(false)
    }
  }

  async function generateHashtagsFor(caption: string) {
    const cap = String(caption || '').trim()
    const niche = String(captionOpen || '').trim()
    if (!cap || !niche) return
    setHashtagsLoading(true)
    setHashtagsError(null)
    setHashtags(null)
    try {
      const res = await aiHashtags({ caption: cap, niche })
      setHashtags(res.hashtags ?? [])
      if (!res.hashtags?.length) setHashtagsError('Tidak ada output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate hashtags'
      setHashtagsError(msg)
    } finally {
      setHashtagsLoading(false)
    }
  }

  async function generateQuickPlan(keyword: string) {
    const k = String(keyword || '').trim()
    if (!k) return
    setPlanOpen(k)
    setPlanMode('quick')
    setPlanLoading(true)
    setPlanError(null)
    setPlanItems(null)
    try {
      const res = await aiTrendPlan({ keyword: k, horizon_days: planDays, platforms: [captionPlatform], tone: captionTone })
      setPlanItems(res.items ?? [])
      if (!res.items?.length) setPlanError('Tidak ada output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate plan'
      setPlanError(msg)
    } finally {
      setPlanLoading(false)
    }
  }

  async function generateStrategicPlan(keyword: string) {
    const k = String(keyword || '').trim()
    if (!k) return
    if (!effectivePlanClientId) {
      setPlanOpen(k)
      setPlanMode('strategic')
      setPlanError('Pilih client dulu untuk strategic plan')
      setPlanItems(null)
      return
    }
    setPlanOpen(k)
    setPlanMode('strategic')
    setPlanLoading(true)
    setPlanError(null)
    setPlanItems(null)
    try {
      const res = await aiContentPlan({
        client_id: effectivePlanClientId,
        horizon_days: planDays,
        platforms: [captionPlatform],
        seed_keyword: k,
      })
      setPlanItems(res.items ?? [])
      if (!res.items?.length) setPlanError('Tidak ada output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate plan'
      setPlanError(msg)
    } finally {
      setPlanLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        if (source === 'google') {
          const d = await googleTrendsTrending({ geo, limit: 10 })
          if (!cancelled) setGoogleData(d)
        } else if (source === 'exploding') {
          const d = await explodingTopics({
            limit: 10,
            type: explodingType,
            categories: explodingCategory ? [explodingCategory] : undefined,
            sort: 'growth',
            order: 'desc',
            timeframe: 12,
          })
          if (!cancelled) setExplodingData(d)
        } else {
          const d = await similarwebTraffic({ domain, country })
          if (!cancelled) setSimilarwebData(d)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load intel feed'
        if (!cancelled) setError(msg)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [country, domain, explodingCategory, explodingType, geo, seq, source])

  const debugURL =
    source === 'google' ? googleData?.debug_url : source === 'exploding' ? explodingData?.debug_url : similarwebData?.debug_url

  return (
    <div className="dash-form-card dash-trend-card">
      <div className="dash-segment-title">Trend Radar</div>
      <div className="dash-actions" style={{ alignItems: 'end' }}>
        <label className="field" style={{ minWidth: 200 }}>
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value as 'google' | 'exploding' | 'similarweb')}>
            <option value="google">Google Trends</option>
            <option value="exploding">Exploding Topics</option>
            <option value="similarweb">Similarweb</option>
          </select>
        </label>
        {source === 'google' ? (
          <label className="field" style={{ minWidth: 180 }}>
            <span>Geo</span>
            <select value={geo} onChange={(e) => setGeo(e.target.value)}>
              <option value="ID">ID</option>
              <option value="US">US</option>
              <option value="GB">GB</option>
              <option value="SG">SG</option>
              <option value="AU">AU</option>
              <option value="JP">JP</option>
            </select>
          </label>
        ) : source === 'exploding' ? (
          <>
            <label className="field" style={{ minWidth: 220 }}>
              <span>Category</span>
              <select value={explodingCategory} onChange={(e) => setExplodingCategory(e.target.value)}>
                <option value="marketing">marketing</option>
                <option value="ai">ai</option>
                <option value="technology">technology</option>
                <option value="social-media">social-media</option>
                <option value="beauty">beauty</option>
                <option value="health">health</option>
                <option value="finance">finance</option>
                <option value="food-beverage">food-beverage</option>
              </select>
            </label>
            <label className="field" style={{ minWidth: 180 }}>
              <span>Type</span>
              <select value={explodingType} onChange={(e) => setExplodingType(e.target.value as typeof explodingType)}>
                <option value="exploding">exploding</option>
                <option value="regular">regular</option>
                <option value="peaked">peaked</option>
                <option value="all">all</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="field" style={{ minWidth: 240 }}>
              <span>Domain</span>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            </label>
            <label className="field" style={{ minWidth: 120 }}>
              <span>Country</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="ww">ww</option>
                <option value="us">us</option>
                <option value="id">id</option>
                <option value="sg">sg</option>
                <option value="gb">gb</option>
              </select>
            </label>
          </>
        )}
        {clients.length ? (
          <label className="field" style={{ minWidth: 240, flex: 1 }}>
            <span>Client</span>
            <select value={effectivePlanClientId} onChange={(e) => setPlanClientId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field" style={{ minWidth: 120 }}>
          <span>Days</span>
          <select value={String(planDays)} onChange={(e) => setPlanDays(Number(e.target.value) || 7)}>
            <option value="7">7</option>
            <option value="10">10</option>
            <option value="14">14</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 150 }}>
          <span>Platform</span>
          <select value={captionPlatform} onChange={(e) => setCaptionPlatform(e.target.value as typeof captionPlatform)}>
            <option value="tiktok">tiktok</option>
            <option value="facebook">facebook</option>
            <option value="x">x</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 150 }}>
          <span>Tone</span>
          <select value={captionTone} onChange={(e) => setCaptionTone(e.target.value as typeof captionTone)}>
            <option value="smart">smart</option>
            <option value="luxury">luxury</option>
            <option value="hype">hype</option>
          </select>
        </label>
        <button type="button" className="dash-small-btn" disabled={isLoading} onClick={() => setSeq((v) => v + 1)}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
        {debugURL ? (
          <button type="button" className="dash-small-btn" onClick={() => window.open(debugURL, '_blank', 'noopener,noreferrer')}>
            Open Source
          </button>
        ) : null}
      </div>

      {error ? <DashNotice {...prettyErrorMessage(error)} actionLabel="Retry" onAction={() => setSeq((v) => v + 1)} /> : null}

      {isLoading ? (
        <div className="dash-skeleton-list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="dash-skeleton-row">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          ))}
        </div>
      ) : source === 'google' && googleData?.items?.length ? (
        <div className="dash-mini-list" style={{ marginTop: 8 }}>
          {googleData.items.slice(0, 10).map((it, i) => (
            <div key={`${it.title}-${i}`} className="dash-mini-item">
              <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="dash-badge hot">HOT</span>
                <span>{it.title}</span>
                {it.approx_traffic ? (
                  <span style={{ marginLeft: 'auto' }} className="muted">
                    {it.approx_traffic}
                  </span>
                ) : null}
              </div>
              {it.news?.length ? (
                <div className="dash-mini-meta">
                  Top news: {it.news[0]?.source ? `${it.news[0].source} · ` : ''}
                  {it.news[0]?.title ?? ''}
                </div>
              ) : it.description ? (
                <div className="dash-mini-meta">{it.description}</div>
              ) : null}
              <div className="dash-actions" style={{ marginTop: 8 }}>
                {it.news?.[0]?.url ? (
                  <button
                    type="button"
                    className="dash-small-btn"
                    onClick={() => window.open(it.news?.[0]?.url ?? '', '_blank', 'noopener,noreferrer')}
                  >
                    Read
                  </button>
                ) : null}
                <button
                  type="button"
                  className="dash-small-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(it.title)
                      toast.push({ kind: 'success', title: 'Copied', message: 'Trend keyword disalin' })
                    } catch {
                      toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                    }
                  }}
                >
                  Copy keyword
                </button>
                <button type="button" className="dash-small-btn" onClick={() => toggleWatch(it.title)}>
                  {watch.includes(it.title) ? 'Untrack' : 'Track'}
                </button>
                <button
                  type="button"
                  className="dash-small-btn"
                  disabled={planLoading && planOpen === it.title}
                  onClick={() => void generateQuickPlan(it.title)}
                >
                  {planLoading && planOpen === it.title && planMode === 'quick' ? 'Generating...' : 'Quick Plan'}
                </button>
                <button
                  type="button"
                  className="dash-small-btn"
                  disabled={!clients.length || (planLoading && planOpen === it.title)}
                  onClick={() => void generateStrategicPlan(it.title)}
                >
                  {planLoading && planOpen === it.title && planMode === 'strategic' ? 'Generating...' : 'Strategic Plan'}
                </button>
                <button
                  type="button"
                  className="dash-small-btn"
                  disabled={captionLoading && captionOpen === it.title}
                  onClick={() => void generateCaptions(it.title)}
                >
                  {captionLoading && captionOpen === it.title ? 'Generating...' : 'Captions'}
                </button>
              </div>

              {planOpen === it.title ? (
                <div style={{ marginTop: 10 }}>
                  {planError ? <div className="error">{planError}</div> : null}
                  {planItems?.length ? (
                    <div className="dash-mini-list">
                      {planItems.slice(0, 14).map((p) => (
                        <div key={`${it.title}-${p.day}-${p.platform}`} className="dash-mini-item">
                          <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <span className="dash-badge neutral">DAY {p.day}</span>
                            <span style={{ textTransform: 'uppercase' }}>{p.platform}</span>
                            <span className="muted" style={{ marginLeft: 'auto' }}>
                              {p.time ?? '10:00'}
                            </span>
                          </div>
                          <div className="dash-mini-meta">{p.title}</div>
                          <div className="dash-mini-meta">{p.angle}</div>
                          <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                            {p.caption}
                          </div>
                          <div className="dash-actions" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="dash-small-btn"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(p.caption)
                                  toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                                } catch {
                                  toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                }
                              }}
                            >
                              Copy caption
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {captionOpen === it.title ? (
                <div style={{ marginTop: 10 }}>
                  {captionError ? <div className="error">{captionError}</div> : null}
                  {captionVariants?.length ? (
                    <div className="dash-mini-list">
                      {captionVariants.slice(0, 4).map((v, idx) => (
                        <div key={`${idx}-${v.slice(0, 12)}`} className="dash-mini-item">
                          <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                            {v}
                          </div>
                          <div className="dash-actions" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="dash-small-btn"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(v)
                                  toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                                } catch {
                                  toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                }
                              }}
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              className="dash-small-btn"
                              disabled={hashtagsLoading}
                              onClick={() => void generateHashtagsFor(v)}
                            >
                              {hashtagsLoading ? 'Generating...' : 'Hashtags'}
                            </button>
                          </div>
                          {hashtagsError ? <div className="error">{hashtagsError}</div> : null}
                          {hashtags?.length ? (
                            <div className="dash-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                              {hashtags.slice(0, 16).map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  className="dash-ghost-btn"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(h)
                                      toast.push({ kind: 'success', title: 'Copied', message: h })
                                    } catch {
                                      toast.push({ kind: 'error', title: 'Gagal copy', message: 'Copy manual' })
                                    }
                                  }}
                                >
                                  {h}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : source === 'exploding' && explodingData?.items?.length ? (
        <div className="dash-mini-list" style={{ marginTop: 8 }}>
          {explodingData.items.slice(0, 10).map((row, i) => {
            const r = row as Record<string, unknown>
            const keyword = typeof r?.keyword === 'string' ? r.keyword : `Topic #${i + 1}`
            const growth = typeof r?.growth === 'number' ? `${Math.round(r.growth)}%` : ''
            const volume = typeof r?.absolute_volume === 'number' ? `${Math.round(r.absolute_volume)}/mo` : ''
            return (
              <div key={`${keyword}-${i}`} className="dash-mini-item">
                <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="dash-badge early">EARLY</span>
                  <span>{keyword}</span>
                  <span style={{ marginLeft: 'auto' }} className="muted">
                    {[growth, volume].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {typeof r?.description === 'string' && r.description ? <div className="dash-mini-meta">{r.description}</div> : null}
                <div className="dash-actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="dash-small-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(keyword)
                        toast.push({ kind: 'success', title: 'Copied', message: 'Keyword disalin' })
                      } catch {
                        toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                      }
                    }}
                  >
                    Copy keyword
                  </button>
                  <button type="button" className="dash-small-btn" onClick={() => toggleWatch(keyword)}>
                    {watch.includes(keyword) ? 'Untrack' : 'Track'}
                  </button>
                  <button
                    type="button"
                    className="dash-small-btn"
                    disabled={planLoading && planOpen === keyword}
                    onClick={() => void generateQuickPlan(keyword)}
                  >
                    {planLoading && planOpen === keyword && planMode === 'quick' ? 'Generating...' : 'Quick Plan'}
                  </button>
                  <button
                    type="button"
                    className="dash-small-btn"
                    disabled={!clients.length || (planLoading && planOpen === keyword)}
                    onClick={() => void generateStrategicPlan(keyword)}
                  >
                    {planLoading && planOpen === keyword && planMode === 'strategic' ? 'Generating...' : 'Strategic Plan'}
                  </button>
                  <button
                    type="button"
                    className="dash-small-btn"
                    disabled={captionLoading && captionOpen === keyword}
                    onClick={() => void generateCaptions(keyword)}
                  >
                    {captionLoading && captionOpen === keyword ? 'Generating...' : 'Captions'}
                  </button>
                </div>

                {planOpen === keyword ? (
                  <div style={{ marginTop: 10 }}>
                    {planError ? <div className="error">{planError}</div> : null}
                    {planItems?.length ? (
                      <div className="dash-mini-list">
                        {planItems.slice(0, 14).map((p) => (
                          <div key={`${keyword}-${p.day}-${p.platform}`} className="dash-mini-item">
                            <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <span className="dash-badge neutral">DAY {p.day}</span>
                              <span style={{ textTransform: 'uppercase' }}>{p.platform}</span>
                              <span className="muted" style={{ marginLeft: 'auto' }}>
                                {p.time ?? '10:00'}
                              </span>
                            </div>
                            <div className="dash-mini-meta">{p.title}</div>
                            <div className="dash-mini-meta">{p.angle}</div>
                            <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                              {p.caption}
                            </div>
                            <div className="dash-actions" style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="dash-small-btn"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(p.caption)
                                    toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                                  } catch {
                                    toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                  }
                                }}
                              >
                                Copy caption
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {captionOpen === keyword ? (
                  <div style={{ marginTop: 10 }}>
                    {captionError ? <div className="error">{captionError}</div> : null}
                    {captionVariants?.length ? (
                      <div className="dash-mini-list">
                        {captionVariants.slice(0, 4).map((v, idx) => (
                          <div key={`${idx}-${v.slice(0, 12)}`} className="dash-mini-item">
                            <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                              {v}
                            </div>
                            <div className="dash-actions" style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="dash-small-btn"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(v)
                                    toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                                  } catch {
                                    toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                  }
                                }}
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                className="dash-small-btn"
                                disabled={hashtagsLoading}
                                onClick={() => void generateHashtagsFor(v)}
                              >
                                {hashtagsLoading ? 'Generating...' : 'Hashtags'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : source === 'similarweb' && similarwebData ? (
        <div className="dash-mini-list" style={{ marginTop: 8 }}>
          <div className="dash-mini-item">
            <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="dash-badge web">WEB</span>
              <span>{similarwebData.domain}</span>
              <span style={{ marginLeft: 'auto' }} className="muted">
                {similarwebData.country.toUpperCase()}
              </span>
            </div>
            {similarwebData.latest ? (
              <div className="dash-mini-meta">
                {[
                  typeof similarwebData.latest.visits === 'number' ? `visits: ${Math.round(similarwebData.latest.visits).toLocaleString('id-ID')}` : '',
                  typeof similarwebData.latest.bounce_rate === 'number' ? `bounce: ${Math.round(similarwebData.latest.bounce_rate * 100)}%` : '',
                  typeof similarwebData.latest.pages_per_visit === 'number' ? `pages/visit: ${similarwebData.latest.pages_per_visit.toFixed(2)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            ) : (
              <div className="dash-mini-meta muted">No traffic row.</div>
            )}
            <div className="dash-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="dash-small-btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(similarwebData.domain)
                    toast.push({ kind: 'success', title: 'Copied', message: 'Domain disalin' })
                  } catch {
                    toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                  }
                }}
              >
                Copy domain
              </button>
              <button type="button" className="dash-small-btn" onClick={() => void generateQuickPlan(similarwebData.domain)}>
                Quick Plan
              </button>
              <button
                type="button"
                className="dash-small-btn"
                disabled={!clients.length}
                onClick={() => void generateStrategicPlan(similarwebData.domain)}
              >
                Strategic Plan
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="muted" style={{ marginTop: 8 }}>
          Belum ada data trend.
        </div>
      )}

      {watch.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="dash-segment-title" style={{ fontSize: 14 }}>
            Watchlist
          </div>
          <div className="dash-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {watch.slice(0, 16).map((k) => (
              <button key={k} type="button" className="dash-small-btn" onClick={() => void generateQuickPlan(k)}>
                {k}
              </button>
            ))}
            <button type="button" className="dash-small-btn" onClick={() => setWatchPersist([])}>
              Clear
            </button>
          </div>
        </div>
      ) : null}
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
          <div className="dash-table-wrap compact">
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
                  posts.slice(0, 6).map((p) => (
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

function ClientGrowthSmartCard({
  clients,
  isLoading,
  error,
}: {
  clients: Client[]
  isLoading: boolean
  error: string | null
}) {
  const [tab, setTab] = useState<'growth' | 'mix'>('growth')

  const growth = useMemo(() => buildClientGrowthSeries(clients, 30), [clients])
  const mix = useMemo(() => buildAccountMix(clients), [clients])

  const status = error ? 'OFF' : isLoading ? 'SYNC' : 'LIVE'

  return (
    <div>
      <div className="dash-card-head">
        <div className="dash-card-title">Client Growth</div>
        <div className="dash-card-head-right">
          <div className="dash-card-subtitle">{status}</div>
          <div className="dash-tabs" role="tablist" aria-label="Client growth tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'growth'}
              className={tab === 'growth' ? 'dash-tab active' : 'dash-tab'}
              onClick={() => setTab('growth')}
            >
              Growth
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mix'}
              className={tab === 'mix' ? 'dash-tab active' : 'dash-tab'}
              onClick={() => setTab('mix')}
            >
              Donut
            </button>
          </div>
        </div>
      </div>

      {error ? <DashNotice {...prettyErrorMessage(error)} /> : null}
      {!error && isLoading ? <div className="muted">Sinkron...</div> : null}
      {!error && !isLoading && clients.length === 0 ? <div className="muted">Belum ada client untuk dianalisa.</div> : null}

      {!error && !isLoading ? (tab === 'growth' ? <ClientGrowthView growth={growth} /> : <ClientDonutView mix={mix} />) : null}
    </div>
  )
}

function buildClientGrowthSeries(
  clients: Client[],
  days: number,
): {
  days: number
  labels: string[]
  tickLabels: string[]
  dailyNew: number[]
  cumulative: number[]
  new30: number
  new7: number
  prev7: number
} {
  const safeDays = Math.max(2, Math.min(120, Math.floor(days || 30)))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - (safeDays - 1))

  const key = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const byDay = new Map<string, number>()
  let baseCount = 0
  for (const c of clients) {
    const raw = (c.created_at ?? '').trim()
    if (!raw) continue
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) continue
    dt.setHours(0, 0, 0, 0)
    if (dt.getTime() < start.getTime()) {
      baseCount += 1
      continue
    }
    const k = key(dt)
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }

  const labels: string[] = []
  const dailyNew: number[] = []
  const cumulative: number[] = []
  let run = baseCount
  for (let i = 0; i < safeDays; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const n = byDay.get(key(d)) ?? 0
    run += n
    labels.push(format(d, 'd MMM', { locale: idLocale }))
    dailyNew.push(n)
    cumulative.push(run)
  }

  const tickLabels = Array.from({ length: 12 }).map((_, i) => {
    const idx = Math.round((i * (safeDays - 1)) / 11)
    const d = new Date(start)
    d.setDate(start.getDate() + idx)
    return format(d, 'd MMM', { locale: idLocale })
  })

  const new30 = dailyNew.reduce((a, b) => a + b, 0)
  const new7 = dailyNew.slice(-7).reduce((a, b) => a + b, 0)
  const prev7 = dailyNew.slice(-14, -7).reduce((a, b) => a + b, 0)
  return { days: safeDays, labels, tickLabels, dailyNew, cumulative, new30, new7, prev7 }
}

function buildAccountMix(
  clients: Client[],
): {
  totalAccounts: number
  totalClients: number
  connectedClients: number
  segments: Array<{ label: string; value: number; color: string }>
  topLabel: string
} {
  const byPlatform = new Map<string, number>()
  let totalAccounts = 0
  let connectedClients = 0
  for (const c of clients) {
    const acc = c.social_accounts ?? []
    for (const a of acc) {
      if (!a.connected_at) continue
      const p = String(a.platform || '').toLowerCase().trim() || 'other'
      byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1)
      totalAccounts++
    }
    if (acc.some((a) => Boolean(a.connected_at))) connectedClients++
  }

  const sorted = [...byPlatform.entries()].sort((a, b) => b[1] - a[1])
  const base = [
    { key: 'instagram', label: 'Instagram', color: 'var(--dash-neon-purple)' },
    { key: 'tiktok', label: 'TikTok', color: 'var(--dash-neon-teal)' },
    { key: 'youtube', label: 'YouTube', color: 'var(--dash-neon-gold)' },
    { key: 'facebook', label: 'Facebook', color: 'var(--dash-neon-blue)' },
  ] as const

  const picked = new Map<string, { label: string; value: number; color: string }>()
  for (const b of base) {
    const v = byPlatform.get(b.key) ?? 0
    if (v > 0) picked.set(b.key, { label: b.label, value: v, color: b.color })
  }

  let other = 0
  for (const [k, v] of sorted) {
    if (picked.has(k)) continue
    other += v
  }

  const segments = [...picked.values()]
  if (other > 0) segments.push({ label: 'Other', value: other, color: 'rgba(120, 128, 160, 0.9)' })

  const top = sorted[0]
  const topLabel = top ? `${top[0]}` : '-'

  return { totalAccounts, totalClients: clients.length, connectedClients, segments, topLabel }
}

function ClientGrowthView({
  growth,
}: {
  growth: ReturnType<typeof buildClientGrowthSeries>
}) {
  const series = growth.cumulative
  const last = series[series.length - 1] ?? 0
  const delta = growth.new7 - growth.prev7
  const deltaLabel = delta === 0 ? 'flat' : delta > 0 ? `+${delta}` : `${delta}`

  const chart = useMemo(() => {
    return buildLineChartPath(series, { width: 600, height: 220, padX: 14, padY: 16, bottomPad: 34 })
  }, [series])

  return (
    <div className="dash-chart-wrap">
      <div className="dash-growth-meta">
        <div>
          30D · +{growth.new30} new · 7D {growth.new7} ({deltaLabel} vs prev)
        </div>
        <div className="dash-growth-strong">Total {last}</div>
      </div>
      <svg className="dash-svg dash-growth-svg" viewBox="0 0 600 220" aria-label="Client growth chart" role="img">
        <defs>
          <linearGradient id="ts-growth-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--dash-neon-teal)" stopOpacity="0.92" />
            <stop offset="50%" stopColor="var(--dash-neon-purple)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--dash-neon-gold)" stopOpacity="0.88" />
          </linearGradient>
          <linearGradient id="ts-growth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dash-neon-purple)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--dash-neon-purple)" stopOpacity="0" />
          </linearGradient>
          <filter id="ts-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.35 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {chart.grid.map((y, i) => (
          <line key={i} x1="14" x2="586" y1={y} y2={y} className="dash-growth-grid" />
        ))}

        <path d={chart.areaPath} fill="url(#ts-growth-fill)" opacity="1" />
        <path d={chart.path} fill="none" stroke="url(#ts-growth-stroke)" strokeWidth="3" filter="url(#ts-glow)" />

        <circle cx={chart.lastPoint.x} cy={chart.lastPoint.y} r="4.5" fill="var(--dash-neon-gold)" />
        <circle cx={chart.lastPoint.x} cy={chart.lastPoint.y} r="9" fill="var(--dash-neon-gold)" opacity="0.16" />
      </svg>

      <div className="dash-axis" aria-hidden="true">
        {growth.tickLabels.map((t, i) => (
          <div key={`${t}-${i}`} className="dash-axis-tick">
            {i % 2 === 0 ? t : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildLineChartPath(
  values: number[],
  opts: { width: number; height: number; padX: number; padY: number; bottomPad: number },
): { path: string; areaPath: string; lastPoint: { x: number; y: number }; grid: number[] } {
  const n = Math.max(2, values.length)
  const width = Math.max(200, opts.width)
  const height = Math.max(120, opts.height)
  const padX = Math.max(0, opts.padX)
  const padY = Math.max(0, opts.padY)
  const bottomPad = Math.max(0, opts.bottomPad)
  const innerW = Math.max(1, width - padX * 2)
  const innerH = Math.max(1, height - padY - bottomPad)

  const safe = values.length >= 2 ? values : [0, values[0] ?? 0]
  const maxV = Math.max(1, ...safe)
  const minV = Math.min(0, ...safe)
  const span = Math.max(1, maxV - minV)
  const stepX = innerW / (n - 1)

  const pointAt = (i: number) => {
    const v = safe[Math.min(safe.length - 1, i)] ?? 0
    const x = padX + stepX * i
    const y = padY + (1 - (v - minV) / span) * innerH
    return { x, y }
  }

  const pts = Array.from({ length: n }, (_, i) => pointAt(i))
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

  const baseY = padY + innerH
  const area = `${d} L ${pts[pts.length - 1].x.toFixed(2)} ${baseY.toFixed(2)} L ${pts[0].x.toFixed(2)} ${baseY.toFixed(2)} Z`

  const grid = Array.from({ length: 4 }).map((_, i) => {
    const t = (i + 1) / 5
    return padY + t * innerH
  })

  const lastPoint = pts[pts.length - 1]
  return { path: d, areaPath: area, lastPoint, grid }
}

function ClientDonutView({
  mix,
}: {
  mix: ReturnType<typeof buildAccountMix>
}) {
  const total = Math.max(0, mix.totalAccounts)
  const radius = 92
  const strokeW = 18
  const cx = 110
  const cy = 110
  const circ = 2 * Math.PI * radius

  let offset = 0
  const segs = mix.segments.filter((s) => s.value > 0)
  const hasData = total > 0 && segs.length > 0

  const topPretty = useMemo(() => {
    const s = String(mix.topLabel || '').trim()
    if (!s) return '-'
    if (s === 'instagram') return 'instagram'
    if (s === 'tiktok') return 'tiktok'
    if (s === 'youtube') return 'youtube'
    if (s === 'facebook') return 'facebook'
    return s
  }, [mix.topLabel])

  return (
    <div className="dash-donut-wrap">
      <div className="dash-donut-ring" aria-label="Account mix donut">
        <svg className="dash-donut-svg" width="220" height="220" viewBox="0 0 220 220" aria-hidden="true">
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="rgba(120, 128, 160, 0.26)"
            strokeWidth={strokeW}
          />
          {hasData
            ? segs.map((s) => {
                const segLen = (s.value / total) * circ
                const dash = `${segLen} ${Math.max(0, circ - segLen)}`
                const curOffset = offset
                offset += segLen
                return (
                  <circle
                    key={s.label}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={strokeW}
                    strokeDasharray={dash}
                    strokeDashoffset={-curOffset}
                    className="dash-donut-seg"
                  />
                )
              })
            : null}
        </svg>
        <div className="dash-donut-center">
          <div className="dash-donut-value">{String(total)}</div>
          <div className="dash-donut-label">accounts</div>
        </div>
      </div>

      <div className="dash-donut-foot">
        <div className="dash-donut-foot-item">
          <div className="dash-donut-foot-key">Connected Clients</div>
          <div className="dash-donut-foot-val">
            {mix.connectedClients}/{mix.totalClients}
          </div>
        </div>
        <div className="dash-donut-foot-item">
          <div className="dash-donut-foot-key">Top Platform</div>
          <div className="dash-donut-foot-val">{topPretty}</div>
        </div>
      </div>
    </div>
  )
}

function UpcomingPostsCard({ refreshSeq, onOpenCalendar }: { refreshSeq: number; onOpenCalendar: () => void }) {
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

  const sortedAll = useMemo(() => {
    return [...rows].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  }, [rows])

  const preview = useMemo(() => sortedAll.slice(0, 6), [sortedAll])

  return (
    <div className="dash-rail">
      <div className="dash-rail-meta">Horizon · 14 hari · preview {Math.min(preview.length, 6)}/{sortedAll.length}</div>
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
        {!isLoading && !error && preview.length === 0 ? <div className="muted">Belum ada post terjadwal</div> : null}
        {!isLoading && !error && preview.length > 0 ? (
          <div className="dash-mini-list">
            {preview.map((e) => (
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
      <div className="dash-rail-actions">
        <button type="button" className="dash-small-btn" onClick={onOpenCalendar}>
          Open Calendar
        </button>
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
  const [tab, setTab] = useState<'profile' | 'competitor' | 'offline' | 'timeline'>(() => initialTab)

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

  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [timelineRows, setTimelineRows] = useState<ClientTimelineEvent[]>([])
  const [timelineSeq, setTimelineSeq] = useState(0)
  const [timelineKind, setTimelineKind] = useState('all')
  const [timelineQuery, setTimelineQuery] = useState('')

  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const apiTarget = import.meta.env.VITE_API_TARGET || 'http://localhost:8080'

  const timelineKinds = useMemo(() => {
    const set = new Set<string>()
    for (const r of timelineRows) {
      const k = String(r.kind || '').trim()
      if (k) set.add(k)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [timelineRows])

  const filteredTimelineRows = useMemo(() => {
    const kind = String(timelineKind || '').trim().toLowerCase()
    const q = String(timelineQuery || '').trim().toLowerCase()
    if (kind === 'all' && !q) return timelineRows
    return timelineRows.filter((r) => {
      const k = String(r.kind || '').toLowerCase()
      if (kind !== 'all' && k !== kind) return false
      if (!q) return true
      const title = String(r.title || '').toLowerCase()
      const meta = r.meta ? safeJSONStringify(r.meta).toLowerCase() : ''
      return title.includes(q) || k.includes(q) || meta.includes(q)
    })
  }, [timelineKind, timelineQuery, timelineRows])

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
    if (!client) return
    if (tab !== 'timeline') return
    let cancelled = false
    void (async () => {
      setTimelineLoading(true)
      setTimelineError(null)
      try {
        const rows = await clientTimeline(client.id, { limit: 80 })
        if (cancelled) return
        setTimelineRows(rows)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load timeline'
        if (cancelled) return
        setTimelineError(msg)
        toast.push({ kind: 'error', title: 'Timeline', message: msg })
      } finally {
        if (!cancelled) setTimelineLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, tab, timelineSeq, toast])

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
                <button
                  type="button"
                  className={tab === 'timeline' ? 'dash-lab-tab active' : 'dash-lab-tab'}
                  onClick={() => setTab('timeline')}
                >
                  Timeline
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
                          setOfflineResult({
                            status: res.status,
                            file_url: res.file_url,
                            file_mime: res.file_mime,
                            data: res.data,
                          })
                          const status = String(res.status || '').toLowerCase()
                          if (status === 'extracted') {
                            toast.push({ kind: 'success', title: 'Offline campaign extracted' })
                          } else {
                            toast.push({ kind: 'info', title: 'Offline Campaign', message: 'File tersimpan. AI belum aktif untuk extract.' })
                          }
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

              {tab === 'timeline' ? (
                <div className="dash-lab-panel">
                  {timelineError ? <DashNotice {...prettyErrorMessage(timelineError)} /> : null}
                  <div className="dash-actions">
                    <button
                      type="button"
                      className="dash-small-btn"
                      disabled={timelineLoading}
                      onClick={() => {
                        setTimelineSeq((v) => v + 1)
                      }}
                    >
                      {timelineLoading ? 'Loading...' : 'Refresh'}
                    </button>
                    <label className="field" style={{ minWidth: 200 }}>
                      <span>Filter</span>
                      <select value={timelineKind} onChange={(e) => setTimelineKind(e.target.value)}>
                        <option value="all">all</option>
                        {timelineKinds.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field" style={{ minWidth: 240 }}>
                      <span>Search</span>
                      <input
                        value={timelineQuery}
                        onChange={(e) => setTimelineQuery(e.target.value)}
                        placeholder="Cari: report / post / tiktok / token..."
                      />
                    </label>
                  </div>

                  {timelineLoading ? (
                    <div className="dash-skeleton-list" aria-busy="true">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="dash-skeleton-row">
                          <div className="skeleton skeleton-line" />
                          <div className="skeleton skeleton-line short" />
                        </div>
                      ))}
                    </div>
                  ) : timelineRows.length === 0 ? (
                    <DashNotice title="Belum ada aktivitas" detail="Generate Competitor Insight, Offline Campaign, atau Report untuk mulai membentuk timeline." />
                  ) : (
                    <div className="dash-mini-list">
                      {filteredTimelineRows.map((e, i) => {
                        const t = new Date(e.created_at)
                        const timeLabel = Number.isNaN(t.getTime())
                          ? String(e.created_at)
                          : t.toLocaleString('id-ID', { hour12: false })
                        const metaObj = (e.meta ?? {}) as Record<string, unknown>
                        const meta = e.meta ? safeJSONStringify(e.meta) : ''
                        const metaShort = meta.length > 480 ? meta.slice(0, 480) + '…' : meta
                        const token = typeof metaObj.token === 'string' ? metaObj.token : null
                        const viewURL =
                          typeof metaObj.view_url === 'string' ? metaObj.view_url : token ? `/r/${token}` : null
                        const downloadURL =
                          typeof metaObj.download_url === 'string'
                            ? metaObj.download_url
                            : token
                              ? `/r/${token}/download`
                              : null
                        const postId = typeof metaObj.id === 'string' ? metaObj.id : null
                        const postStatus = typeof metaObj.status === 'string' ? metaObj.status : null
                        const nextExecuteAt = typeof metaObj.next_execute_at === 'string' ? metaObj.next_execute_at : null
                        return (
                          <div key={`${e.kind}-${e.created_at}-${i}`} className="dash-mini-item">
                            <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <span
                                className="dash-badge"
                                style={
                                  e.kind === 'alert'
                                    ? { borderColor: 'rgba(255, 90, 90, 0.55)', background: 'rgba(255, 40, 40, 0.14)' }
                                    : undefined
                                }
                              >
                                {String(e.kind).toUpperCase()}
                              </span>
                              <span>{e.title}</span>
                              <span style={{ marginLeft: 'auto' }} className="muted">
                                {timeLabel}
                              </span>
                            </div>
                            {metaShort ? (
                              <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                                {metaShort}
                              </div>
                            ) : null}
                            {e.kind === 'alert' ? (
                              <div className="dash-actions" style={{ marginTop: 8, alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="dash-small-btn"
                                  onClick={() => void downloadPDF()}
                                >
                                  Generate report
                                </button>
                                <button
                                  type="button"
                                  className="dash-small-btn"
                                  onClick={() => {
                                    setTab('competitor')
                                    setPlanDays(7)
                                    void generatePlan()
                                  }}
                                >
                                  Convert to plan
                                </button>
                                <button
                                  type="button"
                                  className="dash-small-btn"
                                  onClick={async () => {
                                    try {
                                      setTab('competitor')
                                      setPlanDays(3)
                                      setPlanScheduling(true)
                                      setPlanScheduleError(null)
                                      const res = await aiContentPlan({
                                        client_id: client.id,
                                        horizon_days: 3,
                                        platforms: [planPlatform],
                                      })
                                      const items = (res.items ?? []).slice(0, 3)
                                      if (!items.length) throw new Error('Plan kosong')
                                      for (const it of items) {
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
                                      setPlanItems(items)
                                      toast.push({ kind: 'success', title: '3 posts terjadwal' })
                                      onDidMutate()
                                      setTimelineSeq((v) => v + 1)
                                    } catch (err) {
                                      const msg = err instanceof Error ? err.message : 'Gagal schedule 3 posts'
                                      setPlanScheduleError(msg)
                                      toast.push({ kind: 'error', title: 'Schedule 3 posts', message: msg })
                                    } finally {
                                      setPlanScheduling(false)
                                    }
                                  }}
                                >
                                  Schedule 3 posts
                                </button>
                              </div>
                            ) : null}
                            {e.kind === 'report_pdf' && (viewURL || downloadURL) ? (
                              <div className="dash-actions" style={{ marginTop: 8 }}>
                                {viewURL ? (
                                  <button
                                    type="button"
                                    className="dash-small-btn"
                                    onClick={() => {
                                      const abs = /^https?:\/\//i.test(viewURL)
                                        ? viewURL
                                        : `${apiTarget}${viewURL.startsWith('/') ? viewURL : `/${viewURL}`}`
                                      window.open(abs, '_blank', 'noopener,noreferrer')
                                    }}
                                  >
                                    View
                                  </button>
                                ) : null}
                                {downloadURL ? (
                                  <button
                                    type="button"
                                    className="dash-small-btn"
                                    onClick={() => {
                                      const abs = /^https?:\/\//i.test(downloadURL)
                                        ? downloadURL
                                        : `${apiTarget}${downloadURL.startsWith('/') ? downloadURL : `/${downloadURL}`}`
                                      window.open(abs, '_blank', 'noopener,noreferrer')
                                    }}
                                  >
                                    Download
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            {e.kind === 'post' && postId ? (
                              <div className="dash-actions" style={{ marginTop: 8, alignItems: 'center' }}>
                                {postStatus === 'scheduled' || postStatus === 'queued' ? (
                                  <button
                                    type="button"
                                    className="dash-small-btn"
                                    onClick={async () => {
                                      try {
                                        await publishNow(postId)
                                        toast.push({ kind: 'success', title: 'Publish queued' })
                                        onDidMutate()
                                        setTimelineSeq((v) => v + 1)
                                      } catch (err) {
                                        const msg = err instanceof Error ? err.message : 'Gagal publish now'
                                        toast.push({ kind: 'error', title: 'Publish now', message: msg })
                                      }
                                    }}
                                  >
                                    Publish now
                                  </button>
                                ) : null}
                                {nextExecuteAt ? <span className="muted">Next: {nextExecuteAt}</span> : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
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
  onConnectTikTok,
}: {
  clients: Client[]
  isLoading: boolean
  error: string | null
  limit?: number
  onOpenIntel: (clientId: string) => void
  onConnectInstagram?: (clientId: string) => Promise<void>
  onConnectTikTok?: (clientId: string) => Promise<void>
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
  const hasActions = Boolean(onConnectInstagram || onConnectTikTok)

  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Industry</th>
            <th>Platforms</th>
            <th>Connected</th>
            {hasActions ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={hasActions ? 5 : 4} className="dash-td-muted">
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
                  {hasActions ? (
                    <td>
                      <div className="dash-actions">
                        {onConnectInstagram ? (
                          <button type="button" className="dash-small-btn" onClick={() => void onConnectInstagram(c.id)}>
                            Connect IG
                          </button>
                        ) : null}
                        {onConnectTikTok ? (
                          <button type="button" className="dash-small-btn" onClick={() => void onConnectTikTok(c.id)}>
                            Connect TikTok
                          </button>
                        ) : null}
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

function AnalyticsPanel({
  clients,
  isLoading,
  error,
}: {
  clients: Client[]
  isLoading: boolean
  error: string | null
}) {
  return (
    <div className="dash-stack">
      <ClientGrowthSmartCard clients={clients} isLoading={isLoading} error={error} />
      <TrendRadarPanel clients={clients} />
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

export function OnboardingPanelLegacy({ onGoClients }: { onGoClients: () => void }) {
  const toast = useToast()
  const [source, setSource] = useState<'google' | 'exploding' | 'similarweb'>('google')

  const [geo, setGeo] = useState('ID')
  const [explodingCategory, setExplodingCategory] = useState('marketing')
  const [explodingType, setExplodingType] = useState<'all' | 'regular' | 'exploding' | 'peaked'>('exploding')
  const [domain, setDomain] = useState('chatgpt.com')
  const [country, setCountry] = useState('us')

  const [googleData, setGoogleData] = useState<GoogleTrendsResponse | null>(null)
  const [explodingData, setExplodingData] = useState<ExplodingTopicsResponse | null>(null)
  const [similarwebData, setSimilarwebData] = useState<SimilarwebTrafficResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)

  const [captionPlatform, setCaptionPlatform] = useState<'facebook' | 'x' | 'tiktok'>('tiktok')
  const [captionTone, setCaptionTone] = useState<'smart' | 'hype' | 'luxury'>('smart')
  const [captionOpen, setCaptionOpen] = useState<string | null>(null)
  const [captionLoading, setCaptionLoading] = useState(false)
  const [captionError, setCaptionError] = useState<string | null>(null)
  const [captionVariants, setCaptionVariants] = useState<string[] | null>(null)
  const [hashtagsLoading, setHashtagsLoading] = useState(false)
  const [hashtagsError, setHashtagsError] = useState<string | null>(null)
  const [hashtags, setHashtags] = useState<string[] | null>(null)

  const [watch, setWatch] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('trendspire.watchlist.trends')
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string').slice(0, 50)
      return []
    } catch {
      return []
    }
  })

  function setWatchPersist(next: string[]) {
    const out = Array.from(new Set(next.map((s) => String(s || '').trim()).filter(Boolean))).slice(0, 50)
    setWatch(out)
    try {
      localStorage.setItem('trendspire.watchlist.trends', JSON.stringify(out))
    } catch {}
  }

  function toggleWatch(keyword: string) {
    const k = String(keyword || '').trim()
    if (!k) return
    if (watch.includes(k)) {
      setWatchPersist(watch.filter((x) => x !== k))
      toast.push({ kind: 'info', title: 'Untracked', message: k })
      return
    }
    setWatchPersist([k, ...watch])
    toast.push({ kind: 'success', title: 'Tracked', message: k })
  }

  async function generateCaptions(keyword: string) {
    const idea = String(keyword || '').trim()
    if (!idea) return
    setCaptionLoading(true)
    setCaptionError(null)
    setHashtags(null)
    setHashtagsError(null)
    setCaptionOpen(idea)
    setCaptionVariants(null)
    try {
      const res = await aiCaption({ content_idea: idea, platform: captionPlatform, tone: captionTone })
      setCaptionVariants(res.variants ?? [])
      if (!res.variants?.length) setCaptionError('Tidak ada output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate caption'
      setCaptionError(msg)
    } finally {
      setCaptionLoading(false)
    }
  }

  async function generateHashtagsFor(caption: string) {
    const cap = String(caption || '').trim()
    const niche = String(captionOpen || '').trim()
    if (!cap || !niche) return
    setHashtagsLoading(true)
    setHashtagsError(null)
    setHashtags(null)
    try {
      const res = await aiHashtags({ caption: cap, niche })
      setHashtags(res.hashtags ?? [])
      if (!res.hashtags?.length) setHashtagsError('Tidak ada output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal generate hashtags'
      setHashtagsError(msg)
    } finally {
      setHashtagsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      setIsLoading(true)
      setError(null)
      try {
        if (source === 'google') {
          const d = await googleTrendsTrending({ geo, limit: 10 })
          if (!cancelled) setGoogleData(d)
        } else if (source === 'exploding') {
          const d = await explodingTopics({
            limit: 10,
            type: explodingType,
            categories: explodingCategory ? [explodingCategory] : undefined,
            sort: 'growth',
            order: 'desc',
            timeframe: 12,
          })
          if (!cancelled) setExplodingData(d)
        } else {
          const d = await similarwebTraffic({ domain, country })
          if (!cancelled) setSimilarwebData(d)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal load intel feed'
        if (!cancelled) setError(msg)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [country, domain, explodingCategory, explodingType, geo, seq, source])

  const debugURL =
    source === 'google' ? googleData?.debug_url : source === 'exploding' ? explodingData?.debug_url : similarwebData?.debug_url

  return (
    <div className="dash-onboard">
      <div className="dash-onboard-hero">
        <div className="dash-onboard-title">Find the Trend</div>
        <div className="dash-onboard-sub">Build · Schedule · Analyze · Report</div>
      </div>
      <FlowDiagram clientsCount={0} connectedAccounts={0} scheduledPosts={0} />
      <div className="dash-form-card dash-trend-card">
        <div className="dash-segment-title">Trend Radar</div>
        <div className="dash-actions" style={{ alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 200 }}>
            <span>Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value as 'google' | 'exploding' | 'similarweb')}>
              <option value="google">Google Trends</option>
              <option value="exploding">Exploding Topics</option>
              <option value="similarweb">Similarweb</option>
            </select>
          </label>
          {source === 'google' ? (
            <label className="field" style={{ minWidth: 180 }}>
              <span>Geo</span>
              <select value={geo} onChange={(e) => setGeo(e.target.value)}>
                <option value="ID">ID</option>
                <option value="US">US</option>
                <option value="GB">GB</option>
                <option value="SG">SG</option>
                <option value="AU">AU</option>
                <option value="JP">JP</option>
              </select>
            </label>
          ) : source === 'exploding' ? (
            <>
              <label className="field" style={{ minWidth: 220 }}>
                <span>Category</span>
                <select value={explodingCategory} onChange={(e) => setExplodingCategory(e.target.value)}>
                  <option value="marketing">marketing</option>
                  <option value="ai">ai</option>
                  <option value="technology">technology</option>
                  <option value="social-media">social-media</option>
                  <option value="beauty">beauty</option>
                  <option value="health">health</option>
                  <option value="finance">finance</option>
                  <option value="food-beverage">food-beverage</option>
                </select>
              </label>
              <label className="field" style={{ minWidth: 180 }}>
                <span>Type</span>
                <select value={explodingType} onChange={(e) => setExplodingType(e.target.value as typeof explodingType)}>
                  <option value="exploding">exploding</option>
                  <option value="regular">regular</option>
                  <option value="peaked">peaked</option>
                  <option value="all">all</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="field" style={{ minWidth: 240 }}>
                <span>Domain</span>
                <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
              </label>
              <label className="field" style={{ minWidth: 120 }}>
                <span>Country</span>
                <select value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="ww">ww</option>
                  <option value="us">us</option>
                  <option value="id">id</option>
                  <option value="sg">sg</option>
                  <option value="gb">gb</option>
                </select>
              </label>
            </>
          )}
          <label className="field" style={{ minWidth: 150 }}>
            <span>Platform</span>
            <select value={captionPlatform} onChange={(e) => setCaptionPlatform(e.target.value as typeof captionPlatform)}>
              <option value="tiktok">tiktok</option>
              <option value="facebook">facebook</option>
              <option value="x">x</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 150 }}>
            <span>Tone</span>
            <select value={captionTone} onChange={(e) => setCaptionTone(e.target.value as typeof captionTone)}>
              <option value="smart">smart</option>
              <option value="luxury">luxury</option>
              <option value="hype">hype</option>
            </select>
          </label>
          <button type="button" className="dash-small-btn" disabled={isLoading} onClick={() => setSeq((v) => v + 1)}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          {debugURL ? (
            <button
              type="button"
              className="dash-small-btn"
              onClick={() => window.open(debugURL, '_blank', 'noopener,noreferrer')}
            >
              Open Source
            </button>
          ) : null}
        </div>
        {error ? (
          <DashNotice
            {...prettyErrorMessage(error)}
            actionLabel="Retry"
            onAction={() => setSeq((v) => v + 1)}
          />
        ) : null}
        {isLoading ? (
          <div className="dash-skeleton-list" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="dash-skeleton-row">
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
              </div>
            ))}
          </div>
        ) : source === 'google' && googleData?.items?.length ? (
          <div className="dash-mini-list" style={{ marginTop: 8 }}>
            {googleData.items.slice(0, 10).map((it, i) => (
              <div key={`${it.title}-${i}`} className="dash-mini-item">
                <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="dash-badge hot">HOT</span>
                  <span>{it.title}</span>
                  {it.approx_traffic ? (
                    <span style={{ marginLeft: 'auto' }} className="muted">
                      {it.approx_traffic}
                    </span>
                  ) : null}
                </div>
                {it.news?.length ? (
                  <div className="dash-mini-meta">
                    Top news: {it.news[0]?.source ? `${it.news[0].source} · ` : ''}
                    {it.news[0]?.title ?? ''}
                  </div>
                ) : it.description ? (
                  <div className="dash-mini-meta">{it.description}</div>
                ) : null}
                <div className="dash-actions" style={{ marginTop: 8 }}>
                  {it.news?.[0]?.url ? (
                    <button
                      type="button"
                      className="dash-small-btn"
                      onClick={() => window.open(it.news?.[0]?.url ?? '', '_blank', 'noopener,noreferrer')}
                    >
                      Read
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="dash-small-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(it.title)
                        toast.push({ kind: 'success', title: 'Copied', message: 'Trend keyword disalin' })
                      } catch {
                        toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                      }
                    }}
                  >
                    Copy keyword
                  </button>
                  <button type="button" className="dash-small-btn" onClick={() => toggleWatch(it.title)}>
                    {watch.includes(it.title) ? 'Untrack' : 'Track'}
                  </button>
                  <button type="button" className="dash-small-btn" disabled={captionLoading && captionOpen === it.title} onClick={() => void generateCaptions(it.title)}>
                    {captionLoading && captionOpen === it.title ? 'Generating...' : 'Captions'}
                  </button>
                </div>
                {captionOpen === it.title ? (
                  <div style={{ marginTop: 10 }}>
                    {captionError ? <div className="error">{captionError}</div> : null}
                    {captionVariants?.length ? (
                      <div className="dash-mini-list">
                        {captionVariants.slice(0, 4).map((v, idx) => (
                          <div key={`${idx}-${v.slice(0, 12)}`} className="dash-mini-item">
                            <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                              {v}
                            </div>
                            <div className="dash-actions" style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="dash-small-btn"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(v)
                                    toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                                  } catch {
                                    toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                  }
                                }}
                              >
                                Copy caption
                              </button>
                              <button type="button" className="dash-small-btn" disabled={hashtagsLoading} onClick={() => void generateHashtagsFor(v)}>
                                {hashtagsLoading ? 'Hashtags...' : 'Hashtags'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {hashtagsError ? <div className="error" style={{ marginTop: 8 }}>{hashtagsError}</div> : null}
                    {hashtags?.length ? (
                      <div className="dash-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                        {hashtags.slice(0, 16).map((h) => (
                          <button
                            key={h}
                            type="button"
                            className="dash-small-btn"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(h)
                                toast.push({ kind: 'success', title: 'Copied', message: h })
                              } catch {
                                toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                              }
                            }}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : source === 'exploding' && explodingData?.items?.length ? (
          <div className="dash-mini-list" style={{ marginTop: 8 }}>
            {explodingData.items.slice(0, 10).map((row, i) => {
              const r = row as Record<string, unknown>
              const keyword = typeof r?.keyword === 'string' ? r.keyword : `Topic #${i + 1}`
              const growth = typeof r?.growth === 'number' ? `${Math.round(r.growth)}%` : ''
              const volume = typeof r?.absolute_volume === 'number' ? `${Math.round(r.absolute_volume)}/mo` : ''
              return (
                <div key={`${keyword}-${i}`} className="dash-mini-item">
                  <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="dash-badge early">EARLY</span>
                    <span>{keyword}</span>
                    <span style={{ marginLeft: 'auto' }} className="muted">
                      {[growth, volume].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {typeof r?.description === 'string' && r.description ? <div className="dash-mini-meta">{r.description}</div> : null}
                  <div className="dash-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="dash-small-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(keyword)
                          toast.push({ kind: 'success', title: 'Copied', message: 'Keyword disalin' })
                        } catch {
                          toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                        }
                      }}
                    >
                      Copy keyword
                    </button>
                    <button type="button" className="dash-small-btn" onClick={() => toggleWatch(keyword)}>
                      {watch.includes(keyword) ? 'Untrack' : 'Track'}
                    </button>
                    <button type="button" className="dash-small-btn" disabled={captionLoading && captionOpen === keyword} onClick={() => void generateCaptions(keyword)}>
                      {captionLoading && captionOpen === keyword ? 'Generating...' : 'Captions'}
                    </button>
                  </div>
                  {captionOpen === keyword ? (
                    <div style={{ marginTop: 10 }}>
                      {captionError ? <div className="error">{captionError}</div> : null}
                      {captionVariants?.length ? (
                        <div className="dash-mini-list">
                          {captionVariants.slice(0, 4).map((v, idx) => (
                            <div key={`${idx}-${v.slice(0, 12)}`} className="dash-mini-item">
                              <div className="dash-mini-meta" style={{ whiteSpace: 'pre-wrap' }}>
                                {v}
                              </div>
                              <div className="dash-actions" style={{ marginTop: 8 }}>
                                <button
                                  type="button"
                                  className="dash-small-btn"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(v)
                                      toast.push({ kind: 'success', title: 'Copied', message: 'Caption disalin' })
                                    } catch {
                                      toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                    }
                                  }}
                                >
                                  Copy caption
                                </button>
                                <button type="button" className="dash-small-btn" disabled={hashtagsLoading} onClick={() => void generateHashtagsFor(v)}>
                                  {hashtagsLoading ? 'Hashtags...' : 'Hashtags'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {hashtagsError ? <div className="error" style={{ marginTop: 8 }}>{hashtagsError}</div> : null}
                      {hashtags?.length ? (
                        <div className="dash-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                          {hashtags.slice(0, 16).map((h) => (
                            <button
                              key={h}
                              type="button"
                              className="dash-small-btn"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(h)
                                  toast.push({ kind: 'success', title: 'Copied', message: h })
                                } catch {
                                  toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                                }
                              }}
                            >
                              {h}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : source === 'similarweb' && similarwebData ? (
          <div style={{ marginTop: 8 }}>
            <div className="dash-mini-list">
              <div className="dash-mini-item">
                <div className="dash-mini-name" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="dash-badge web">WEB</span>
                  <span>{similarwebData.domain}</span>
                  <span style={{ marginLeft: 'auto' }} className="muted">
                    {similarwebData.country.toUpperCase()}
                  </span>
                </div>
                {similarwebData.latest ? (
                  <div className="dash-mini-meta">
                    Visits: {similarwebData.latest.visits != null ? Math.round(similarwebData.latest.visits).toLocaleString() : '-'} ·
                    Bounce: {similarwebData.latest.bounce_rate != null ? `${Math.round(similarwebData.latest.bounce_rate * 100)}%` : '-'} ·
                    Pages/Visit: {similarwebData.latest.pages_per_visit != null ? similarwebData.latest.pages_per_visit.toFixed(2) : '-'}
                  </div>
                ) : (
                  <div className="muted">No data.</div>
                )}
                <div className="dash-actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="dash-small-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(similarwebData.domain)
                        toast.push({ kind: 'success', title: 'Copied', message: 'Domain disalin' })
                      } catch {
                        toast.push({ kind: 'error', title: 'Gagal copy', message: 'Coba copy manual' })
                      }
                    }}
                  >
                    Copy domain
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="muted">
            {source === 'exploding'
              ? 'Butuh EXPLODING_TOPICS_API_KEY di environment.'
              : source === 'similarweb'
                ? 'Butuh SIMILARWEB_API_KEY di environment.'
                : 'Belum ada data trend.'}
          </div>
        )}

        {watch.length ? (
          <div style={{ marginTop: 14 }}>
            <div className="dash-segment-title" style={{ fontSize: 14 }}>
              Watchlist
            </div>
            <div className="dash-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {watch.slice(0, 16).map((k) => (
                <button key={k} type="button" className="dash-small-btn" onClick={() => void generateCaptions(k)}>
                  {k}
                </button>
              ))}
              <button type="button" className="dash-small-btn" onClick={() => setWatchPersist([])}>
                Clear
              </button>
            </div>
          </div>
        ) : null}
      </div>
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

function OnboardingPanel({ onGoClients }: { onGoClients: () => void }) {
  return (
    <div className="dash-onboard">
      <div className="dash-onboard-hero">
        <div className="dash-onboard-title">Find the Trend</div>
        <div className="dash-onboard-sub">Build · Schedule · Analyze · Report</div>
      </div>
      <FlowDiagram clientsCount={0} connectedAccounts={0} scheduledPosts={0} />
      <TrendRadarPanel clients={[]} />
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

function SettingsPanel({
  agency,
  userRole,
  theme,
  onThemeChange,
  onSaved,
}: {
  agency: { id: string; name: string; logo_url?: string; primary_color?: string } | null
  userRole: string
  theme: 'system' | 'light' | 'dark'
  onThemeChange: (v: 'system' | 'light' | 'dark') => void
  onSaved: (agency: { id: string; name: string; logo_url?: string; primary_color?: string }) => void
}) {
  const toast = useToast()
  const [name, setName] = useState(agency?.name ?? '')
  const [logoURL, setLogoURL] = useState(agency?.logo_url ?? '')
  const [primaryColor, setPrimaryColor] = useState(agency?.primary_color ?? '#5b00ff')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(agency?.name ?? '')
    setLogoURL(agency?.logo_url ?? '')
    setPrimaryColor(agency?.primary_color ?? '#5b00ff')
  }, [agency?.id, agency?.logo_url, agency?.name, agency?.primary_color])

  const canEdit = userRole === 'owner' || userRole === 'admin'

  async function save() {
    if (!canEdit) {
      toast.push({ kind: 'error', title: 'Tidak punya akses', message: 'Role kamu tidak bisa mengubah settings.' })
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const res = await updateAgency({
        name: name.trim() || undefined,
        logo_url: logoURL.trim() || undefined,
        primary_color: primaryColor.trim() || undefined,
      })
      onSaved(res)
      toast.push({ kind: 'success', title: 'Settings tersimpan' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal simpan settings'
      setError(msg)
      toast.push({ kind: 'error', title: 'Gagal simpan', message: msg })
    } finally {
      setIsSaving(false)
    }
  }

  async function uploadLogo(file: File) {
    if (!canEdit) {
      toast.push({ kind: 'error', title: 'Tidak punya akses', message: 'Role kamu tidak bisa mengubah settings.' })
      return
    }
    setIsUploadingLogo(true)
    setError(null)
    try {
      const res = await uploadAgencyLogo(file)
      onSaved(res)
      setLogoURL(res.logo_url ?? '')
      toast.push({ kind: 'success', title: 'Logo tersimpan' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal upload logo'
      setError(msg)
      toast.push({ kind: 'error', title: 'Gagal upload logo', message: msg })
    } finally {
      setIsUploadingLogo(false)
    }
  }

  return (
    <div className="dash-stack">
      <div className="dash-form-card">
        <div className="dash-segment-title">Brand</div>
        <div className="muted">Ubah nama perusahaan/agency, logo, dan warna aksen untuk report.</div>
        <div className="dash-actions" style={{ marginTop: 10, alignItems: 'end' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 220 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: '1px solid var(--dash-border)',
                overflow: 'hidden',
                background: 'var(--dash-soft-bg)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
              }}
            >
              {logoURL.trim() ? <img src={logoURL.trim()} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '—'}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="muted">Logo file</div>
              <input
                type="file"
                accept="image/*"
                disabled={!canEdit || isUploadingLogo}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  void uploadLogo(f)
                  e.currentTarget.value = ''
                }}
              />
            </div>
          </div>
          <label className="field" style={{ minWidth: 240, flex: 1 }}>
            <span>Company Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama perusahaan" />
          </label>
          <label className="field" style={{ minWidth: 340, flex: 2 }}>
            <span>Logo URL</span>
            <input value={logoURL} onChange={(e) => setLogoURL(e.target.value)} placeholder="/trendspire-logo.png atau https://..." />
          </label>
        </div>
        <div className="dash-actions" style={{ marginTop: 10, alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 220 }}>
            <span>Primary Color</span>
            <div className="dash-actions" style={{ gap: 10 }}>
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ width: 54, height: 38, padding: 0, borderRadius: 10 }}
              />
              <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
          </label>
          <button type="button" className="dash-small-btn" disabled={!canEdit || isSaving} onClick={() => void save()}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {error ? <DashNotice {...prettyErrorMessage(error)} /> : null}
      </div>
      <div className="dash-form-card">
        <div className="dash-segment-title">Appearance</div>
        <div className="muted">Atur tampilan dashboard kamu.</div>
        <div className="dash-actions" style={{ marginTop: 10, alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 260 }}>
            <span>Theme</span>
            <select
              value={theme}
              onChange={(e) => onThemeChange((e.target.value as 'system' | 'light' | 'dark') || 'system')}
            >
              <option value="system">Auto (System)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}
