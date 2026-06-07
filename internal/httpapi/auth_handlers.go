package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"trendspire/internal/auth"
	"trendspire/internal/config"
	"trendspire/internal/models"
	"trendspire/internal/storage"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type AuthHandler struct {
	cfg          config.Config
	db           *gorm.DB
	googleStates *googleStateStore
	otpStore     *otpStore
}

func NewAuthHandler(cfg config.Config, db *gorm.DB) AuthHandler {
	return AuthHandler{
		cfg:          cfg,
		db:           db,
		googleStates: newGoogleStateStore(10 * time.Minute),
		otpStore:     newOTPStore(5 * time.Minute),
	}
}

type registerRequest struct {
	AgencyName   string `json:"agency_name" binding:"required"`
	LogoURL      string `json:"logo_url"`
	PrimaryColor string `json:"primary_color"`
	Email        string `json:"email" binding:"required,email"`
	Password     string `json:"password" binding:"required,min=8"`
	Name         string `json:"name"`
}

type loginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type authResponse struct {
	AccessToken      string    `json:"access_token"`
	TokenType        string    `json:"token_type"`
	ExpiresAt        time.Time `json:"expires_at"`
	RefreshToken     string    `json:"refresh_token"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
	User             userDTO   `json:"user"`
	Agency           agencyDTO `json:"agency"`
}

type userDTO struct {
	ID       string `json:"id"`
	AgencyID string `json:"agency_id"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Name     string `json:"name,omitempty"`
}

