package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"trendspire/internal/auth"
	"trendspire/internal/config"
	"trendspire/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type AuthHandler struct {
	cfg config.Config
	db  *gorm.DB
}

func NewAuthHandler(cfg config.Config, db *gorm.DB) AuthHandler {
	return AuthHandler{cfg: cfg, db: db}
}

type registerRequest struct {
	AgencyName string `json:"agency_name" binding:"required"`
	Email      string `json:"email" binding:"required,email"`
	Password   string `json:"password" binding:"required,min=8"`
	Name       string `json:"name"`
}

type loginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type authResponse struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresAt   time.Time `json:"expires_at"`
	User        userDTO   `json:"user"`
	Agency      agencyDTO `json:"agency"`
}

type userDTO struct {
	ID       string `json:"id"`
	AgencyID string `json:"agency_id"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Name     string `json:"name,omitempty"`
}

type agencyDTO struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	LogoURL string `json:"logo_url,omitempty"`
}

func (h AuthHandler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	agencyName := strings.TrimSpace(req.AgencyName)

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process password"})
		return
	}

	var createdAgency models.Agency
	var createdUser models.AgencyUser

	err = h.db.Transaction(func(tx *gorm.DB) error {
		createdAgency = models.Agency{
			Name: agencyName,
		}
		if err := tx.Create(&createdAgency).Error; err != nil {
			return err
		}

		createdUser = models.AgencyUser{
			AgencyID:     createdAgency.ID,
			Email:        email,
			PasswordHash: passwordHash,
			Role:         "owner",
			Name:         strings.TrimSpace(req.Name),
		}
		if err := tx.Create(&createdUser).Error; err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "registration failed"})
		return
	}

	tokenRes, err := auth.NewAccessToken(h.cfg.Auth, createdUser)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	c.JSON(http.StatusCreated, authResponse{
		AccessToken: tokenRes.Token,
		TokenType:   "Bearer",
		ExpiresAt:   tokenRes.ExpiresAt,
		User: userDTO{
			ID:       createdUser.ID.String(),
			AgencyID: createdUser.AgencyID.String(),
			Email:    createdUser.Email,
			Role:     createdUser.Role,
			Name:     createdUser.Name,
		},
		Agency: agencyDTO{
			ID:      createdAgency.ID.String(),
			Name:    createdAgency.Name,
			LogoURL: createdAgency.LogoURL,
		},
	})
}

func (h AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	var user models.AgencyUser
	err := h.db.Where("email = ?", email).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		return
	}

	if !auth.CheckPasswordHash(user.PasswordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	now := time.Now().UTC()
	_ = h.db.Model(&models.AgencyUser{}).Where("id = ?", user.ID).Update("last_login_at", &now).Error
	user.LastLoginAt = &now

	var agency models.Agency
	_ = h.db.Where("id = ?", user.AgencyID).First(&agency).Error

	tokenRes, err := auth.NewAccessToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	c.JSON(http.StatusOK, authResponse{
		AccessToken: tokenRes.Token,
		TokenType:   "Bearer",
		ExpiresAt:   tokenRes.ExpiresAt,
		User: userDTO{
			ID:       user.ID.String(),
			AgencyID: user.AgencyID.String(),
			Email:    user.Email,
			Role:     user.Role,
			Name:     user.Name,
		},
		Agency: agencyDTO{
			ID:      agency.ID.String(),
			Name:    agency.Name,
			LogoURL: agency.LogoURL,
		},
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

