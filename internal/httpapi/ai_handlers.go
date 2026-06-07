package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type AIHandler struct {
	cfg config.Config
	db  *gorm.DB
}

func NewAIHandler(cfg config.Config, db *gorm.DB) AIHandler {
	return AIHandler{cfg: cfg, db: db}
}

type captionRequest struct {
	ContentIdea string `json:"content_idea" binding:"required"`
	Platform    string `json:"platform" binding:"required"`
	Tone        string `json:"tone" binding:"required"`
}

type captionResponse struct {
	Variants []string `json:"variants"`
}

type hashtagsRequest struct {
	Caption string `json:"caption" binding:"required"`
	Niche   string `json:"niche" binding:"required"`
}

type hashtagsResponse struct {
	Hashtags []string `json:"hashtags"`
}

type contentPlanRequest struct {
	ClientID    string   `json:"client_id" binding:"required"`
	HorizonDays int      `json:"horizon_days"`
	Platforms   []string `json:"platforms"`
}

type contentPlanItem struct {
	Day      int      `json:"day"`
	Platform string   `json:"platform"`
	Title    string   `json:"title"`
	Angle    string   `json:"angle"`
	Caption  string   `json:"caption"`
	CTA      string   `json:"cta,omitempty"`
	Hashtags []string `json:"hashtags,omitempty"`
	Time     string   `json:"time,omitempty"`
}

type contentPlanResponse struct {
	Items []contentPlanItem `json:"items"`
}

func (h AIHandler) Caption(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req captionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	platform := strings.ToLower(strings.TrimSpace(req.Platform))
	tone := strings.ToLower(strings.TrimSpace(req.Tone))
	idea := strings.TrimSpace(req.ContentIdea)
	if platform == "" || tone == "" || idea == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var (
		variants         []string
		promptTokens     int
		completionTokens int
		modelUsed        string
	)

	if strings.TrimSpace(h.cfg.AI.OpenAIAPIKey) != "" {
		out, usage, model, err := h.generateCaptionVariantsOpenAI(c.Request.Context(), idea, platform, tone)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		variants = applyPlatformLimits(out, platform)
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens
		modelUsed = model
	} else {
		variants = generateCaptionVariants(idea, platform, tone)
		variants = applyPlatformLimits(variants, platform)

		promptTokens = estimateTokens(idea) + estimateTokens(platform) + estimateTokens(tone) + 50
		completionTokens = 0
		for _, v := range variants {
			completionTokens += estimateTokens(v)
		}
		promptTokens = minInt(promptTokens, 500)
		completionTokens = minInt(completionTokens, 500-promptTokens)
		modelUsed = h.cfg.AI.OpenAIModel
		if modelUsed == "" {
			modelUsed = "gpt-4o-mini"
		}
	}

	totalTokens := promptTokens + completionTokens
	cost := calcCostUSD(totalTokens)

	in := mustJSON(datatypes.JSONMap{
		"content_idea": idea,
		"platform":     platform,
		"tone":         tone,
	})
	out := mustJSON(datatypes.JSONMap{
		"variants": variants,
	})

	_ = h.db.Create(&models.AIGeneration{
		AgencyID:         authCtx.AgencyID,
		UserID:           authCtx.UserID,
		Kind:             "caption",
		Model:            modelUsed,
		Input:            in,
		Output:           out,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		CostUSD:          cost,
		CreatedAt:        time.Now().UTC(),
	}).Error

	c.JSON(http.StatusOK, captionResponse{Variants: variants})
}

