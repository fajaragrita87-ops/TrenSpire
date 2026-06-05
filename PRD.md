# trendSpire - Aplikasi Social Media untuk Advertising
 
## Fitur Utama
1. Advertising bisa login, add client, connect IG/TikTok/X/FB
2. Bikin post + AI caption + schedule
3. Auto-publish ke platform
4. Auto-ambil analytics setiap 15 menit
5. Generate report PDF (logo advertising, bukan logo kita)
6. Client lihat report via link tanpa login
 
## Database (14 Tabel)
- agencies, agency_users, clients, social_accounts
- posts, post_media, post_platform_status, schedules
- analytics_daily, analytics_post, reports
- ai_generations, evergreen_content, audit_logs
 
## Tech Stack
Backend: Go + Gin + GORM + PostgreSQL + Redis + MinIO
Frontend: React + Tailwind + shadcn/ui
Queue: Asynq (Redis)
Deploy: Docker + VPS
 
## API Endpoint Utama
POST /api/v1/auth/register - Daftar advertising
POST /api/v1/auth/login - Login
POST /api/v1/clients - Add client
POST /api/v1/accounts/:platform/connect - Connect IG/TikTok/X/FB
POST /api/v1/posts - Bikin post
POST /api/v1/posts/:id/schedule - Schedule
GET /api/v1/analytics/clients/:id - Lihat analytics
POST /api/v1/reports - Generate report PDF
GET /r/:token - Client lihat report (tanpa login)
 
## Budget API
X API: $30/bulan
OpenAI: $18/bulan
Total: $50/bulan (under $60)
 
## Wireframe
1. Dashboard Advertising: sidebar, stats cards, client list, calendar
2. Client Report: magic link, executive summary, metrics, charts, top posts
3. Post Composer: client selector, platform selector, caption, AI button, preview, schedule
4. Content Calendar: color-coded per client
 
## Phase Build
Minggu 1: Auth + Client + Post + Schedule
Minggu 2: Analytics + Report Generator + Client Viewer
Minggu 3: AI Caption + Polish
Minggu 4: Deploy + Beta Test
