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

	if strings.TrimSpace(h.cfg.AI.OpenAIAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI not configured"})
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
	raw, usage, model, err := ai.openAIChatJSON(c.Request.Context(), system, user)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI returned invalid JSON"})
		return
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
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		CostUSD:          calcCostUSD(usage.TotalTokens),
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
