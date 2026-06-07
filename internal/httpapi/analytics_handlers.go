package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type AnalyticsHandler struct {
	cfg config.Config
	db  *gorm.DB
	rdb *redis.Client
}

func NewAnalyticsHandler(cfg config.Config, db *gorm.DB) AnalyticsHandler {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Queue.RedisAddr,
		Password: cfg.Queue.RedisPassword,
		DB:       cfg.Queue.RedisDB,
	})
	return AnalyticsHandler{cfg: cfg, db: db, rdb: rdb}
}

type analyticsPlatformDTO struct {
	Platform        string  `json:"platform"`
	Followers       int64   `json:"followers"`
	Likes           int64   `json:"likes"`
	Comments        int64   `json:"comments"`
	Impressions     int64   `json:"impressions"`
	EngagementRate  float64 `json:"engagement_rate"`
	WoWGrowthPct    float64 `json:"wow_growth_pct"`
	MoMGrowthPct    float64 `json:"mom_growth_pct"`
	Date            string  `json:"date"`
}

type analyticsClientResponse struct {
	ClientID   string               `json:"client_id"`
	Date       string               `json:"date"`
	Blended    analyticsPlatformDTO `json:"blended"`
	Platforms  []analyticsPlatformDTO `json:"platforms"`
	AlertsLast24h int64             `json:"alerts_last_24h"`
}

type analyticsDashboardResponse struct {
	Date          string               `json:"date"`
	Blended       analyticsPlatformDTO `json:"blended"`
	ClientsCount  int64                `json:"clients_count"`
	AlertsLast24h int64                `json:"alerts_last_24h"`
}

func (h AnalyticsHandler) ClientAnalytics(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	clientID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", clientID, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	cacheKey := fmt.Sprintf("cache:analytics:client:%s:%s", authCtx.AgencyID.String(), cl.ID.String())
	if b, err := h.rdb.Get(c.Request.Context(), cacheKey).Bytes(); err == nil && len(b) > 0 {
		c.Data(http.StatusOK, "application/json", b)
		return
	}

	day := utcDate(time.Now().UTC())

	platformRows := []models.AnalyticsDaily{}
	_ = h.db.Where("agency_id = ? AND client_id = ? AND date = ?", authCtx.AgencyID, cl.ID, day).
		Find(&platformRows).Error

	platforms := make([]analyticsPlatformDTO, 0, len(platformRows))
	blended := analyticsPlatformDTO{Platform: "blended", Date: day.Format("2006-01-02")}
	for _, r := range platformRows {
		dto := analyticsPlatformDTO{
			Platform:       r.Platform,
			Followers:      r.Followers,
			Likes:          r.Likes,
			Comments:       r.Comments,
			Impressions:    r.Impressions,
			EngagementRate: r.EngagementRate,
			WoWGrowthPct:   r.WoWGrowthPct,
			MoMGrowthPct:   r.MoMGrowthPct,
			Date:           r.Date.Format("2006-01-02"),
		}
		platforms = append(platforms, dto)
		blended.Followers += dto.Followers
		blended.Likes += dto.Likes
		blended.Comments += dto.Comments
		blended.Impressions += dto.Impressions
	}

	sort.Slice(platforms, func(i, j int) bool { return platforms[i].Platform < platforms[j].Platform })
	if blended.Impressions > 0 {
		blended.EngagementRate = float64(blended.Likes+blended.Comments) / float64(blended.Impressions)
	}

	var alerts int64
	_ = h.db.Model(&models.AnalyticsAlert{}).
		Where("agency_id = ? AND client_id = ? AND created_at >= ?", authCtx.AgencyID, cl.ID, time.Now().UTC().Add(-24*time.Hour)).
		Count(&alerts).Error

	resp := analyticsClientResponse{
		ClientID:        cl.ID.String(),
		Date:            day.Format("2006-01-02"),
		Blended:         blended,
		Platforms:       platforms,
		AlertsLast24h:   alerts,
	}
	b, _ := json.Marshal(resp)
	_ = h.rdb.Set(c.Request.Context(), cacheKey, b, 15*time.Minute).Err()
	c.Data(http.StatusOK, "application/json", b)
}

func (h AnalyticsHandler) Dashboard(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	cacheKey := fmt.Sprintf("cache:analytics:dashboard:%s", authCtx.AgencyID.String())
	if b, err := h.rdb.Get(c.Request.Context(), cacheKey).Bytes(); err == nil && len(b) > 0 {
		c.Data(http.StatusOK, "application/json", b)
		return
	}

	day := utcDate(time.Now().UTC())

	var clientsCount int64
	_ = h.db.Model(&models.Client{}).Where("agency_id = ?", authCtx.AgencyID).Count(&clientsCount).Error

	rows := []models.AnalyticsDaily{}
	_ = h.db.Where("agency_id = ? AND date = ?", authCtx.AgencyID, day).Find(&rows).Error

	blended := analyticsPlatformDTO{Platform: "blended", Date: day.Format("2006-01-02")}
	for _, r := range rows {
		blended.Followers += r.Followers
		blended.Likes += r.Likes
		blended.Comments += r.Comments
		blended.Impressions += r.Impressions
	}
	if blended.Impressions > 0 {
		blended.EngagementRate = float64(blended.Likes+blended.Comments) / float64(blended.Impressions)
	}

	var alerts int64
	_ = h.db.Model(&models.AnalyticsAlert{}).
		Where("agency_id = ? AND created_at >= ?", authCtx.AgencyID, time.Now().UTC().Add(-24*time.Hour)).
		Count(&alerts).Error

	resp := analyticsDashboardResponse{
		Date:          day.Format("2006-01-02"),
		Blended:       blended,
		ClientsCount:  clientsCount,
		AlertsLast24h: alerts,
	}

	b, _ := json.Marshal(resp)
	_ = h.rdb.Set(c.Request.Context(), cacheKey, b, 15*time.Minute).Err()
	c.Data(http.StatusOK, "application/json", b)
}

func utcDate(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

