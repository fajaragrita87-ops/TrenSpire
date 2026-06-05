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
	jwt.RegisteredClaims
}

type AccessTokenResult struct {
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

