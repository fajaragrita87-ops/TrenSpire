package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"
	"trendspire/internal/storage"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ReportsHandler struct {
	cfg config.Config
	db  *gorm.DB
}

func NewReportsHandler(cfg config.Config, db *gorm.DB) ReportsHandler {
	return ReportsHandler{cfg: cfg, db: db}
}

type createReportRequest struct {
	ClientID  string `json:"client_id" binding:"required"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

type reportListItem struct {
	Token         string     `json:"token"`
	ClientID      string     `json:"client_id"`
	ClientName    string     `json:"client_name"`
	CreatedAt     time.Time  `json:"created_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
	ViewCount     int64      `json:"view_count"`
	DownloadCount int64      `json:"download_count"`
	MagicLinkURL  string     `json:"magic_link_url"`
	DownloadURL   string     `json:"download_url"`
}

func (h ReportsHandler) CreateReport(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	clientID, err := uuid.Parse(strings.TrimSpace(req.ClientID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	periodStart, periodEnd, err := parseOptionalPeriod(req.StartDate, req.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var agency models.Agency
	if err := h.db.Where("id = ?", authCtx.AgencyID).First(&agency).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "agency not found"})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", clientID, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	reportData, err := h.buildReportData(authCtx.AgencyID, cl.ID, periodStart, periodEnd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "report build failed"})
		return
	}

	accent := normalizeAccentColor(agency.PrimaryColor, authCtx.AgencyID.String())
	html := renderReportHTML(agency, cl, accent, reportData)

	pdfBytes, err := renderPDF(c.Request.Context(), html)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "pdf render failed"})
		return
	}

	up, err := storage.UploadBytesToMinIO(c.Request.Context(), h.cfg, pdfBytes, "application/pdf")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "pdf upload failed"})
		return
	}

	token := strings.ReplaceAll(uuid.NewString(), "-", "")
	now := time.Now().UTC()
	exp := now.AddDate(0, 0, 90)
	r := models.Report{
		AgencyID:    authCtx.AgencyID,
		ClientID:    cl.ID,
		Token:       token,
		PDFURL:      up.URL,
		HTML:        html,
		PeriodStart: periodStart,
		PeriodEnd:   periodEnd,
		CreatedAt:   now,
		ExpiresAt:   &exp,
	}
	if err := h.db.Create(&r).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "report save failed"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token":          r.Token,
		"magic_link":     fmt.Sprintf("/r/%s", r.Token),
		"magic_link_url": buildPublicURL(c, h.cfg, fmt.Sprintf("/r/%s", r.Token)),
		"download_url":   buildPublicURL(c, h.cfg, fmt.Sprintf("/r/%s/download", r.Token)),
		"expires_at":     r.ExpiresAt,
	})
}

func (h ReportsHandler) ListReports(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			if v > 100 {
				v = 100
			}
			limit = v
		}
	}

	var clientID uuid.UUID
	if raw := strings.TrimSpace(c.Query("client_id")); raw != "" {
		clientID, err = uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
	}

	q := h.db.Preload("Client").
		Where("agency_id = ?", authCtx.AgencyID).
		Order("created_at desc").
		Limit(limit)
	if clientID != uuid.Nil {
		q = q.Where("client_id = ?", clientID)
	}

	var rows []models.Report
	if err := q.Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list reports failed"})
		return
	}

	out := make([]reportListItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, reportListItem{
			Token:         r.Token,
			ClientID:      r.ClientID.String(),
			ClientName:    r.Client.Name,
			CreatedAt:     r.CreatedAt,
			ExpiresAt:     r.ExpiresAt,
			ViewCount:     r.ViewCount,
			DownloadCount: r.DownloadCount,
			MagicLinkURL:  buildPublicURL(c, h.cfg, fmt.Sprintf("/r/%s", r.Token)),
			DownloadURL:   buildPublicURL(c, h.cfg, fmt.Sprintf("/r/%s/download", r.Token)),
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h ReportsHandler) View(c *gin.Context) {
	token := strings.TrimSpace(c.Param("token"))
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var r models.Report
	if err := h.db.Where("token = ?", token).First(&r).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	exp := h.ensureReportExpiry(&r)
	if time.Now().UTC().After(exp) {
		c.Data(http.StatusGone, "text/html; charset=utf-8", []byte(renderExpiredHTML()))
		return
	}

	_ = h.db.Model(&models.Report{}).
		Where("id = ?", r.ID).
		UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error

	var agency models.Agency
	if err := h.db.Where("id = ?", r.AgencyID).First(&agency).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", r.ClientID, r.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	d, err := h.buildReportData(r.AgencyID, r.ClientID, r.PeriodStart, r.PeriodEnd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "report build failed"})
		return
	}
	accent := normalizeAccentColor(agency.PrimaryColor, r.AgencyID.String())
	html := renderReportHTML(agency, cl, accent, d)
	html = addClientViewerChrome(token, html)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

func (h ReportsHandler) Download(c *gin.Context) {
	token := strings.TrimSpace(c.Param("token"))
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var r models.Report
	if err := h.db.Where("token = ?", token).First(&r).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	exp := h.ensureReportExpiry(&r)
	if time.Now().UTC().After(exp) {
		c.Data(http.StatusGone, "text/html; charset=utf-8", []byte(renderExpiredHTML()))
		return
	}

	_ = h.db.Model(&models.Report{}).
		Where("id = ?", r.ID).
		UpdateColumn("download_count", gorm.Expr("download_count + 1")).Error

	obj := extractObjectNameFromMinioURL(r.PDFURL)
	if obj == "" {
		c.Redirect(http.StatusFound, r.PDFURL)
		return
	}
	u, err := storage.PresignGetURL(c.Request.Context(), h.cfg, obj, 24*time.Hour)
	if err != nil {
		c.Redirect(http.StatusFound, r.PDFURL)
		return
	}
	c.Redirect(http.StatusFound, u)
}

func (h ReportsHandler) Refresh(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	token := strings.TrimSpace(c.Param("token"))
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var r models.Report
	if err := h.db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("token = ? AND agency_id = ?", token, authCtx.AgencyID).
		First(&r).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	now := time.Now().UTC()
	exp := now.AddDate(0, 0, 90)
	r.ExpiresAt = &exp
	if err := h.db.Model(&models.Report{}).Where("id = ?", r.ID).Update("expires_at", exp).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "refresh failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":          r.Token,
		"magic_link":     fmt.Sprintf("/r/%s", r.Token),
		"magic_link_url": buildPublicURL(c, h.cfg, fmt.Sprintf("/r/%s", r.Token)),
		"download_url":   buildPublicURL(c, h.cfg, fmt.Sprintf("/r/%s/download", r.Token)),
		"expires_at":     r.ExpiresAt,
		"view_count":     r.ViewCount,
		"download_count": r.DownloadCount,
	})
}