func (h AIHandler) Hashtags(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req hashtagsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	caption := strings.TrimSpace(req.Caption)
	niche := strings.TrimSpace(req.Niche)
	if caption == "" || niche == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var (
		hashtags         []string
		promptTokens     int
		completionTokens int
		modelUsed        string
	)

	if strings.TrimSpace(h.cfg.AI.OpenAIAPIKey) != "" {
		out, usage, model, err := h.generateHashtagsOpenAI(c.Request.Context(), caption, niche)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		hashtags = out
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens
		modelUsed = model
	} else {
		hashtags = generateHashtags(caption, niche)

		promptTokens = estimateTokens(caption) + estimateTokens(niche) + 40
		completionTokens = 0
		for _, htag := range hashtags {
			completionTokens += estimateTokens(htag)
		}
		promptTokens = minInt(promptTokens, 500)
		completionTokens = minInt(completionTokens, 500-promptTokens)
		modelUsed = h.cfg.AI.OpenAIModel
		if modelUsed == "" {
			modelUsed = "gpt-4o-mini"
		}
	}
	totalTokens := promptTokens + completionTokens
	cost := calcCostUSD(totalTokens)

	in := mustJSON(datatypes.JSONMap{
		"caption": caption,
		"niche":   niche,
	})
	out := mustJSON(datatypes.JSONMap{
		"hashtags": hashtags,
	})

	_ = h.db.Create(&models.AIGeneration{
		AgencyID:         authCtx.AgencyID,
		UserID:           authCtx.UserID,
		Kind:             "hashtags",
		Model:            modelUsed,
		Input:            in,
		Output:           out,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		CostUSD:          cost,
		CreatedAt:        time.Now().UTC(),
	}).Error

	c.JSON(http.StatusOK, hashtagsResponse{Hashtags: hashtags})
}

func (h AIHandler) ContentPlan(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req contentPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	clientID, err := uuid.Parse(strings.TrimSpace(req.ClientID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	horizon := req.HorizonDays
	if horizon <= 0 {
		horizon = 7
	}
	if horizon < 1 || horizon > 14 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	platforms := req.Platforms
	if len(platforms) == 0 {
		platforms = []string{"facebook"}
	}
	normalizedPlatforms, err := validateAndNormalizePlatforms(platforms)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", clientID, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	if strings.TrimSpace(cl.Industry) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client profile incomplete"})
		return
	}

	var ca models.CompetitorAnalysis
	if err := h.db.
		Where("agency_id = ? AND client_id = ?", authCtx.AgencyID, cl.ID).
		Order("created_at desc").
		First(&ca).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "generate competitor insight first"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load competitor insight failed"})
		return
	}

	var (
		items            []contentPlanItem
		promptTokens     int
		completionTokens int
		modelUsed        string
	)

	if strings.TrimSpace(h.cfg.AI.OpenAIAPIKey) != "" {
		out, usage, model, err := h.generateContentPlanOpenAI(
			c.Request.Context(),
			cl,
			ca,
			horizon,
			normalizedPlatforms,
		)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		items = out
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens
		modelUsed = model
	} else {
		items = generateContentPlanFallback(cl, ca, horizon, normalizedPlatforms)
		promptTokens = estimateTokens(cl.Name) + estimateTokens(cl.Industry) + estimateTokens(cl.Location) + estimateTokens(string(ca.Output)) + 90
		completionTokens = 0
		for _, it := range items {
			completionTokens += estimateTokens(it.Title) + estimateTokens(it.Caption) + estimateTokens(it.Angle) + estimateTokens(it.CTA)
		}
		promptTokens = minInt(promptTokens, 800)
		completionTokens = minInt(completionTokens, 1200)
		modelUsed = h.cfg.AI.OpenAIModel
		if modelUsed == "" {
			modelUsed = "gpt-4o-mini"
		}
	}

	totalTokens := promptTokens + completionTokens
	cost := calcCostUSD(totalTokens)

	in := mustJSON(datatypes.JSONMap{
		"client_id":     cl.ID.String(),
		"industry":      cl.Industry,
		"location":      cl.Location,
		"horizon_days":  horizon,
		"platforms":     normalizedPlatforms,
		"competitor_id": ca.ID.String(),
	})
	out := mustJSON(datatypes.JSONMap{
		"items": items,
	})

	_ = h.db.Create(&models.AIGeneration{
		AgencyID:         authCtx.AgencyID,
		UserID:           authCtx.UserID,
		Kind:             "content_plan",
		Model:            modelUsed,
		Input:            in,
		Output:           out,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		CostUSD:          cost,
		CreatedAt:        time.Now().UTC(),
	}).Error

	c.JSON(http.StatusOK, contentPlanResponse{Items: items})
}