type agencyDTO struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	LogoURL      string `json:"logo_url,omitempty"`
	PrimaryColor string `json:"primary_color,omitempty"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type updateAgencyRequest struct {
	Name         string `json:"name"`
	LogoURL      string `json:"logo_url"`
	PrimaryColor string `json:"primary_color"`
}

type googleStartResponse struct {
	AuthURL string `json:"auth_url"`
}

type googleState struct {
	State        string
	Mode         string
	AgencyName   string
	Name         string
	CreatedAtUTC time.Time
}

type googleStateStore struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]googleState
}

func newGoogleStateStore(ttl time.Duration) *googleStateStore {
	return &googleStateStore{
		ttl:  ttl,
		data: map[string]googleState{},
	}
}

func (s *googleStateStore) Put(st googleState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(time.Now().UTC())
	s.data[st.State] = st
}

func (s *googleStateStore) Pop(state string) (googleState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(time.Now().UTC())
	st, ok := s.data[state]
	if !ok {
		return googleState{}, false
	}
	delete(s.data, state)
	return st, true
}

func (s *googleStateStore) cleanupLocked(now time.Time) {
	if s.ttl <= 0 {
		return
	}
	for k, v := range s.data {
		if now.Sub(v.CreatedAtUTC) > s.ttl {
			delete(s.data, k)
		}
	}
}

type whatsappRequestOTPRequest struct {
	Phone string `json:"phone" binding:"required"`
}

type whatsappRequestOTPResponse struct {
	Sent         bool   `json:"sent"`
	ExpiresInSec int64  `json:"expires_in_sec"`
	DevCode      string `json:"dev_code,omitempty"`
}

type whatsappVerifyOTPRequest struct {
	Mode         string `json:"mode"`
	Phone        string `json:"phone" binding:"required"`
	OTP          string `json:"otp" binding:"required"`
	AgencyName   string `json:"agency_name"`
	Name         string `json:"name"`
	LogoURL      string `json:"logo_url"`
	PrimaryColor string `json:"primary_color"`
}

type otpEntry struct {
	Hash         [32]byte
	ExpiresAtUTC time.Time
}

type otpStore struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]otpEntry
}

func newOTPStore(ttl time.Duration) *otpStore {
	return &otpStore{ttl: ttl, m: map[string]otpEntry{}}
}

func (s *otpStore) Put(phone string, hash [32]byte) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp := time.Now().UTC().Add(s.ttl)
	s.m[phone] = otpEntry{Hash: hash, ExpiresAtUTC: exp}
	return int64(s.ttl.Seconds())
}

func (s *otpStore) Verify(phone string, hash [32]byte) (bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	ent, ok := s.m[phone]
	if !ok {
		return false, false
	}
	if now.After(ent.ExpiresAtUTC) {
		delete(s.m, phone)
		return false, false
	}
	if ent.Hash != hash {
		return false, true
	}
	delete(s.m, phone)
	return true, true
}

func normalizePhone(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(digits, "0") {
		digits = "62" + strings.TrimPrefix(digits, "0")
	}
	if strings.HasPrefix(digits, "62") {
		return "+" + digits
	}
	if strings.HasPrefix(digits, "1") || strings.HasPrefix(digits, "7") || strings.HasPrefix(digits, "8") || strings.HasPrefix(digits, "9") {
		return "+62" + digits
	}
	return "+" + digits
}

func phoneToEmail(phone string) string {
	p := strings.TrimPrefix(phone, "+")
	return p + "@wa.trendspire"
}

func randomDigits(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid digits")
	}
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
	x, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	s := x.Text(10)
	if len(s) < n {
		return strings.Repeat("0", n-len(s)) + s, nil
	}
	return s, nil
}

func otpHash(secret, phone, otp string) [32]byte {
	payload := strings.TrimSpace(secret) + ":" + strings.TrimSpace(phone) + ":" + strings.TrimSpace(otp)
	return sha256.Sum256([]byte(payload))
}

func isProdEnv(cfg config.Config) bool {
	env := strings.ToLower(strings.TrimSpace(cfg.Server.Env))
	return env == "production" || env == "prod"
}

func (h AuthHandler) sendWhatsAppOTP(ctx context.Context, phoneE164 string, code string) error {
	token := strings.TrimSpace(h.cfg.WhatsApp.Token)
	phoneNumberID := strings.TrimSpace(h.cfg.WhatsApp.PhoneNumberID)
	if token == "" || phoneNumberID == "" {
		return errors.New("whatsapp not configured")
	}

	to := strings.TrimPrefix(phoneE164, "+")
	body := map[string]any{
		"messaging_product": "whatsapp",
		"to":                to,
		"type":              "text",
		"text": map[string]any{
			"preview_url": false,
			"body":        "TrendSpire OTP: " + code,
		},
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://graph.facebook.com/v20.0/"+url.PathEscape(phoneNumberID)+"/messages", strings.NewReader(string(b)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		_, _ = io.ReadAll(res.Body)
		return errors.New("whatsapp send failed")
	}
	return nil
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
			Name:         agencyName,
			LogoURL:      strings.TrimSpace(req.LogoURL),
			PrimaryColor: strings.TrimSpace(req.PrimaryColor),
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

	refreshRes, err := auth.NewRefreshToken(h.cfg.Auth, createdUser)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	c.JSON(http.StatusCreated, authResponse{
		AccessToken:      tokenRes.Token,
		TokenType:        "Bearer",
		ExpiresAt:        tokenRes.ExpiresAt,
		RefreshToken:     refreshRes.Token,
		RefreshExpiresAt: refreshRes.ExpiresAt,
		User: userDTO{
			ID:       createdUser.ID.String(),
			AgencyID: createdUser.AgencyID.String(),
			Email:    createdUser.Email,
			Role:     createdUser.Role,
			Name:     createdUser.Name,
		},
		Agency: agencyDTO{
			ID:           createdAgency.ID.String(),
			Name:         createdAgency.Name,
			LogoURL:      createdAgency.LogoURL,
			PrimaryColor: createdAgency.PrimaryColor,
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

	refreshRes, err := auth.NewRefreshToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	c.JSON(http.StatusOK, authResponse{
		AccessToken:      tokenRes.Token,
		TokenType:        "Bearer",
		ExpiresAt:        tokenRes.ExpiresAt,
		RefreshToken:     refreshRes.Token,
		RefreshExpiresAt: refreshRes.ExpiresAt,
		User: userDTO{
			ID:       user.ID.String(),
			AgencyID: user.AgencyID.String(),
			Email:    user.Email,
			Role:     user.Role,
			Name:     user.Name,
		},
		Agency: agencyDTO{
			ID:           agency.ID.String(),
			Name:         agency.Name,
			LogoURL:      agency.LogoURL,
			PrimaryColor: agency.PrimaryColor,
		},
	})
}

func (h AuthHandler) Refresh(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	claims := auth.RefreshTokenClaims{}
	token, err := jwt.ParseWithClaims(strings.TrimSpace(req.RefreshToken), &claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return []byte(h.cfg.Auth.JWTSecret), nil
	}, jwt.WithIssuer(h.cfg.Auth.JWTIssuer))
	if err != nil || token == nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	if strings.ToLower(strings.TrimSpace(claims.TokenUse)) != "refresh" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	userID, err := uuid.Parse(strings.TrimSpace(claims.Subject))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	agencyID, err := uuid.Parse(strings.TrimSpace(claims.AgencyID))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	var user models.AgencyUser
	if err := h.db.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if user.AgencyID != agencyID {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var agency models.Agency
	_ = h.db.Where("id = ?", user.AgencyID).First(&agency).Error

	accessRes, err := auth.NewAccessToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}
	refreshRes, err := auth.NewRefreshToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	c.JSON(http.StatusOK, authResponse{
		AccessToken:      accessRes.Token,
		TokenType:        "Bearer",
		ExpiresAt:        accessRes.ExpiresAt,
		RefreshToken:     refreshRes.Token,
		RefreshExpiresAt: refreshRes.ExpiresAt,
		User: userDTO{
			ID:       user.ID.String(),
			AgencyID: user.AgencyID.String(),
			Email:    user.Email,
			Role:     user.Role,
			Name:     user.Name,
		},
		Agency: agencyDTO{
			ID:           agency.ID.String(),
			Name:         agency.Name,
			LogoURL:      agency.LogoURL,
			PrimaryColor: agency.PrimaryColor,
		},
	})
}

func (h AuthHandler) UpdateAgency(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req updateAgencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	name := strings.TrimSpace(req.Name)
	logoURL := strings.TrimSpace(req.LogoURL)
	primaryColor := strings.TrimSpace(req.PrimaryColor)

	updates := map[string]any{}
	if name != "" {
		updates["name"] = name
	}
	if logoURL != "" {
		updates["logo_url"] = logoURL
	}
	if primaryColor != "" {
		updates["primary_color"] = primaryColor
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if err := h.db.Model(&models.Agency{}).
		Where("id = ?", authCtx.AgencyID).
		Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}

	var agency models.Agency
	if err := h.db.Where("id = ?", authCtx.AgencyID).First(&agency).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":            agency.ID.String(),
		"name":          agency.Name,
		"logo_url":      agency.LogoURL,
		"primary_color": agency.PrimaryColor,
	})
}

func (h AuthHandler) UploadAgencyLogo(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	fh, err := c.FormFile("logo")
	if err != nil || fh == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	f, err := fh.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	up, upErr := storage.UploadToMinIO(c.Request.Context(), h.cfg, f, fh.Size, fh.Header.Get("Content-Type"))
	_ = f.Close()
	if upErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "upload failed"})
		return
	}

	if err := h.db.Model(&models.Agency{}).
		Where("id = ?", authCtx.AgencyID).
		Updates(map[string]any{"logo_url": up.URL}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}

	var agency models.Agency
	if err := h.db.Where("id = ?", authCtx.AgencyID).First(&agency).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":            agency.ID.String(),
		"name":          agency.Name,
		"logo_url":      agency.LogoURL,
		"primary_color": agency.PrimaryColor,
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

func (h AuthHandler) Me(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var user models.AgencyUser
	if err := h.db.Where("id = ? AND agency_id = ?", authCtx.UserID, authCtx.AgencyID).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var agency models.Agency
	_ = h.db.Where("id = ?", authCtx.AgencyID).First(&agency).Error

	c.JSON(http.StatusOK, gin.H{
		"user": userDTO{
			ID:       user.ID.String(),
			AgencyID: user.AgencyID.String(),
			Email:    user.Email,
			Role:     user.Role,
			Name:     user.Name,
		},
		"agency": agencyDTO{
			ID:           agency.ID.String(),
			Name:         agency.Name,
			LogoURL:      agency.LogoURL,
			PrimaryColor: agency.PrimaryColor,
		},
	})
}

func (h AuthHandler) GoogleStart(c *gin.Context) {
	if strings.TrimSpace(h.cfg.OAuth.GoogleClientID) == "" || strings.TrimSpace(h.cfg.OAuth.GoogleClientSecret) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth not configured"})
		return
	}

	mode := strings.ToLower(strings.TrimSpace(c.Query("mode")))
	if mode != "register" {
		mode = "login"
	}
	agencyName := strings.TrimSpace(c.Query("agency_name"))
	name := strings.TrimSpace(c.Query("name"))

	state := uuid.NewString()
	h.googleStates.Put(googleState{
		State:        state,
		Mode:         mode,
		AgencyName:   agencyName,
		Name:         name,
		CreatedAtUTC: time.Now().UTC(),
	})

	cfg := h.cfg
	cfg.OAuth.PublicBaseURL = effectivePublicBaseURL(c, cfg.OAuth.PublicBaseURL)
	redirectURI := strings.TrimRight(cfg.OAuth.PublicBaseURL, "/") + "/api/v1/auth/google/callback"

	u, _ := url.Parse("https://accounts.google.com/o/oauth2/v2/auth")
	q := u.Query()
	q.Set("client_id", strings.TrimSpace(h.cfg.OAuth.GoogleClientID))
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent")
	q.Set("include_granted_scopes", "true")
	u.RawQuery = q.Encode()

	c.JSON(http.StatusOK, googleStartResponse{AuthURL: u.String()})
}

func (h AuthHandler) GoogleCallback(c *gin.Context) {
	code := strings.TrimSpace(c.Query("code"))
	state := strings.TrimSpace(c.Query("state"))
	if code == "" || state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	st, ok := h.googleStates.Pop(state)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state"})
		return
	}

	cfg := h.cfg
	cfg.OAuth.PublicBaseURL = effectivePublicBaseURL(c, cfg.OAuth.PublicBaseURL)
	redirectURI := strings.TrimRight(cfg.OAuth.PublicBaseURL, "/") + "/api/v1/auth/google/callback"

	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", strings.TrimSpace(h.cfg.OAuth.GoogleClientID))
	form.Set("client_secret", strings.TrimSpace(h.cfg.OAuth.GoogleClientSecret))
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(form.Encode()))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}

	var tokenRes struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenRes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}
	idToken := strings.TrimSpace(tokenRes.IDToken)
	if idToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}

	tiReq, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, "https://oauth2.googleapis.com/tokeninfo?id_token="+url.QueryEscape(idToken), nil)
	tiRes, err := http.DefaultClient.Do(tiReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}
	defer tiRes.Body.Close()
	if tiRes.StatusCode < 200 || tiRes.StatusCode >= 300 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}
	var claims struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(tiRes.Body).Decode(&claims); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	sub := strings.TrimSpace(claims.Sub)
	displayName := strings.TrimSpace(claims.Name)
	if displayName == "" {
		displayName = strings.TrimSpace(st.Name)
	}
	if email == "" || sub == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "google oauth failed"})
		return
	}

	var user models.AgencyUser
	err = h.db.Where("google_sub = ?", sub).First(&user).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = h.db.Where("email = ?", email).First(&user).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
			return
		}
	}

	var agency models.Agency
	var created bool

	if user.ID == uuid.Nil {
		agencyName := strings.TrimSpace(st.AgencyName)
		if strings.ToLower(strings.TrimSpace(st.Mode)) == "register" && agencyName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "agency_name required"})
			return
		}
		if agencyName == "" {
			local := strings.Split(email, "@")
			if len(local) > 0 && strings.TrimSpace(local[0]) != "" {
				agencyName = strings.TrimSpace(local[0])
			} else {
				agencyName = "My Agency"
			}
		}

		pw, _ := randomDigits(24)
		pwHash, err := auth.HashPassword(pw)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
			return
		}

		err = h.db.Transaction(func(tx *gorm.DB) error {
			agency = models.Agency{
				Name:         agencyName,
				LogoURL:      "/trenspire.png",
				PrimaryColor: "#5b00ff",
			}
			if err := tx.Create(&agency).Error; err != nil {
				return err
			}
			user = models.AgencyUser{
				AgencyID:     agency.ID,
				Email:        email,
				GoogleSub:    sub,
				PasswordHash: pwHash,
				Role:         "owner",
				Name:         displayName,
			}
			if err := tx.Create(&user).Error; err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			if isUniqueViolation(err) {
				c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
			return
		}
		created = true
	} else {
		if strings.TrimSpace(user.GoogleSub) == "" || strings.TrimSpace(user.GoogleSub) != sub {
			_ = h.db.Model(&models.AgencyUser{}).Where("id = ?", user.ID).Update("google_sub", sub).Error
			user.GoogleSub = sub
		}
		_ = h.db.Where("id = ?", user.AgencyID).First(&agency).Error
	}

	now := time.Now().UTC()
	_ = h.db.Model(&models.AgencyUser{}).Where("id = ?", user.ID).Update("last_login_at", &now).Error
	user.LastLoginAt = &now

	accessRes, err := auth.NewAccessToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}
	refreshRes, err := auth.NewRefreshToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	frontend := strings.TrimRight(strings.TrimSpace(h.cfg.OAuth.FrontendBaseURL), "/")
	if frontend == "" {
		frontend = "http://localhost:5173"
	}
	v := url.Values{}
	v.Set("access_token", accessRes.Token)
	v.Set("refresh_token", refreshRes.Token)
	v.Set("token_type", "Bearer")
	v.Set("created", fmt.Sprintf("%t", created))
	c.Redirect(http.StatusFound, frontend+"/login#"+v.Encode())
}

func (h AuthHandler) WhatsAppRequestOTP(c *gin.Context) {
	var req whatsappRequestOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	phone := normalizePhone(req.Phone)
	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid phone"})
		return
	}

	code, err := randomDigits(6)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "otp failed"})
		return
	}
	hash := otpHash(h.cfg.Auth.JWTSecret, phone, code)
	expires := h.otpStore.Put(phone, hash)

	sendErr := h.sendWhatsAppOTP(c.Request.Context(), phone, code)
	if sendErr != nil {
		if isProdEnv(h.cfg) {
			c.JSON(http.StatusBadGateway, gin.H{"error": "whatsapp send failed"})
			return
		}
		c.JSON(http.StatusOK, whatsappRequestOTPResponse{
			Sent:         false,
			ExpiresInSec: expires,
			DevCode:      code,
		})
		return
	}

	c.JSON(http.StatusOK, whatsappRequestOTPResponse{
		Sent:         true,
		ExpiresInSec: expires,
	})
}

func (h AuthHandler) WhatsAppVerifyOTP(c *gin.Context) {
	var req whatsappVerifyOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode != "register" {
		mode = "login"
	}

	phone := normalizePhone(req.Phone)
	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	otp := strings.TrimSpace(req.OTP)
	if otp == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	hash := otpHash(h.cfg.Auth.JWTSecret, phone, otp)
	ok, found := h.otpStore.Verify(phone, hash)
	if !found || !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid otp"})
		return
	}

	var user models.AgencyUser
	var agency models.Agency

	err := h.db.Where("phone = ?", phone).First(&user).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		return
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		if mode != "register" {
			c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
			return
		}
		agencyName := strings.TrimSpace(req.AgencyName)
		if agencyName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "agency_name required"})
			return
		}

		pw, _ := randomDigits(24)
		pwHash, err := auth.HashPassword(pw)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
			return
		}

		logoURL := strings.TrimSpace(req.LogoURL)
		if logoURL == "" {
			logoURL = "/trenspire.png"
		}
		primary := strings.TrimSpace(req.PrimaryColor)
		if primary == "" {
			primary = "#5b00ff"
		}

		err = h.db.Transaction(func(tx *gorm.DB) error {
			agency = models.Agency{
				Name:         agencyName,
				LogoURL:      logoURL,
				PrimaryColor: primary,
			}
			if err := tx.Create(&agency).Error; err != nil {
				return err
			}
			user = models.AgencyUser{
				AgencyID:     agency.ID,
				Email:        phoneToEmail(phone),
				Phone:        phone,
				PasswordHash: pwHash,
				Role:         "owner",
				Name:         strings.TrimSpace(req.Name),
			}
			if err := tx.Create(&user).Error; err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			if isUniqueViolation(err) {
				c.JSON(http.StatusConflict, gin.H{"error": "phone already registered"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "registration failed"})
			return
		}
	} else {
		_ = h.db.Where("id = ?", user.AgencyID).First(&agency).Error
	}

	now := time.Now().UTC()
	_ = h.db.Model(&models.AgencyUser{}).Where("id = ?", user.ID).Update("last_login_at", &now).Error
	user.LastLoginAt = &now

	tokenRes, err := auth.NewAccessToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}
	refreshRes, err := auth.NewRefreshToken(h.cfg.Auth, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	c.JSON(http.StatusOK, authResponse{
		AccessToken:      tokenRes.Token,
		TokenType:        "Bearer",
		ExpiresAt:        tokenRes.ExpiresAt,
		RefreshToken:     refreshRes.Token,
		RefreshExpiresAt: refreshRes.ExpiresAt,
		User: userDTO{
			ID:       user.ID.String(),
			AgencyID: user.AgencyID.String(),
			Email:    user.Email,
			Role:     user.Role,
			Name:     user.Name,
		},
		Agency: agencyDTO{
			ID:           agency.ID.String(),
			Name:         agency.Name,
			LogoURL:      agency.LogoURL,
			PrimaryColor: agency.PrimaryColor,
		},
	})
}
