package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/cryptoutil"
	"trendspire/internal/models"
	"trendspire/internal/oauth"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AccountsHandler struct {
	cfg        config.Config
	db         *gorm.DB
	stateStore *oauth.StateStore
}

func NewAccountsHandler(cfg config.Config, db *gorm.DB, store *oauth.StateStore) AccountsHandler {
	return AccountsHandler{cfg: cfg, db: db, stateStore: store}
}

type connectRequest struct {
	ClientID string `json:"client_id" binding:"required"`
}

type connectResponse struct {
	AuthURL string `json:"auth_url"`
}

type socialAccountOut struct {
	ID                string     `json:"id"`
	ClientID          string     `json:"client_id"`
	Platform          string     `json:"platform"`
	ExternalAccountID string     `json:"external_account_id,omitempty"`
	Username          string     `json:"username,omitempty"`
	FollowerCount     int64      `json:"follower_count"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	ConnectedAt       *time.Time `json:"connected_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (h AccountsHandler) Connect(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	platform := normalizePlatform(c.Param("platform"))
	if platform == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid platform"})
		return
	}

	var req connectRequest
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

	state := uuid.NewString()
	cfg := h.cfg
	cfg.OAuth.PublicBaseURL = effectivePublicBaseURL(c, cfg.OAuth.PublicBaseURL)
	redirectURI := oauth.BuildRedirectURI(cfg, platform)
	authURL, err := oauth.BuildAuthURL(cfg, platform, state, redirectURI, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.stateStore.Put(oauth.State{
		State:        state,
		Platform:     platform,
		ClientID:     cl.ID,
		CreatedAtUTC: time.Now().UTC(),
	})

	c.JSON(http.StatusOK, connectResponse{AuthURL: authURL})
}

func (h AccountsHandler) Callback(c *gin.Context) {
	platform := normalizePlatform(c.Param("platform"))
	if platform == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid platform"})
		return
	}

	code := strings.TrimSpace(c.Query("code"))
	state := strings.TrimSpace(c.Query("state"))
	if code == "" || state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	st, ok := h.stateStore.Pop(state)
	if !ok || st.Platform != platform {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state"})
		return
	}

	cfg := h.cfg
	cfg.OAuth.PublicBaseURL = effectivePublicBaseURL(c, cfg.OAuth.PublicBaseURL)
	redirectURI := oauth.BuildRedirectURI(cfg, platform)
	tokenRes, err := oauth.ExchangeCode(context.Background(), cfg, platform, code, redirectURI, st.CodeVerifier)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "oauth failed: " + err.Error()})
		return
	}

	key, err := cryptoutil.KeyFromConfig(h.cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
		return
	}

	encAccess, err := cryptoutil.EncryptString(key, tokenRes.AccessToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
		return
	}
	encRefresh := ""
	if strings.TrimSpace(tokenRes.RefreshToken) != "" {
		encRefresh, err = cryptoutil.EncryptString(key, tokenRes.RefreshToken)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
			return
		}
	}

	now := time.Now().UTC()

	var saved models.SocialAccount
	err = h.db.Transaction(func(tx *gorm.DB) error {
		var existing models.SocialAccount
		q := tx.Where("client_id = ? AND platform = ?", st.ClientID, platform)
		err := q.Order("created_at desc").First(&existing).Error
		if err == nil {
			existing.AccessToken = encAccess
			existing.RefreshToken = encRefresh
			existing.ExpiresAt = tokenRes.ExpiresAtUTC
			existing.ConnectedAt = &now
			if tokenRes.Username != "" {
				existing.Username = tokenRes.Username
			}
			if tokenRes.ExternalAccountID != "" {
				existing.ExternalAccountID = tokenRes.ExternalAccountID
			}
			existing.FollowersCount = tokenRes.FollowerCount
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
			saved = existing
			return nil
		}
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}

		newRow := models.SocialAccount{
			ClientID:          st.ClientID,
			Platform:          platform,
			ExternalAccountID: strings.TrimSpace(tokenRes.ExternalAccountID),
			Username:          strings.TrimSpace(tokenRes.Username),
			AccessToken:       encAccess,
			RefreshToken:      encRefresh,
			ExpiresAt:         tokenRes.ExpiresAtUTC,
			ConnectedAt:       &now,
			FollowersCount:    tokenRes.FollowerCount,
		}
		if err := tx.Create(&newRow).Error; err != nil {
			var fallbackExisting models.SocialAccount
			if err2 := tx.Where("client_id = ? AND platform = ?", st.ClientID, platform).First(&fallbackExisting).Error; err2 != nil {
				return err
			}
			fallbackExisting.AccessToken = encAccess
			fallbackExisting.RefreshToken = encRefresh
			fallbackExisting.ExpiresAt = tokenRes.ExpiresAtUTC
			fallbackExisting.ConnectedAt = &now
			if tokenRes.Username != "" {
				fallbackExisting.Username = tokenRes.Username
			}
			if tokenRes.ExternalAccountID != "" {
				fallbackExisting.ExternalAccountID = tokenRes.ExternalAccountID
			}
			fallbackExisting.FollowersCount = tokenRes.FollowerCount
			if err := tx.Save(&fallbackExisting).Error; err != nil {
				return err
			}
			saved = fallbackExisting
			return nil
		}
		saved = newRow
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save token failed"})
		return
	}

	c.JSON(http.StatusOK, toSocialAccountOut(saved))
}

func effectivePublicBaseURL(c *gin.Context, configured string) string {
	base := strings.TrimRight(strings.TrimSpace(configured), "/")
	if base != "" && !strings.Contains(base, "localhost") && !strings.Contains(base, "127.0.0.1") {
		return base
	}

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
		host = "localhost:8080"
	}
	return scheme + "://" + host
}

func (h AccountsHandler) List(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	clientIDStr := strings.TrimSpace(c.Query("client_id"))
	clientID, err := uuid.Parse(clientIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", clientID, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	platform := normalizePlatform(c.Query("platform"))

	var rows []models.SocialAccount
	q := h.db.Where("client_id = ?", cl.ID)
	if platform != "" {
		q = q.Where("platform = ?", platform)
	}
	if err := q.Order("created_at desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list accounts failed"})
		return
	}

	out := make([]socialAccountOut, 0, len(rows))
	for _, r := range rows {
		out = append(out, toSocialAccountOut(r))
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func normalizePlatform(p string) string {
	p = strings.ToLower(strings.TrimSpace(p))
	switch p {
	case "instagram", "facebook", "tiktok", "x":
		return p
	default:
		return ""
	}
}

func toSocialAccountOut(sa models.SocialAccount) socialAccountOut {
	return socialAccountOut{
		ID:                sa.ID.String(),
		ClientID:          sa.ClientID.String(),
		Platform:          sa.Platform,
		ExternalAccountID: sa.ExternalAccountID,
		Username:          sa.Username,
		FollowerCount:     sa.FollowersCount,
		ExpiresAt:         sa.ExpiresAt,
		ConnectedAt:       sa.ConnectedAt,
		CreatedAt:         sa.CreatedAt,
		UpdatedAt:         sa.UpdatedAt,
	}
}