func generateCaptionVariants(idea, platform, tone string) []string {
	base := idea
	if !strings.HasSuffix(base, ".") && !strings.HasSuffix(base, "!") && !strings.HasSuffix(base, "?") {
		base += "."
	}

	cta := "DM buat order"
	if strings.ToLower(strings.TrimSpace(platform)) == "x" {
		cta = "reply/DM buat order"
	}

	switch tone {
	case "professional":
		return []string{
			"Promo spesial hari ini: " + base + " Info & order via " + cta + ".",
			"Sedang ada penawaran terbatas: " + base + " Berlaku selama stok tersedia.",
			"Penawaran terbaik untuk kamu: " + base + " Cek detailnya sekarang.",
		}
	case "funny":
		return []string{
			base + " Dompet: \"aku siap\".",
			"Yang ini bukan promo biasa: " + base + " Gaskeun?",
			"Warning: " + base + " bisa bikin nagih.",
		}
	default:
		return []string{
			base + " Yuk mampir ya!",
			"Promo hari ini: " + base + " Buruan sebelum habis!",
			base + " " + cta + " ya.",
		}
	}
}

func applyPlatformLimits(variants []string, platform string) []string {
	platform = strings.ToLower(strings.TrimSpace(platform))
	max := 0
	switch platform {
	case "x":
		max = 280
	}
	if max <= 0 {
		return variants
	}
	out := make([]string, 0, len(variants))
	for _, v := range variants {
		r := []rune(v)
		if len(r) > max {
			out = append(out, string(r[:max]))
		} else {
			out = append(out, v)
		}
	}
	return out
}

var wordRE = regexp.MustCompile(`[a-zA-Z0-9_]+`)

func generateHashtags(caption, niche string) []string {
	tokens := map[string]int{}
	for _, w := range wordRE.FindAllString(strings.ToLower(caption), -1) {
		if len(w) < 3 {
			continue
		}
		tokens[w]++
	}
	for _, w := range wordRE.FindAllString(strings.ToLower(niche), -1) {
		if len(w) < 3 {
			continue
		}
		tokens[w] += 2
	}

	type pair struct {
		w string
		n int
	}
	list := make([]pair, 0, len(tokens))
	for w, n := range tokens {
		list = append(list, pair{w: w, n: n})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].n == list[j].n {
			return list[i].w < list[j].w
		}
		return list[i].n > list[j].n
	})

	out := make([]string, 0, 15)
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if !strings.HasPrefix(s, "#") {
			s = "#" + s
		}
		for _, existing := range out {
			if strings.EqualFold(existing, s) {
				return
			}
		}
		out = append(out, s)
	}

	for _, p := range list {
		add(sanitizeHashtag(p.w))
		if len(out) >= 12 {
			break
		}
	}

	fallback := []string{"promo", "diskon", "kuliner", "kopi", "coffee", "minuman", "fyp", "viral"}
	for _, f := range fallback {
		add(f)
		if len(out) >= 12 {
			break
		}
	}
	return out
}

func sanitizeHashtag(w string) string {
	w = strings.ToLower(strings.TrimSpace(w))
	w = strings.ReplaceAll(w, "-", "")
	w = strings.ReplaceAll(w, ".", "")
	w = strings.ReplaceAll(w, " ", "")
	return w
}

func estimateTokens(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	return int(math.Ceil(float64(len([]rune(s))) / 4.0))
}

func calcCostUSD(totalTokens int) float64 {
	return float64(totalTokens) * 0.0006 / 1000.0
}

func mustJSON(v any) datatypes.JSON {
	b, _ := json.Marshal(v)
	return datatypes.JSON(b)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type openAIUsage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

type openAIChatResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error,omitempty"`
}

func (h AIHandler) generateCaptionVariantsOpenAI(ctx context.Context, idea, platform, tone string) ([]string, openAIUsage, string, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	tone = strings.ToLower(strings.TrimSpace(tone))
	idea = strings.TrimSpace(idea)

	maxLenHint := 0
	if platform == "x" {
		maxLenHint = 280
	}

	system := "You are a helpful social media copywriter. Return ONLY valid JSON."
	user := fmt.Sprintf(
		`Buat 3 variasi caption bahasa Indonesia untuk platform "%s" dengan tone "%s".
Topik/ide: %q
%s
Output JSON schema: {"variants":["...","...","..."]}.`,
		platform,
		tone,
		idea,
		func() string {
			if maxLenHint > 0 {
				return fmt.Sprintf("Constraint: each variant must be <= %d characters.", maxLenHint)
			}
			return ""
		}(),
	)

	var parsed struct {
		Variants []string `json:"variants"`
	}
	content, usage, model, err := h.openAIChatJSON(ctx, system, user)
	if err != nil {
		return nil, openAIUsage{}, "", err
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, usage, model, errors.New("AI returned invalid JSON")
	}
	out := make([]string, 0, len(parsed.Variants))
	for _, v := range parsed.Variants {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		out = append(out, v)
	}
	if len(out) == 0 {
		return nil, usage, model, errors.New("AI returned empty variants")
	}
	return out, usage, model, nil
}

