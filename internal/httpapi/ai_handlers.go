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
		variants          []string
		promptTokens      int
		completionTokens  int
		modelUsed         string
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
		hashtags          []string
		promptTokens      int
		completionTokens  int
		modelUsed         string
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
