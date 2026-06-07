package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"trendspire/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ClientsHandler struct {
	db *gorm.DB
}

func NewClientsHandler(db *gorm.DB) ClientsHandler {
	return ClientsHandler{db: db}
}

type createClientRequest struct {
	Name            string                   `json:"name" binding:"required"`
	LogoURL         string                   `json:"logo_url"`
	ReportBrandName string                   `json:"report_brand_name"`
	Industry        string                   `json:"industry"`
	Location        string                   `json:"location"`
	SocialAccounts  []createSocialAccountReq `json:"social_accounts"`
}

type createSocialAccountReq struct {
	Platform          string     `json:"platform" binding:"required"`
	ExternalAccountID string     `json:"external_account_id"`
	Username          string     `json:"username"`
	ExpiresAt         *time.Time `json:"expires_at"`
	ConnectedAt       *time.Time `json:"connected_at"`
}

type updateClientRequest struct {
	Name            string `json:"name"`
	LogoURL         string `json:"logo_url"`
	ReportBrandName string `json:"report_brand_name"`
	Industry        string `json:"industry"`
	Location        string `json:"location"`
}

type clientDTO struct {
	ID              string             `json:"id"`
	AgencyID        string             `json:"agency_id"`
	Name            string             `json:"name"`
	LogoURL         string             `json:"logo_url,omitempty"`
	ReportBrandName string             `json:"report_brand_name,omitempty"`
	Industry        string             `json:"industry,omitempty"`
	Location        string             `json:"location,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
	SocialAccounts  []socialAccountDTO `json:"social_accounts,omitempty"`
}

type socialAccountDTO struct {
	ID                string     `json:"id"`
	ClientID          string     `json:"client_id"`
	Platform          string     `json:"platform"`
	ExternalAccountID string     `json:"external_account_id,omitempty"`
	Username          string     `json:"username,omitempty"`
	FollowersCount    int64      `json:"follower_count"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	ConnectedAt       *time.Time `json:"connected_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (h ClientsHandler) CreateClient(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	newClient := models.Client{
		AgencyID:        authCtx.AgencyID,
		Name:            strings.TrimSpace(req.Name),
		LogoURL:         strings.TrimSpace(req.LogoURL),
		ReportBrandName: strings.TrimSpace(req.ReportBrandName),
		Industry:        strings.TrimSpace(req.Industry),
		Location:        strings.TrimSpace(req.Location),
	}
	if newClient.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var created models.Client
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&newClient).Error; err != nil {
			return err
		}

		for _, sa := range req.SocialAccounts {
			platform := strings.ToLower(strings.TrimSpace(sa.Platform))
			if platform == "" {
				return errors.New("invalid platform")
			}

			record := models.SocialAccount{
				ClientID:          newClient.ID,
				Platform:          platform,
				ExternalAccountID: strings.TrimSpace(sa.ExternalAccountID),
				Username:          strings.TrimSpace(sa.Username),
				ExpiresAt:         sa.ExpiresAt,
				ConnectedAt:       sa.ConnectedAt,
			}
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
		}

		return tx.Preload("SocialAccounts").Where("id = ?", newClient.ID).First(&created).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create client failed"})
		return
	}

	c.JSON(http.StatusCreated, toClientDTO(created))
}

func (h ClientsHandler) ListClients(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var clients []models.Client
	err = h.db.Preload("SocialAccounts").
		Where("agency_id = ?", authCtx.AgencyID).
		Order("created_at desc").
		Find(&clients).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list clients failed"})
		return
	}

	out := make([]clientDTO, 0, len(clients))
	for _, cl := range clients {
		out = append(out, toClientDTO(cl))
	}

	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h ClientsHandler) UpdateClient(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var req updateClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", id, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	updates := map[string]any{}
	if s := strings.TrimSpace(req.Name); s != "" {
		updates["name"] = s
	}
	if s := strings.TrimSpace(req.LogoURL); s != "" || req.LogoURL != "" {
		updates["logo_url"] = strings.TrimSpace(req.LogoURL)
	}
	if s := strings.TrimSpace(req.ReportBrandName); s != "" || req.ReportBrandName != "" {
		updates["report_brand_name"] = strings.TrimSpace(req.ReportBrandName)
	}
	if s := strings.TrimSpace(req.Industry); s != "" || req.Industry != "" {
		updates["industry"] = strings.TrimSpace(req.Industry)
	}
	if s := strings.TrimSpace(req.Location); s != "" || req.Location != "" {
		updates["location"] = strings.TrimSpace(req.Location)
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	updates["updated_at"] = time.Now().UTC()

	if err := h.db.Model(&models.Client{}).Where("id = ? AND agency_id = ?", id, authCtx.AgencyID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}

	var out models.Client
	if err := h.db.Preload("SocialAccounts").Where("id = ? AND agency_id = ?", id, authCtx.AgencyID).First(&out).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}
	c.JSON(http.StatusOK, toClientDTO(out))
}

func toClientDTO(cl models.Client) clientDTO {
	dto := clientDTO{
		ID:              cl.ID.String(),
		AgencyID:        cl.AgencyID.String(),
		Name:            cl.Name,
		LogoURL:         cl.LogoURL,
		ReportBrandName: cl.ReportBrandName,
		Industry:        cl.Industry,
		Location:        cl.Location,
		CreatedAt:       cl.CreatedAt,
		UpdatedAt:       cl.UpdatedAt,
	}

	if len(cl.SocialAccounts) > 0 {
		dto.SocialAccounts = make([]socialAccountDTO, 0, len(cl.SocialAccounts))
		for _, sa := range cl.SocialAccounts {
			dto.SocialAccounts = append(dto.SocialAccounts, socialAccountDTO{
				ID:                sa.ID.String(),
				ClientID:          sa.ClientID.String(),
				Platform:          sa.Platform,
				ExternalAccountID: sa.ExternalAccountID,
				Username:          sa.Username,
				FollowersCount:    sa.FollowersCount,
				ExpiresAt:         sa.ExpiresAt,
				ConnectedAt:       sa.ConnectedAt,
				CreatedAt:         sa.CreatedAt,
				UpdatedAt:         sa.UpdatedAt,
			})
		}
	}

	return dto
}