type reportData struct {
	ExecutiveSummary  string
	Recommendation    string
	KeyMetrics        keyMetrics
	DailySeries       []dailyPoint
	PlatformBreakdown []platformPoint
	TopPosts          []topPost
	CompetitorInsight map[string]any
	OfflineCampaign   map[string]any
	ContentPlan       map[string]any
}

type keyMetrics struct {
	Followers      int64
	Reach          int64
	Engagements    int64
	EngagementRate float64
	WoWGrowthPct   float64
	MoMGrowthPct   float64
}

type dailyPoint struct {
	Date        string
	Followers   int64
	Impressions int64
	Engagements int64
}

type platformPoint struct {
	Platform    string
	Impressions int64
}

type topPost struct {
	Content     string
	Platform    string
	Likes       int64
	Comments    int64
	Impressions int64
}

func (h ReportsHandler) buildReportData(agencyID, clientID uuid.UUID, periodStart, periodEnd *time.Time) (reportData, error) {
	end := utcDate(time.Now().UTC())
	start := end.AddDate(0, 0, -29)
	if periodEnd != nil {
		end = utcDate(periodEnd.UTC())
	}
	if periodStart != nil {
		start = utcDate(periodStart.UTC())
	}
	if start.After(end) {
		start = end.AddDate(0, 0, -29)
	}

	rows := []models.AnalyticsDaily{}
	if err := h.db.Where("agency_id = ? AND client_id = ? AND date >= ? AND date <= ?", agencyID, clientID, start, end).
		Find(&rows).Error; err != nil {
		return reportData{}, err
	}

	byDate := map[string]*dailyPoint{}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		k := d.Format("2006-01-02")
		byDate[k] = &dailyPoint{Date: k}
	}

	platformImpr := map[string]int64{}
	var followers int64
	var reach int64
	var engagements int64
	var wow float64
	var mom float64

	for _, r := range rows {
		k := r.Date.Format("2006-01-02")
		p := byDate[k]
		if p != nil {
			p.Impressions += r.Impressions
			p.Engagements += r.Likes + r.Comments
			if r.Date.Equal(end) {
				p.Followers += r.Followers
			}
		}
		platformImpr[strings.ToLower(strings.TrimSpace(r.Platform))] += r.Impressions
		if r.Date.Equal(end) {
			followers += r.Followers
			reach += r.Impressions
			engagements += r.Likes + r.Comments
			wow += r.WoWGrowthPct
			mom += r.MoMGrowthPct
		}
	}

	series := make([]dailyPoint, 0, len(byDate))
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		series = append(series, *byDate[d.Format("2006-01-02")])
	}

	breakdown := make([]platformPoint, 0, len(platformImpr))
	for platform, impr := range platformImpr {
		if platform == "" {
			continue
		}
		breakdown = append(breakdown, platformPoint{Platform: platform, Impressions: impr})
	}
	sort.Slice(breakdown, func(i, j int) bool { return breakdown[i].Impressions > breakdown[j].Impressions })

	er := 0.0
	if reach > 0 {
		er = float64(engagements) / float64(reach)
	}

	top := h.findTopPosts(agencyID, clientID)

	exec := generateExecutiveSummary(followers, reach, engagements, er)
	rec := generateRecommendation(er, breakdown)

	comp := h.fetchLatestCompetitorInsight(agencyID, clientID)
	offline := h.fetchLatestOfflineCampaign(agencyID, clientID)
	plan := h.fetchLatestContentPlan(agencyID, clientID)

	return reportData{
		ExecutiveSummary: exec,
		Recommendation:   rec,
		KeyMetrics: keyMetrics{
			Followers:      followers,
			Reach:          reach,
			Engagements:    engagements,
			EngagementRate: er,
			WoWGrowthPct:   wow,
			MoMGrowthPct:   mom,
		},
		DailySeries:       series,
		PlatformBreakdown: breakdown,
		TopPosts:          top,
		CompetitorInsight: comp,
		OfflineCampaign:   offline,
		ContentPlan:       plan,
	}, nil
}

func (h ReportsHandler) fetchLatestCompetitorInsight(agencyID, clientID uuid.UUID) map[string]any {
	var row models.CompetitorAnalysis
	if err := h.db.
		Where("agency_id = ? AND client_id = ?", agencyID, clientID).
		Order("created_at desc").
		First(&row).Error; err != nil {
		return nil
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(row.Output), &out); err != nil {
		return nil
	}
	return out
}

func (h ReportsHandler) fetchLatestOfflineCampaign(agencyID, clientID uuid.UUID) map[string]any {
	var row models.OfflineCampaign
	if err := h.db.
		Where("agency_id = ? AND client_id = ?", agencyID, clientID).
		Order("created_at desc").
		First(&row).Error; err != nil {
		return nil
	}
	if len(row.Extracted) == 0 || !json.Valid(row.Extracted) {
		return nil
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(row.Extracted), &out); err != nil {
		return nil
	}
	return out
}