func (h AIHandler) generateHashtagsOpenAI(ctx context.Context, caption, niche string) ([]string, openAIUsage, string, error) {
	caption = strings.TrimSpace(caption)
	niche = strings.TrimSpace(niche)

	system := "You are a helpful social media strategist. Return ONLY valid JSON."
	user := fmt.Sprintf(
		`Buat 12 hashtag relevan untuk caption berikut, campur Indonesia+English, tanpa spasi, huruf kecil.
Caption: %q
Niche: %q
Output JSON schema: {"hashtags":["#tag1", "..."]}.`,
		caption,
		niche,
	)

	var parsed struct {
		Hashtags []string `json:"hashtags"`
	}
	content, usage, model, err := h.openAIChatJSON(ctx, system, user)
	if err != nil {
		return nil, openAIUsage{}, "", err
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, usage, model, errors.New("AI returned invalid JSON")
	}
	out := make([]string, 0, len(parsed.Hashtags))
	for _, t := range parsed.Hashtags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if !strings.HasPrefix(t, "#") {
			t = "#" + t
		}
		out = append(out, t)
	}
	if len(out) == 0 {
		return nil, usage, model, errors.New("AI returned empty hashtags")
	}
	if len(out) > 20 {
		out = out[:20]
	}
	return out, usage, model, nil
}

