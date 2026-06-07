package auth

import (
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"

	"github.com/golang-jwt/jwt/v5"
)

type AccessTokenClaims struct {
	AgencyID string `json:"agency_id"`
	Role     string `json:"role"`
	Email    string `json:"email"`
	TokenUse string `json:"token_use"`
	jwt.RegisteredClaims
}

type AccessTokenResult struct {
	Token     string
	ExpiresAt time.Time
}

type RefreshTokenClaims struct {
	AgencyID  string `json:"agency_id"`
	TokenUse string `json:"token_use"`
	jwt.RegisteredClaims
}

type RefreshTokenResult struct {
	Token     string
	ExpiresAt time.Time
}

func NewAccessToken(cfg config.AuthConfig, user models.AgencyUser) (AccessTokenResult, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(time.Duration(cfg.AccessTokenTTLMinute) * time.Minute)

	claims := AccessTokenClaims{
		AgencyID: user.AgencyID.String(),
		Role:     user.Role,
		Email:    user.Email,
		TokenUse: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    cfg.JWTIssuer,
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(cfg.JWTSecret))
	if err != nil {
		return AccessTokenResult{}, err
	}

	return AccessTokenResult{Token: signed, ExpiresAt: expiresAt}, nil
}

func NewRefreshToken(cfg config.AuthConfig, user models.AgencyUser) (RefreshTokenResult, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(time.Duration(cfg.RefreshTokenTTLDays) * 24 * time.Hour)

	claims := RefreshTokenClaims{
		AgencyID:  user.AgencyID.String(),
		TokenUse: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    cfg.JWTIssuer,
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(cfg.JWTSecret))
	if err != nil {
		return RefreshTokenResult{}, err
	}

	return RefreshTokenResult{Token: signed, ExpiresAt: expiresAt}, nil
}