func (h ReportsHandler) fetchLatestContentPlan(agencyID, clientID uuid.UUID) map[string]any {
	var row models.AIGeneration
	if err := h.db.
		Where("agency_id = ? AND kind = ? AND input->>'client_id' = ?", agencyID, "content_plan", clientID.String()).
		Order("created_at desc").
		First(&row).Error; err != nil {
		return nil
	}
	if len(row.Output) == 0 || !json.Valid(row.Output) {
		return nil
	}
	out := map[string]any{}
	if err := json.Unmarshal(row.Output, &out); err != nil {
		return nil
	}
	return out
}

func (h ReportsHandler) findTopPosts(agencyID, clientID uuid.UUID) []topPost {
	type row struct {
		Platform    string
		Likes       int64
		Comments    int64
		Impressions int64
		Content     string
	}
	out := []row{}
	_ = h.db.Raw(
		`select ap.platform, ap.likes, ap.comments, ap.impressions, p.content
		   from analytics_posts ap
		   join posts p on p.id = ap.post_id
		  where ap.agency_id = ? and ap.client_id = ?
		  order by (ap.likes + ap.comments) desc, ap.impressions desc
		  limit 3`,
		agencyID, clientID,
	).Scan(&out).Error

	if len(out) == 0 {
		type prow struct {
			Content   string
			Platforms string
		}
		fallback := []prow{}
		_ = h.db.Raw(
			`select content, platforms::text as platforms
			   from posts
			  where agency_id = ? and client_id = ?
			  order by created_at desc
			  limit 3`,
			agencyID, clientID,
		).Scan(&fallback).Error
		res := make([]topPost, 0, len(fallback))
		for _, r := range fallback {
			res = append(res, topPost{Content: r.Content, Platform: "multi"})
		}
		return res
	}

	res := make([]topPost, 0, len(out))
	for _, r := range out {
		res = append(res, topPost{
			Content:     r.Content,
			Platform:    r.Platform,
			Likes:       r.Likes,
			Comments:    r.Comments,
			Impressions: r.Impressions,
		})
	}
	return res
}

func renderPDF(ctx context.Context, html string) ([]byte, error) {
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.NoSandbox,
		chromedp.DisableGPU,
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-dev-shm-usage", true),
	)
	if p := strings.TrimSpace(os.Getenv("CHROME_BIN")); p != "" {
		opts = append(opts, chromedp.ExecPath(p))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	ctxt, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	ctxt, cancel = context.WithTimeout(ctxt, 25*time.Second)
	defer cancel()

	dataURL := "data:text/html;base64," + base64.StdEncoding.EncodeToString([]byte(html))
	var pdf []byte

	err := chromedp.Run(ctxt,
		chromedp.Navigate(dataURL),
		chromedp.WaitReady("body", chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPaperWidth(8.27).
				WithPaperHeight(11.69).
				WithMarginTop(0.39).
				WithMarginBottom(0.39).
				WithMarginLeft(0.39).
				WithMarginRight(0.39).
				Do(ctx)
			if err != nil {
				return err
			}
			pdf = buf
			return nil
		}),
	)
	if err != nil {
		return nil, err
	}
	if len(pdf) == 0 {
		return nil, fmt.Errorf("empty pdf")
	}
	return pdf, nil
}

