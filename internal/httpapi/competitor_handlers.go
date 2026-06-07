package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type CompetitorHandler struct {
	cfg config.Config
	db  *gorm.DB
}

func NewCompetitorHandler(cfg config.Config, db *gorm.DB) CompetitorHandler {
	return CompetitorHandler{cfg: cfg, db: db}
}

type competitorAnalyzeRequest struct {
	ClientID string `json:"client_id" binding:"required"`
}

func (h CompetitorHandler) Analyze(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req competitorAnalyzeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	clientID, err := uuid.Parse(strings.TrimSpace(req.ClientID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", clientID, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	clientName := strings.TrimSpace(cl.Name)
	industry := strings.TrimSpace(cl.Industry)
	location := strings.TrimSpace(cl.Location)
	if clientName == "" || industry == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client profile incomplete"})
		return
	}

	var (
		parsed           map[string]any
		raw              string
		promptTokens     int
		completionTokens int
		model            string
	)

	if strings.TrimSpace(h.cfg.AI.OpenAIAPIKey) != "" {
		system := "You are a marketing strategist. Respond ONLY as a valid JSON object (no markdown)."
		user := "Analyze competitors for a business.\n" +
			"Return JSON with keys:\n" +
			"competitors: array of {name, why_relevant, channels, positioning, strengths, weaknesses}\n" +
			"benchmark: {pricing_level, content_quality, posting_frequency, engagement_quality, ads_presence}\n" +
			"gaps: array of {gap, impact, evidence}\n" +
			"opportunities: array of {opportunity, expected_impact, first_steps}\n" +
			"quick_wins_7_days: array of strings\n" +
			"\nInput:\n" +
			"client_name: " + clientName + "\n" +
			"industry: " + industry + "\n" +
			"location: " + location + "\n"

		ai := NewAIHandler(h.cfg, h.db)
		out, usage, usedModel, err := ai.openAIChatJSON(c.Request.Context(), system, user)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		raw = out
		model = usedModel
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens

		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "AI returned invalid JSON"})
			return
		}
	} else {
		parsed = generateCompetitorInsightFallback(clientName, industry, location)
		b, _ := json.Marshal(parsed)
		raw = string(b)
		promptTokens = estimateTokens(clientName) + estimateTokens(industry) + estimateTokens(location) + 220
		completionTokens = 0
		model = strings.TrimSpace(h.cfg.AI.OpenAIModel)
		if model == "" {
			model = "gpt-4o-mini"
		}
	}

	in := mustJSON(datatypes.JSONMap{
		"client_id":   clientID.String(),
		"client_name": clientName,
		"industry":    industry,
		"location":    location,
	})
	out := datatypes.JSON([]byte(raw))
	if !json.Valid(out) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI returned invalid JSON"})
		return
	}

	now := time.Now().UTC()
	_ = h.db.Create(&models.AIGeneration{
		AgencyID:         authCtx.AgencyID,
		UserID:           authCtx.UserID,
		Kind:             "competitor",
		Model:            model,
		Input:            in,
		Output:           mustJSON(datatypes.JSONMap{"result": parsed}),
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      promptTokens + completionTokens,
		CostUSD:          calcCostUSD(promptTokens + completionTokens),
		CreatedAt:        now,
	}).Error

	if err := h.db.Create(&models.CompetitorAnalysis{
		AgencyID:   authCtx.AgencyID,
		UserID:     authCtx.UserID,
		ClientID:   &cl.ID,
		ClientName: clientName,
		Industry:   industry,
		Location:   location,
		Input:      datatypes.JSON(in),
		Output:     out,
		CreatedAt:  now,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": parsed})
}

func generateCompetitorInsightFallback(clientName, industry, location string) map[string]any {
	loc := strings.TrimSpace(location)
	if loc == "" {
		loc = "Indonesia"
	}
	ind := strings.TrimSpace(industry)
	if ind == "" {
		ind = "bisnis"
	}
	baseCompetitors := []map[string]any{
		{
			"name":         "Kompetitor A",
			"why_relevant": "Mainstream leader di niche dengan distribusi konten konsisten.",
			"channels":     []string{"instagram", "tiktok"},
			"positioning":  "Value + social proof",
			"strengths":    []string{"brand recall tinggi", "konsisten posting", "CTA jelas"},
			"weaknesses":   []string{"konten cenderung repetitif", "kurang edukasi mendalam"},
		},
		{
			"name":         "Kompetitor B",
			"why_relevant": "Aggressive growth lewat format video pendek dan promosi.",
			"channels":     []string{"tiktok", "facebook"},
			"positioning":  "Promo-driven + urgency",
			"strengths":    []string{"hook kuat", "promo & penawaran jelas"},
			"weaknesses":   []string{"trust building kurang", "brand voice tidak konsisten"},
		},
		{
			"name":         "Kompetitor C",
			"why_relevant": "Niche specialist yang kuat di edukasi dan authority.",
			"channels":     []string{"instagram", "x"},
			"positioning":  "Authority + education",
			"strengths":    []string{"konten edukatif", "authority tinggi"},
			"weaknesses":   []string{"frekuensi posting rendah", "CTA kurang tegas"},
		},
	}

	return map[string]any{
		"competitors": baseCompetitors,
		"benchmark": map[string]any{
			"pricing_level":      "mixed",
			"content_quality":    "medium",
			"posting_frequency":  "medium",
			"engagement_quality": "mixed",
			"ads_presence":       "unknown",
		},
		"gaps": []map[string]any{
			{"gap": "Konten edukasi yang ringkas tapi actionable", "impact": "naikkan trust dan conversion", "evidence": "kompetitor banyak fokus promo/hiburan"},
			{"gap": "Series content dengan angle berbeda", "impact": "retention dan repeat view", "evidence": "format masih sporadis di niche"},
		},
		"opportunities": []map[string]any{
			{"opportunity": "Positioning: smart + praktis untuk " + ind + " di " + loc, "expected_impact": "diferensiasi jelas", "first_steps": "buat 3 pilar konten: edukasi, proof, offer"},
			{"opportunity": "Hook & CTA standar per format", "expected_impact": "ER naik tanpa turunkan reach", "first_steps": "uji 3 hook dan 2 CTA untuk 7 hari"},
		},
		"quick_wins_7_days": []string{
			"Buat 5 konten format carousel/video: problem → 3 solusi → CTA (pakai bahasa " + clientName + ")",
			"Posting 1 seri: mitos vs fakta di " + ind,
			"Tambah social proof: review/testimoni di 3 konten minggu ini",
		},
	}
}
