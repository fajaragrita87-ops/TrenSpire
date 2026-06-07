import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { clearAuth, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from './auth'

export type LoginResponse = {
  access_token: string
  token_type: string
  expires_at: string
  refresh_token: string
  refresh_expires_at: string
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
  industry?: string
  location?: string
  created_at: string
  updated_at: string
  social_accounts?: Array<{
    id: string
    client_id: string
    platform: string
    external_account_id?: string
    username?: string
    follower_count: number
    expires_at?: string
    connected_at?: string
    created_at: string
    updated_at: string
  }>
}

export type CreateClientRequest = {
  name: string
  logo_url?: string
  report_brand_name?: string
  industry?: string
  location?: string
}

export type CreateReportResponse = {
  token: string
  magic_link: string
  magic_link_url?: string
  download_url?: string
  expires_at?: string
}

export type Post = {
  id: string
  client_id: string
  client_name: string
  content: string
  platforms: string[]
  status: string
  execute_at?: string | null
  media_urls: string[]
  created_at: string
  updated_at: string
}

export type CreatePostResponse = {
  id: string
  client_id: string
  content: string
  platforms: string[]
  status: string
  created_at: string
  updated_at: string
}

export type SchedulePostResponse = {
  post_id: string
  status: string
  execute_at: string
  schedule_id: string
}

export type CalendarEvent = {
  id: string
  post_id: string
  client_id: string
  client_name: string
  title: string
  start: string
  end: string
  platforms: string[]
  status: string
}

export type AnalyticsPlatform = {
  platform: string
  date: string
  followers: number
  likes: number
  comments: number
  impressions: number
  engagement_rate: number
  wow_growth_pct: number
  mom_growth_pct: number
}

export type AnalyticsDashboardResponse = {
  date: string
  blended: AnalyticsPlatform
  clients_count: number
  alerts_last_24h: number
}

export type AICaptionResponse = {
  variants: string[]
}

export type AIHashtagsResponse = {
  hashtags: string[]
}

export type ReportListItem = {
  token: string
  client_id: string
  client_name: string
  created_at: string
  expires_at?: string | null
  view_count: number
  download_count: number
  magic_link_url: string
  download_url: string
}

export type SocialAccount = {
  id: string
  client_id: string
  platform: string
  external_account_id?: string
  username?: string
  follower_count: number
  expires_at?: string
  connected_at?: string
  created_at: string
  updated_at: string
}

export async function connectAccount(platform: string, clientId: string): Promise<{ auth_url: string }> {
  try {
    const res = await http.post<{ auth_url: string }>(`/api/v1/accounts/${platform}/connect`, { client_id: clientId })
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function listAccounts(clientId: string, platform?: string): Promise<SocialAccount[]> {
  try {
    const params: Record<string, string> = { client_id: clientId }
    if (platform) params.platform = platform
    const res = await http.get<{ data: SocialAccount[] }>('/api/v1/accounts', { params })
    return res.data.data ?? []
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export type RefreshResponse = {
  access_token: string
  token_type: string
  expires_at: string
  refresh_token: string
  refresh_expires_at: string
}

type ApiConfig = InternalAxiosRequestConfig & { auth?: boolean; _retry?: boolean }

const http = axios.create({
  headers: { Accept: 'application/json' },
})

function getErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) return err instanceof Error ? err.message : 'unknown error'
  const e = err as AxiosError<unknown>
  const status = e.response?.status
  if (status === 401) return 'unauthorized'
  const data = e.response?.data
  if (data && typeof data === 'object' && 'error' in data) {
    const apiErr = (data as { error?: unknown }).error
    if (apiErr) return String(apiErr)
  }
  if (e.message) return e.message
  return status ? `HTTP ${status}` : 'network error'
}

let refreshInFlight: Promise<string | null> | null = null

function setAuthorizationHeader(cfg: ApiConfig, token: string): void {
  const headers = cfg.headers as unknown
  if (headers && typeof headers === 'object' && 'set' in headers && typeof (headers as { set: unknown }).set === 'function') {
    ;(headers as { set: (k: string, v: string) => void }).set('Authorization', `Bearer ${token}`)
    return
  }
  const cur = (cfg.headers ?? {}) as unknown as Record<string, unknown>
  cfg.headers = ({ ...cur, Authorization: `Bearer ${token}` } as unknown) as typeof cfg.headers
}

export async function refresh(refreshToken: string): Promise<RefreshResponse> {
  const res = await http.post<RefreshResponse>(
    '/api/v1/auth/refresh',
    { refresh_token: refreshToken },
    { auth: false } as ApiConfig,
  )
  return res.data
}

async function ensureFreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const rt = getRefreshToken()
    if (!rt) return null
    try {
      const rr = await refresh(rt)
      setAccessToken(rr.access_token)
      setRefreshToken(rr.refresh_token)
      return rr.access_token
    } catch {
      clearAuth()
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

http.interceptors.request.use((config) => {
  const cfg = config as ApiConfig
  if (cfg.auth !== false) {
    const token = getAccessToken()
    if (token) {
      setAuthorizationHeader(cfg, token)
    }
  }
  return cfg
})

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) throw error

    const status = error.response?.status
    const cfg = (error.config ?? {}) as ApiConfig
    const url = String(cfg.url ?? '')
    const isAuthEndpoint = url.startsWith('/api/v1/auth/')

    if (status === 401 && cfg.auth !== false && !cfg._retry && !isAuthEndpoint) {
      cfg._retry = true
      const newAccess = await ensureFreshAccessToken()
      if (newAccess) {
        setAuthorizationHeader(cfg, newAccess)
        return http.request(cfg)
      }
    }

    throw new Error(getErrorMessage(error), { cause: error })
  },
)

export async function login(email: string, password: string): Promise<LoginResponse> {
  try {
    const res = await http.post<LoginResponse>(
      '/api/v1/auth/login',
      { email, password },
      { auth: false } as ApiConfig,
    )
    setAccessToken(res.data.access_token)
    setRefreshToken(res.data.refresh_token)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function listClients(): Promise<Client[]> {
  try {
    const res = await http.get<{ data: Client[] }>('/api/v1/clients')
    return res.data.data ?? []
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function createClient(input: CreateClientRequest): Promise<Client> {
  try {
    const res = await http.post<Client>('/api/v1/clients', input)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function updateClient(
  id: string,
  input: Partial<Pick<CreateClientRequest, 'name' | 'logo_url' | 'report_brand_name' | 'industry' | 'location'>>,
): Promise<Client> {
  try {
    const res = await http.patch<Client>(`/api/v1/clients/${id}`, input)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export type ClientTimelineEvent = {
  kind: string
  title: string
  created_at: string
  meta?: Record<string, unknown>
}

export async function clientTimeline(clientId: string, input?: { limit?: number }): Promise<ClientTimelineEvent[]> {
  try {
    const params: Record<string, string | number> = {}
    if (input?.limit) params.limit = input.limit
    const res = await http.get<{ data: ClientTimelineEvent[] }>(`/api/v1/clients/${clientId}/timeline`, { params })
    return res.data.data ?? []
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function createReport(
  clientId: string,
  input?: { start_date?: string; end_date?: string },
): Promise<CreateReportResponse> {
  try {
    const body: Record<string, unknown> = { client_id: clientId }
    if (input?.start_date) body.start_date = input.start_date
    if (input?.end_date) body.end_date = input.end_date
    const res = await http.post<CreateReportResponse>('/api/v1/reports', body)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function listPosts(input?: { client_id?: string; status?: string[]; limit?: number }): Promise<Post[]> {
  try {
    const params: Record<string, string | number> = {}
    if (input?.client_id) params.client_id = input.client_id
    if (input?.limit) params.limit = input.limit
    if (input?.status?.length) params.status = input.status.join(',')
    const res = await http.get<{ data: Post[] }>('/api/v1/posts', { params })
    return res.data.data ?? []
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function createPost(input: {
  client_id: string
  content: string
  platforms: string[]
  media_urls?: string[]
}): Promise<CreatePostResponse> {
  try {
    const res = await http.post<CreatePostResponse>('/api/v1/posts', input)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function schedulePost(postId: string, executeAtISO: string): Promise<SchedulePostResponse> {
  try {
    const res = await http.post<SchedulePostResponse>(`/api/v1/posts/${postId}/schedule`, { execute_at: executeAtISO })
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function publishNow(postId: string): Promise<{ post_id: string; status: string }> {
  try {
    const res = await http.post<{ post_id: string; status: string }>(`/api/v1/posts/${postId}/publish-now`)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function listCalendarPosts(input: { start: string; end: string; client_id?: string }): Promise<CalendarEvent[]> {
  try {
    const params: Record<string, string> = { start: input.start, end: input.end }
    if (input.client_id) params.client_id = input.client_id
    const res = await http.get<{ data: CalendarEvent[] }>('/api/v1/calendar/posts', { params })
    return res.data.data ?? []
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function analyticsDashboard(): Promise<AnalyticsDashboardResponse> {
  try {
    const res = await http.get<AnalyticsDashboardResponse>('/api/v1/analytics/dashboard')
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function aiCaption(input: { content_idea: string; platform: string; tone: string }): Promise<AICaptionResponse> {
  try {
    const res = await http.post<AICaptionResponse>('/api/v1/ai/caption', input)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export type ContentPlanItem = {
  day: number
  platform: string
  title: string
  angle: string
  caption: string
  cta?: string
  hashtags?: string[]
  time?: string
}

export type ContentPlanResponse = {
  items: ContentPlanItem[]
}

export async function aiContentPlan(input: {
  client_id: string
  horizon_days?: number
  platforms?: string[]
}): Promise<ContentPlanResponse> {
  try {
    const res = await http.post<ContentPlanResponse>('/api/v1/ai/content-plan', input)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function aiHashtags(input: { caption: string; niche: string }): Promise<AIHashtagsResponse> {
  try {
    const res = await http.post<AIHashtagsResponse>('/api/v1/ai/hashtags', input)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export async function listReports(input?: { limit?: number; client_id?: string }): Promise<ReportListItem[]> {
  try {
    const params: Record<string, string | number> = {}
    if (input?.limit) params.limit = input.limit
    if (input?.client_id) params.client_id = input.client_id
    const res = await http.get<{ data: ReportListItem[] }>('/api/v1/reports', { params })
    return res.data.data ?? []
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export type CompetitorAnalyzeResponse = {
  data: unknown
}

export async function competitorAnalyze(input: {
  client_id: string
}): Promise<unknown> {
  try {
    const res = await http.post<CompetitorAnalyzeResponse>('/api/v1/competitor/analyze', input)
    return res.data.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}

export type OfflineCampaignCreateResponse = {
  id: string
  file_url: string
  file_mime: string
  status: string
  data: unknown
}

export async function createOfflineCampaign(input: { client_id: string; file: File }): Promise<OfflineCampaignCreateResponse> {
  try {
    const fd = new FormData()
    fd.append('client_id', input.client_id)
    fd.append('file', input.file)
    const res = await http.post<OfflineCampaignCreateResponse>('/api/v1/offline/campaigns', fd)
    return res.data
  } catch (err) {
    throw new Error(getErrorMessage(err), { cause: err })
  }
}