func renderViewerHTML(token, pdfURL string) string {
	tok := strings.ReplaceAll(strings.TrimSpace(token), `"`, "")
	return fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Report</title>
  <style>
    body{margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial}
    .top{position:sticky;top:0;background:#fff;border-bottom:1px solid #eee;padding:12px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between}
    .btn{display:inline-block;padding:10px 12px;border-radius:10px;border:1px solid #ddd;text-decoration:none;color:#111;font-weight:600}
    .wrap{height:calc(100vh - 58px)}
    iframe{width:100%%;height:100%%;border:0}
  </style>
</head>
<body>
  <div class="top">
    <div>Report</div>
    <a class="btn" href="/r/%s/download" download>Download PDF</a>
  </div>
  <div class="wrap">
    <iframe src="/r/%s/download"></iframe>
  </div>
</body>
</html>`, tok, tok)
}

func renderReportHTML(agency models.Agency, client models.Client, accent string, d reportData) string {
	brandName := strings.TrimSpace(agency.Name)
	if brandName == "" {
		brandName = "Agency"
	}
	clientName := strings.TrimSpace(client.Name)
	if clientName == "" {
		clientName = "Client"
	}

	logo := strings.TrimSpace(agency.LogoURL)
	logoHTML := ""
	if logo != "" {
		logoHTML = fmt.Sprintf(`<img src="%s" alt="%s" style="height:36px;width:auto;display:block" />`, htmlEscapeAttr(logo), htmlEscapeAttr(brandName))
	} else {
		logoHTML = fmt.Sprintf(`<div style="font-weight:800;font-size:18px">%s</div>`, htmlEscapeText(brandName))
	}

	key := d.KeyMetrics
	wow := fmt.Sprintf("%.1f%%", key.WoWGrowthPct*100)
	mom := fmt.Sprintf("%.1f%%", key.MoMGrowthPct*100)
	er := fmt.Sprintf("%.2f%%", key.EngagementRate*100)

	lineSVG := renderLineChartSVG(d.DailySeries, accent)
	pieSVG := renderPieSVG(d.PlatformBreakdown, accent)

	topPostsHTML := ""
	for i, p := range d.TopPosts {
		if i >= 3 {
			break
		}
		topPostsHTML += fmt.Sprintf(
			`<div class="card">
        <div class="muted">%s</div>
        <div class="post">%s</div>
        <div class="muted">Likes %d · Comments %d · Impressions %d</div>
      </div>`,
			strings.ToUpper(htmlEscapeText(p.Platform)),
			htmlEscapeText(p.Content),
			p.Likes, p.Comments, p.Impressions,
		)
	}
	if topPostsHTML == "" {
		topPostsHTML = `<div class="muted">No post analytics yet.</div>`
	}

	now := time.Now().UTC().Format("2006-01-02")

	asStringSlice := func(v any) []string {
		arr, ok := v.([]any)
		if !ok {
			return nil
		}
		out := make([]string, 0, len(arr))
		for _, it := range arr {
			s, ok := it.(string)
			if ok {
				s = strings.TrimSpace(s)
				if s != "" {
					out = append(out, s)
				}
			}
		}
		return out
	}

	compHTML := ""
	if d.CompetitorInsight != nil {
		qw := asStringSlice(d.CompetitorInsight["quick_wins_7_days"])
		oppArr, _ := d.CompetitorInsight["opportunities"].([]any)

		qwHTML := ""
		if len(qw) > 0 {
			qwHTML += `<div class="h2">Quick Wins (7 days)</div><ul style="margin:0;padding-left:18px;display:grid;gap:6px">`
			for i := 0; i < len(qw) && i < 8; i++ {
				qwHTML += `<li>` + htmlEscapeText(qw[i]) + `</li>`
			}
			qwHTML += `</ul>`
		}

		oppHTML := ""
		if len(oppArr) > 0 {
			oppHTML += `<div class="h2">Opportunities</div><div style="display:grid;gap:10px">`
			for i := 0; i < len(oppArr) && i < 4; i++ {
				m, ok := oppArr[i].(map[string]any)
				if !ok {
					continue
				}
				title, _ := m["opportunity"].(string)
				steps, _ := m["first_steps"].(string)
				title = strings.TrimSpace(title)
				steps = strings.TrimSpace(steps)
				if title == "" && steps == "" {
					continue
				}
				oppHTML += `<div class="card" style="padding:12px;border:1px solid #eee;border-radius:14px">`
				if title != "" {
					oppHTML += `<div style="font-weight:800">` + htmlEscapeText(title) + `</div>`
				}
				if steps != "" {
					oppHTML += `<div class="muted" style="margin-top:6px">` + htmlEscapeText(steps) + `</div>`
				}
				oppHTML += `</div>`
			}
			oppHTML += `</div>`
		}

		if qwHTML != "" || oppHTML != "" {
			compHTML = `<div class="card"><div class="h2">Competitor Insight</div>` + qwHTML + `<div style="height:12px"></div>` + oppHTML + `</div>`
		}
	}

	offlineHTML := ""
	if d.OfflineCampaign != nil {
		campaign, _ := d.OfflineCampaign["campaign"].(map[string]any)
		assetsArr, _ := d.OfflineCampaign["assets"].([]any)

		cName, _ := campaign["name"].(string)
		cObj, _ := campaign["objective"].(string)
		cLoc, _ := campaign["location"].(string)
		cStart, _ := campaign["start_date"].(string)
		cEnd, _ := campaign["end_date"].(string)

		cName = strings.TrimSpace(cName)
		cObj = strings.TrimSpace(cObj)
		cLoc = strings.TrimSpace(cLoc)
		cStart = strings.TrimSpace(cStart)
		cEnd = strings.TrimSpace(cEnd)

		head := ""
		if cName != "" {
			head += `<div style="font-weight:900;font-size:14px">` + htmlEscapeText(cName) + `</div>`
		}
		meta := ""
		if cObj != "" || cLoc != "" || cStart != "" || cEnd != "" {
			parts := make([]string, 0, 4)
			if cObj != "" {
				parts = append(parts, htmlEscapeText(cObj))
			}
			if cLoc != "" {
				parts = append(parts, htmlEscapeText(cLoc))
			}
			if cStart != "" {
				if cEnd != "" {
					parts = append(parts, htmlEscapeText(cStart+" → "+cEnd))
				} else {
					parts = append(parts, htmlEscapeText(cStart))
				}
			}
			if len(parts) > 0 {
				meta = `<div class="muted" style="margin-top:6px">` + strings.Join(parts, " · ") + `</div>`
			}
		}

		assetsHTML := ""
		if len(assetsArr) > 0 {
			assetsHTML += `<div class="h2" style="margin-top:12px">Assets</div><ul style="margin:0;padding-left:18px;display:grid;gap:6px">`
			n := 0
			for i := 0; i < len(assetsArr) && n < 10; i++ {
				m, ok := assetsArr[i].(map[string]any)
				if !ok {
					continue
				}
				desc, _ := m["description"].(string)
				typ, _ := m["type"].(string)
				desc = strings.TrimSpace(desc)
				typ = strings.TrimSpace(typ)
				if desc == "" {
					desc = typ
				}
				if desc == "" {
					continue
				}
				assetsHTML += `<li>` + htmlEscapeText(desc) + `</li>`
				n++
			}
			assetsHTML += `</ul>`
		}

		if head != "" || meta != "" || assetsHTML != "" {
			offlineHTML = `<div class="card"><div class="h2">Offline Campaign</div>` + head + meta + assetsHTML + `</div>`
		}
	}

	planHTML := ""
	if d.ContentPlan != nil {
		itemsArr, _ := d.ContentPlan["items"].([]any)
		if len(itemsArr) > 0 {
			planHTML += `<div class="grid" style="grid-template-columns:1fr; margin-top:14px"><div class="card"><div class="h2">Next Actions (Content Plan)</div>`
			planHTML += `<ul style="margin:0;padding-left:18px;display:grid;gap:6px">`
			n := 0
			for i := 0; i < len(itemsArr) && n < 7; i++ {
				m, ok := itemsArr[i].(map[string]any)
				if !ok {
					continue
				}
				platform, _ := m["platform"].(string)
				title, _ := m["title"].(string)
				angle, _ := m["angle"].(string)
				tm, _ := m["time"].(string)
				platform = strings.TrimSpace(platform)
				title = strings.TrimSpace(title)
				angle = strings.TrimSpace(angle)
				tm = strings.TrimSpace(tm)
				labelParts := make([]string, 0, 3)
				if platform != "" {
					labelParts = append(labelParts, platform)
				}
				if tm != "" {
					labelParts = append(labelParts, tm)
				}
				label := strings.Join(labelParts, " · ")
				bodyParts := make([]string, 0, 2)
				if title != "" {
					bodyParts = append(bodyParts, htmlEscapeText(title))
				}
				if angle != "" {
					bodyParts = append(bodyParts, `<span class="muted">`+htmlEscapeText(angle)+`</span>`)
				}
				body := strings.Join(bodyParts, ` · `)
				if body == "" {
					continue
				}
				if label != "" {
					planHTML += `<li><span class="muted">` + htmlEscapeText(label) + `</span> — ` + body + `</li>`
				} else {
					planHTML += `<li>` + body + `</li>`
				}
				n++
			}
			planHTML += `</ul></div></div>`
		}
	}

	insightGrid := ""
	if compHTML != "" || offlineHTML != "" {
		cols := "1fr"
		if compHTML != "" && offlineHTML != "" {
			cols = "1fr 1fr"
		}
		insightGrid = fmt.Sprintf(`<div class="grid" style="grid-template-columns:%s; margin-top:14px">%s%s</div>`, cols, compHTML, offlineHTML)
	}
	tailHTML := insightGrid + planHTML

	anglesHTML := renderReportAnglesHTML(generateReportAngles(client, d))

	return fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>%s Report</title>
  <style>
    :root{--accent:%s}
    body{margin:0;background:#f7f7fb;color:#111;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial}
    .page{max-width:920px;margin:0 auto;padding:24px}
    .header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 18px;border-radius:16px;background:#fff}
    .title{font-size:22px;font-weight:800;margin:0}
    .muted{color:#6b7280;font-size:12px}
    .grid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px}
    @media(min-width:860px){.grid{grid-template-columns:1.2fr .8fr}}
    .card{background:#fff;border-radius:16px;padding:16px}
    .h2{font-size:14px;font-weight:800;margin:0 0 10px 0}
    .kpi{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
    .k{border:1px solid #eee;border-radius:14px;padding:12px}
    .kv{font-size:18px;font-weight:900;margin-top:6px}
    .pill{display:inline-block;background:color-mix(in srgb, var(--accent), #fff 70%%);color:#111;border-radius:999px;padding:6px 10px;font-weight:700;font-size:12px}
    .chart{width:100%%;height:auto}
    .post{font-size:13px;line-height:1.4;margin:6px 0}
    .angles{display:grid;grid-template-columns:1fr;gap:12px}
    @media(min-width:860px){.angles{grid-template-columns:1fr 1fr}}
    .angle{border:1px solid #eee;border-radius:14px;padding:12px}
    .angle-title{font-weight:900;font-size:13px}
    .angle-line{font-size:13px;line-height:1.55;margin-top:6px}
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div style="display:flex;align-items:center;gap:12px">
        %s
        <div>
          <div class="muted">%s</div>
          <h1 class="title">%s Analytics Report</h1>
        </div>
      </div>
      <div style="text-align:right">
        <div class="pill">White-label</div>
        <div class="muted">%s</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="h2">Executive Summary</div>
        <div style="font-size:13px;line-height:1.55">%s</div>
      </div>
      <div class="card">
        <div class="h2">Key Metrics</div>
        <div class="kpi">
          <div class="k"><div class="muted">Followers</div><div class="kv">%d</div><div class="muted">WoW %s · MoM %s</div></div>
          <div class="k"><div class="muted">Reach</div><div class="kv">%d</div><div class="muted">Impressions</div></div>
          <div class="k"><div class="muted">Engagement</div><div class="kv">%d</div><div class="muted">Likes + Comments</div></div>
          <div class="k"><div class="muted">Engagement Rate</div><div class="kv">%s</div><div class="muted">Engagement / Reach</div></div>
        </div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr; margin-top:14px">
      <div class="card">
        <div class="h2">Growth Chart (30 days)</div>
        %s
      </div>
    </div>

    <div class="grid" style="margin-top:14px">
      <div class="card">
        <div class="h2">Platform Breakdown</div>
        %s
      </div>
      <div class="card">
        <div class="h2">Top 3 Posts</div>
        <div style="display:grid;gap:10px">%s</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr; margin-top:14px">
      <div class="card">
        <div class="h2">AI Recommendation</div>
        <div style="font-size:13px;line-height:1.55">%s</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr; margin-top:14px">
      <div class="card">
        <div class="h2">Insight Angles (Client-ready)</div>
        %s
      </div>
    </div>

    %s
  </div>
</body>
</html>`,
		htmlEscapeText(clientName),
		accent,
		logoHTML,
		htmlEscapeText(brandName),
		htmlEscapeText(clientName),
		now,
		htmlEscapeText(d.ExecutiveSummary),
		key.Followers, wow, mom,
		key.Reach,
		key.Engagements,
		er,
		lineSVG,
		pieSVG,
		topPostsHTML,
		htmlEscapeText(d.Recommendation),
		anglesHTML,
		tailHTML,
	)
}

type reportAngle struct {
	Title      string
	ClientLine string
	KeyPoints  []string
	NextSteps  []string
}

func generateReportAngles(client models.Client, d reportData) []reportAngle {
	name := strings.TrimSpace(client.Name)
	if name == "" {
		name = "brand"
	}

	key := d.KeyMetrics
	erPct := key.EngagementRate * 100
	erBand := "perlu ditingkatkan"
	if erPct >= 5.0 {
		erBand = "kuat"
	} else if erPct >= 2.0 {
		erBand = "cukup sehat"
	}

	topPlatform := ""
	topPlatformShare := 0.0
	totalImpr := int64(0)
	for _, p := range d.PlatformBreakdown {
		totalImpr += p.Impressions
	}
	if len(d.PlatformBreakdown) > 0 {
		topPlatform = strings.TrimSpace(d.PlatformBreakdown[0].Platform)
		if totalImpr > 0 {
			topPlatformShare = float64(d.PlatformBreakdown[0].Impressions) / float64(totalImpr) * 100
		}
	}

	topPostSnippets := make([]string, 0, 3)
	for i := 0; i < len(d.TopPosts) && i < 3; i++ {
		s := strings.TrimSpace(d.TopPosts[i].Content)
		if s == "" {
			continue
		}
		r := []rune(s)
		if len(r) > 120 {
			s = string(r[:120]) + "…"
		}
		if p := strings.TrimSpace(d.TopPosts[i].Platform); p != "" {
			s = strings.ToUpper(p) + ": " + s
		}
		topPostSnippets = append(topPostSnippets, s)
	}

	exec := reportAngle{
		Title:      "Business Impact",
		ClientLine: fmt.Sprintf("Untuk %s, performa 30 hari terakhir menunjukkan reach %d dengan engagement rate %s (kategori: %s).", name, key.Reach, fmt.Sprintf("%.2f%%", erPct), erBand),
		KeyPoints: []string{
			fmt.Sprintf("Reach (impressions) tercatat %d dan engagement %d (likes+comments).", key.Reach, key.Engagements),
			"Fokus optimasi: tingkatkan engagement per impresi lewat format konten yang terbukti memicu respons.",
		},
		NextSteps: []string{
			"Tracking KPI mingguan: ER, saves/shares (jika tersedia), dan impresi per posting.",
			"Uji 2–3 variasi hook + CTA untuk menaikkan ER tanpa menurunkan reach.",
		},
	}

	channel := reportAngle{
		Title:      "Channel Focus",
		ClientLine: "Prioritas channel ditentukan dari kontribusi impresi dan ruang optimasi engagement di tiap platform.",
		KeyPoints: func() []string {
			out := []string{}
			if topPlatform != "" && topPlatformShare > 0 {
				out = append(out, fmt.Sprintf("Platform utama saat ini: %s (±%.0f%% dari total impressions).", strings.ToUpper(topPlatform), topPlatformShare))
			} else if topPlatform != "" {
				out = append(out, fmt.Sprintf("Platform utama saat ini: %s.", strings.ToUpper(topPlatform)))
			} else {
				out = append(out, "Belum ada breakdown platform yang cukup untuk menentukan channel utama.")
			}
			out = append(out, "Gunakan 1 platform sebagai growth engine, 1 platform sebagai support untuk eksperimen format.")
			return out
		}(),
		NextSteps: []string{
			"Alokasi effort: 70%% di platform utama, 30%% untuk eksperimen format di platform kedua.",
			"Review performa per platform setiap 7 hari: impresi per konten + ER per konten.",
		},
	}

	creative := reportAngle{
		Title:      "Creative & Messaging",
		ClientLine: "Kita ulangi pola kreatif yang sudah terbukti di top posts, lalu sistematisasikan jadi seri konten.",
		KeyPoints: func() []string {
			out := []string{}
			if len(topPostSnippets) > 0 {
				out = append(out, "Konten yang paling menarik audience (sample):")
				out = append(out, topPostSnippets...)
			} else {
				out = append(out, "Belum ada data top posts; mulai dari 3 format aman: edukasi singkat, before/after, dan social proof.")
			}
			out = append(out, "Bangun konsistensi: 1 tema besar → 3 variasi angle → 1 CTA yang jelas.")
			return out
		}(),
		NextSteps: []string{
			"Buat 2 seri konten mingguan (mis: tips cepat + studi kasus) dengan format tetap.",
			"Standarisasi: hook 1 kalimat, proof 1 poin, CTA 1 aksi.",
		},
	}

	competitor := reportAngle{
		Title:      "Competitive Angle",
		ClientLine: "Kita jadikan insight kompetitor sebagai pemetaan peluang: cepat dieksekusi + jelas dampaknya.",
		KeyPoints: func() []string {
			out := []string{}
			var qw []any
			if d.CompetitorInsight != nil {
				qw, _ = d.CompetitorInsight["quick_wins_7_days"].([]any)
			}
			if len(qw) > 0 {
				out = append(out, "Quick wins dari competitor insight:")
				for i := 0; i < len(qw) && i < 3; i++ {
					if s, ok := qw[i].(string); ok {
						s = strings.TrimSpace(s)
						if s != "" {
							out = append(out, s)
						}
					}
				}
			} else {
				out = append(out, "Belum ada competitor insight terbaru; sementara pakai benchmark: positioning, offer, dan format konten kompetitor teratas.")
			}
			out = append(out, "Tujuan: diferensiasi yang gampang dipahami klien dalam 1 kalimat.")
			return out
		}(),
		NextSteps: []string{
			"Ambil 1 gap kompetitor: angle yang mereka tidak kuasai namun relevan untuk audience.",
			"Eksekusi 3 konten 'counter-positioning' minggu ini (claim → proof → CTA).",
		},
	}

	execution := reportAngle{
		Title:      "Execution (7 Days)",
		ClientLine: "Rencana 7 hari difokuskan ke output: konten jalan, learning cepat, dan angka bisa dievaluasi.",
		KeyPoints: func() []string {
			out := []string{"Target 7 hari: konsistensi + peningkatan ER lewat eksperimen hook dan format."}
			var itemsArr []any
			if d.ContentPlan != nil {
				itemsArr, _ = d.ContentPlan["items"].([]any)
			}
			if len(itemsArr) > 0 {
				out = append(out, "Prioritas action dari content plan:")
				n := 0
				for i := 0; i < len(itemsArr) && n < 3; i++ {
					m, ok := itemsArr[i].(map[string]any)
					if !ok {
						continue
					}
					platform, _ := m["platform"].(string)
					title, _ := m["title"].(string)
					platform = strings.TrimSpace(platform)
					title = strings.TrimSpace(title)
					line := strings.TrimSpace(strings.Trim(strings.Join([]string{platform, title}, " · "), "· "))
					if line != "" {
						out = append(out, line)
						n++
					}
				}
			}
			return out
		}(),
		NextSteps: []string{
			"Day 1–2: produksi 3 konten (2 format utama + 1 eksperimen).",
			"Day 3–7: posting + evaluasi harian (impressions/ER) → iterasi hook.",
		},
	}

	return []reportAngle{exec, channel, creative, competitor, execution}
}

func renderReportAnglesHTML(angles []reportAngle) string {
	if len(angles) == 0 {
		return `<div class="muted">No insights yet.</div>`
	}
	html := `<div class="angles">`
	for _, a := range angles {
		if strings.TrimSpace(a.Title) == "" && strings.TrimSpace(a.ClientLine) == "" && len(a.KeyPoints) == 0 && len(a.NextSteps) == 0 {
			continue
		}
		html += `<div class="angle">`
		if strings.TrimSpace(a.Title) != "" {
			html += `<div class="angle-title">` + htmlEscapeText(a.Title) + `</div>`
		}
		if strings.TrimSpace(a.ClientLine) != "" {
			html += `<div class="angle-line">` + htmlEscapeText(a.ClientLine) + `</div>`
		}
		if len(a.KeyPoints) > 0 {
			html += `<div style="height:8px"></div><div class="muted">Key points</div><ul style="margin:6px 0 0;padding-left:18px;display:grid;gap:6px">`
			for i := 0; i < len(a.KeyPoints) && i < 6; i++ {
				s := strings.TrimSpace(a.KeyPoints[i])
				if s == "" {
					continue
				}
				html += `<li>` + htmlEscapeText(s) + `</li>`
			}
			html += `</ul>`
		}
		if len(a.NextSteps) > 0 {
			html += `<div style="height:10px"></div><div class="muted">Next steps</div><ul style="margin:6px 0 0;padding-left:18px;display:grid;gap:6px">`
			for i := 0; i < len(a.NextSteps) && i < 6; i++ {
				s := strings.TrimSpace(a.NextSteps[i])
				if s == "" {
					continue
				}
				html += `<li>` + htmlEscapeText(s) + `</li>`
			}
			html += `</ul>`
		}
		html += `</div>`
	}
	html += `</div>`
	return html
}

func renderLineChartSVG(series []dailyPoint, accent string) string {
	if len(series) == 0 {
		return `<div class="muted">No data.</div>`
	}

	maxV := int64(0)
	for _, p := range series {
		if p.Impressions > maxV {
			maxV = p.Impressions
		}
	}
	if maxV <= 0 {
		maxV = 1
	}

	w := 860.0
	h := 220.0
	padX := 20.0
	padY := 20.0

	step := (w - padX*2) / float64(max(1, len(series)-1))
	path := ""
	for i, p := range series {
		x := padX + float64(i)*step
		y := padY + (h-padY*2)*(1.0-float64(p.Impressions)/float64(maxV))
		if i == 0 {
			path += fmt.Sprintf("M %.2f %.2f", x, y)
		} else {
			path += fmt.Sprintf(" L %.2f %.2f", x, y)
		}
	}

	return fmt.Sprintf(`<svg class="chart" viewBox="0 0 %.0f %.0f" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="%.0f" height="%.0f" fill="#ffffff" rx="14" />
  <path d="%s" fill="none" stroke="%s" stroke-width="3" />
</svg>`, w, h, w, h, path, accent)
}

func renderPieSVG(parts []platformPoint, accent string) string {
	total := int64(0)
	for _, p := range parts {
		total += p.Impressions
	}
	if total <= 0 {
		return `<div class="muted">No data.</div>`
	}

	colors := []string{
		accent,
		"#111827",
		"#10b981",
		"#f59e0b",
		"#3b82f6",
	}
	r := 72.0
	cx := 90.0
	cy := 90.0
	start := 0.0
	slices := ""
	legend := ""

	for i, p := range parts {
		if i >= 5 {
			break
		}
		frac := float64(p.Impressions) / float64(total)
		angle := frac * 2 * math.Pi
		end := start + angle
		x1 := cx + r*math.Cos(start)
		y1 := cy + r*math.Sin(start)
		x2 := cx + r*math.Cos(end)
		y2 := cy + r*math.Sin(end)
		large := 0
		if angle > math.Pi {
			large = 1
		}
		col := colors[i%len(colors)]
		slices += fmt.Sprintf(`<path d="M %.2f %.2f L %.2f %.2f A %.2f %.2f 0 %d 1 %.2f %.2f Z" fill="%s"/>`, cx, cy, x1, y1, r, r, large, x2, y2, col)
		legend += fmt.Sprintf(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:3px;background:%s;display:inline-block"></span><span class="muted">%s</span></div>`, col, strings.ToUpper(htmlEscapeText(p.Platform)))
		start = end
	}

	return fmt.Sprintf(`<div style="display:flex;gap:14px;align-items:center">
  <svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">%s</svg>
  <div style="display:grid;gap:6px">%s</div>
</div>`, slices, legend)
}

func generateExecutiveSummary(followers, reach, engagements int64, er float64) string {
	return fmt.Sprintf("Dalam 30 hari terakhir, performa menunjukkan reach %d dengan total engagement %d. Followers saat ini %d, dengan engagement rate %.2f%%. Fokus utama report ini adalah menjaga konsistensi konten dan meningkatkan interaksi melalui format yang lebih engaging.", reach, engagements, followers, er*100)
}

func generateRecommendation(er float64, breakdown []platformPoint) string {
	main := "platform utama"
	if len(breakdown) > 0 {
		main = strings.ToUpper(breakdown[0].Platform)
	}
	if er < 0.02 {
		return fmt.Sprintf("Engagement rate masih rendah. Coba tingkatkan konten interaktif (poll, Q&A, carousel), perkuat hook di 2 detik pertama, dan gunakan CTA yang jelas. Prioritaskan eksperimen di %s, lalu replikasi format yang menang ke platform lain.", main)
	}
	if er < 0.05 {
		return fmt.Sprintf("Engagement rate sudah cukup baik. Tingkatkan konsistensi posting dan variasikan format (reels/shorts, carousel, behind-the-scenes). Optimalkan jam posting di %s dan ulangi konten top-performer dengan angle baru.", main)
	}
	return fmt.Sprintf("Engagement rate kuat. Fokus scaling: jadwalkan seri konten mingguan, kolaborasi dengan micro-influencer, dan dorong UGC. Pertahankan ritme dan optimalkan distribusi di %s.", main)
}

func deriveAccentColor(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	h := int(sum[0]) % 360
	s := 70
	l := 45
	return fmt.Sprintf("hsl(%d %d%% %d%%)", h, s, l)
}

func normalizeAccentColor(input, fallbackSeed string) string {
	in := strings.ToLower(strings.TrimSpace(input))
	if in == "" {
		return deriveAccentColor(fallbackSeed)
	}
	if strings.HasPrefix(in, "#") {
		hex := strings.TrimPrefix(in, "#")
		if len(hex) == 3 || len(hex) == 6 {
			for _, r := range hex {
				if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
					continue
				}
				return deriveAccentColor(fallbackSeed)
			}
			return "#" + hex
		}
		return deriveAccentColor(fallbackSeed)
	}
	if strings.HasPrefix(in, "hsl(") && strings.HasSuffix(in, ")") {
		body := strings.TrimSuffix(strings.TrimPrefix(in, "hsl("), ")")
		body = strings.ReplaceAll(body, " ", "")
		parts := strings.Split(body, ",")
		if len(parts) != 3 {
			return deriveAccentColor(fallbackSeed)
		}
		for i, p := range parts {
			p = strings.TrimSpace(p)
			if i > 0 && strings.HasSuffix(p, "%") {
				p = strings.TrimSuffix(p, "%")
			}
			if p == "" {
				return deriveAccentColor(fallbackSeed)
			}
			for _, r := range p {
				if r >= '0' && r <= '9' {
					continue
				}
				return deriveAccentColor(fallbackSeed)
			}
		}
		return "hsl(" + body + ")"
	}
	return deriveAccentColor(fallbackSeed)
}

func htmlEscapeText(s string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return replacer.Replace(s)
}

func htmlEscapeAttr(s string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return replacer.Replace(s)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func extractObjectNameFromMinioURL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u == nil {
		return ""
	}
	p := strings.Trim(u.Path, "/")
	if p == "" {
		return ""
	}
	parts := strings.Split(p, "/")
	if len(parts) < 2 {
		return ""
	}
	obj := strings.TrimSpace(parts[len(parts)-1])
	return obj
}

func (h ReportsHandler) ensureReportExpiry(r *models.Report) time.Time {
	if r != nil && r.ExpiresAt != nil && !r.ExpiresAt.IsZero() {
		return r.ExpiresAt.UTC()
	}
	base := time.Time{}
	if r != nil {
		base = r.CreatedAt
	}
	if base.IsZero() {
		base = time.Now().UTC()
	}
	exp := base.AddDate(0, 0, 90)
	if r != nil {
		r.ExpiresAt = &exp
		_ = h.db.Model(&models.Report{}).Where("id = ?", r.ID).Update("expires_at", exp).Error
	}
	return exp
}

func renderExpiredHTML() string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Report expired</title><style>body{margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial;background:#f7f7fb;color:#111}.wrap{max-width:720px;margin:0 auto;padding:28px}.card{background:#fff;border:1px solid #eee;border-radius:16px;padding:16px}.muted{color:#6b7280;font-size:13px}</style></head><body><div class="wrap"><div class="card"><div style="font-weight:900;font-size:18px">Link report sudah expired</div><div class="muted" style="margin-top:6px">Minta agency untuk refresh link report (token) supaya bisa dibuka lagi.</div></div></div></body></html>`
}

func addClientViewerChrome(token string, html string) string {
	tok := strings.ReplaceAll(strings.TrimSpace(token), `"`, "")
	if tok == "" {
		return html
	}
	css := `.viewer-top{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid #eee}.viewer-top-inner{max-width:920px;margin:0 auto;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.viewer-btn{display:inline-block;padding:10px 12px;border-radius:12px;border:1px solid #ddd;text-decoration:none;color:#111;font-weight:700;font-size:13px}.viewer-sub{color:#6b7280;font-size:12px}`
	top := fmt.Sprintf(`<div class="viewer-top"><div class="viewer-top-inner"><div><div style="font-weight:900">Client Report</div><div class="viewer-sub">Magic link</div></div><a class="viewer-btn" href="/r/%s/download" download>Download PDF</a></div></div>`, tok)

	if strings.Contains(html, "</style>") {
		html = strings.Replace(html, "</style>", css+"</style>", 1)
	}
	if strings.Contains(html, "<body>") {
		html = strings.Replace(html, "<body>", "<body>"+top, 1)
	}
	return html
}

func buildPublicURL(c *gin.Context, cfg config.Config, path string) string {
	base := strings.TrimRight(strings.TrimSpace(cfg.OAuth.PublicBaseURL), "/")
	if base == "" || strings.Contains(base, "localhost") || strings.Contains(base, "127.0.0.1") {
		scheme := "http"
		if xf := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); xf != "" {
			scheme = xf
		} else if c.Request != nil && c.Request.TLS != nil {
			scheme = "https"
		}

		host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
		if host == "" {
			host = strings.TrimSpace(c.Request.Host)
		}
		if host == "" {
			host = "localhost"
		}
		base = scheme + "://" + host
	}
	path = "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	return base + path
}

func parseOptionalPeriod(startRaw string, endRaw string) (*time.Time, *time.Time, error) {
	startRaw = strings.TrimSpace(startRaw)
	endRaw = strings.TrimSpace(endRaw)

	if startRaw == "" && endRaw == "" {
		return nil, nil, nil
	}

	parseOne := func(s string) (*time.Time, error) {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil, nil
		}
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			t = utcDate(t.UTC())
			return &t, nil
		}
		if t, err := time.Parse("2006-01-02", s); err == nil {
			t = utcDate(t.UTC())
			return &t, nil
		}
		return nil, errors.New("invalid date")
	}

	start, err := parseOne(startRaw)
	if err != nil {
		return nil, nil, err
	}
	end, err := parseOne(endRaw)
	if err != nil {
		return nil, nil, err
	}

	if start == nil && end != nil {
		t := end.AddDate(0, 0, -29)
		t = utcDate(t.UTC())
		start = &t
	}
	if end == nil && start != nil {
		t := utcDate(time.Now().UTC())
		end = &t
	}

	if start != nil && end != nil && start.After(*end) {
		return nil, nil, errors.New("invalid period")
	}
	return start, end, nil
}