func (h AIHandler) generateContentPlanOpenAI(
	ctx context.Context,
	cl models.Client,
	ca models.CompetitorAnalysis,
	horizonDays int,
	platforms []string,
) ([]contentPlanItem, openAIUsage, string, error) {
	brand := strings.TrimSpace(cl.ReportBrandName)
	if brand == "" {
		brand = strings.TrimSpace(cl.Name)
	}
	industry := strings.TrimSpace(cl.Industry)
	location := strings.TrimSpace(cl.Location)
	if location == "" {
		location = "-"
	}

	rawInsight := strings.TrimSpace(string(ca.Output))
	if len([]rune(rawInsight)) > 9000 {
		rawInsight = string([]rune(rawInsight)[:9000])
	}

	system := "You are a senior growth strategist and social media operator. Return ONLY valid JSON."
	user := fmt.Sprintf(
		`Buat rencana konten %d hari untuk brand %q.
Industry: %q
Location: %q
Allowed platforms: %s

Context (latest competitor insight JSON):
BEGIN_COMPETITOR_JSON
%s
END_COMPETITOR_JSON

Rules:
- Output MUST be valid JSON.
- Output schema: {"items":[{"day":1,"platform":"facebook","title":"...","angle":"...","caption":"...","cta":"...","hashtags":["#a","#b"],"time":"10:00"}]}
- items length must be exactly %d.
- day must start at 1 and increment by 1.
- platform must be one of allowed platforms.
- caption must be Bahasa Indonesia, actionable, and specific.
- For platform "x": caption must be <= 240 characters.
- time format HH:MM (24h). Use realistic posting times.`,
		horizonDays,
		brand,
		industry,
		location,
		mustJSON(platforms),
		rawInsight,
		horizonDays,
	)

	var parsed struct {
		Items []contentPlanItem `json:"items"`
	}
	content, usage, model, err := h.openAIChatJSON(ctx, system, user)
	if err != nil {
		return nil, openAIUsage{}, "", err
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, usage, model, errors.New("AI returned invalid JSON")
	}

	allowed := map[string]struct{}{}
	for _, p := range platforms {
		allowed[strings.ToLower(strings.TrimSpace(p))] = struct{}{}
	}
	fallbackPlatform := platforms[0]

	out := make([]contentPlanItem, 0, len(parsed.Items))
	for _, it := range parsed.Items {
		if it.Day <= 0 {
			continue
		}
		it.Platform = strings.ToLower(strings.TrimSpace(it.Platform))
		if _, ok := allowed[it.Platform]; !ok {
			it.Platform = fallbackPlatform
		}
		it.Title = strings.TrimSpace(it.Title)
		it.Angle = strings.TrimSpace(it.Angle)
		it.Caption = strings.TrimSpace(it.Caption)
		it.CTA = strings.TrimSpace(it.CTA)
		it.Time = strings.TrimSpace(it.Time)
		if it.Title == "" || it.Caption == "" {
			continue
		}
		if it.Platform == "x" {
			if len([]rune(it.Caption)) > 240 {
				it.Caption = string([]rune(it.Caption)[:240])
			}
		}
		out = append(out, it)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	if len(out) == 0 {
		return nil, usage, model, errors.New("AI returned empty plan")
	}
	if len(out) > horizonDays {
		out = out[:horizonDays]
	}
	for i := range out {
		out[i].Day = i + 1
		if out[i].Platform == "" {
			out[i].Platform = fallbackPlatform
		}
		if out[i].Time == "" {
			out[i].Time = "10:00"
		}
	}
	if len(out) < horizonDays {
		return nil, usage, model, errors.New("AI returned incomplete plan")
	}

	return out, usage, model, nil
}

func generateContentPlanFallback(cl models.Client, ca models.CompetitorAnalysis, horizonDays int, platforms []string) []contentPlanItem {
	brand := strings.TrimSpace(cl.ReportBrandName)
	if brand == "" {
		brand = strings.TrimSpace(cl.Name)
	}
	industry := strings.TrimSpace(cl.Industry)
	location := strings.TrimSpace(cl.Location)
	if location == "" {
		location = "-"
	}

	angles := []string{
		"Quick win offer",
		"Social proof",
		"Education",
		"Behind the scenes",
		"FAQ & objection handling",
		"Bundle / package",
		"Limited-time reminder",
		"Comparison (why us)",
		"Storytelling",
		"UGC prompt",
		"Value tip",
		"Call to action",
	}
	times := []string{"10:00", "12:30", "19:30"}

	out := make([]contentPlanItem, 0, horizonDays)
	for i := 0; i < horizonDays; i++ {
		p := platforms[i%len(platforms)]
		angle := angles[i%len(angles)]
		title := fmt.Sprintf("%s · %s", brand, angle)
		cta := "Klik link / DM untuk info & order."
		caption := fmt.Sprintf(
			"%s (%s · %s)\n\nHari ini: %s.\n%s",
			brand,
			industry,
			location,
			strings.ToLower(angle),
			cta,
		)
		if p == "x" && len([]rune(caption)) > 240 {
			caption = string([]rune(caption)[:240])
		}
		out = append(out, contentPlanItem{
			Day:      i + 1,
			Platform: p,
			Title:    title,
			Angle:    angle,
			Caption:  caption,
			CTA:      cta,
			Hashtags: []string{},
			Time:     times[i%len(times)],
		})
	}
	_ = ca
	return out
}

func (h AIHandler) openAIChatJSON(ctx context.Context, system, user string) (string, openAIUsage, string, error) {
	base := strings.TrimRight(strings.TrimSpace(h.cfg.AI.OpenAIBaseURL), "/")
	if base == "" {
		base = "https://api.openai.com"
	}
	model := strings.TrimSpace(h.cfg.AI.OpenAIModel)
	if model == "" {
		model = "gpt-4o-mini"
	}

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
		"temperature": 0.7,
		"response_format": map[string]any{
			"type": "json_object",
		},
	}
	b, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return "", openAIUsage{}, "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(h.cfg.AI.OpenAIAPIKey))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 25 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", openAIUsage{}, "", errors.New("AI request failed")
	}
	defer res.Body.Close()

	raw, _ := io.ReadAll(res.Body)
	var parsed openAIChatResponse
	_ = json.Unmarshal(raw, &parsed)

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := ""
		if parsed.Error != nil {
			msg = strings.TrimSpace(parsed.Error.Message)
		}
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		if msg == "" {
			msg = "AI error"
		}
		return "", openAIUsage{}, model, errors.New(msg)
	}
	if len(parsed.Choices) == 0 {
		return "", openAIUsage{}, parsed.Model, errors.New("AI returned empty response")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	usage := openAIUsage{
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
		TotalTokens:      parsed.Usage.TotalTokens,
	}
	return content, usage, parsed.Model, nil
}
