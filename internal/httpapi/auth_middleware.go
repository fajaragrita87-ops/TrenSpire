package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"trendspire/internal/auth"
	"trendspire/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type AuthContext struct {
	UserID   uuid.UUID
	AgencyID uuid.UUID
	Role     string
	Email    string
}

const authContextKey = "auth.ctx"

func RequireJWT(cfg config.AuthConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if h == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization"})
			return
		}

		parts := strings.SplitN(h, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization"})
			return
		}

		tokenStr := strings.TrimSpace(parts[1])
		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization"})
			return
		}

		claims := auth.AccessTokenClaims{}
		token, err := jwt.ParseWithClaims(tokenStr, &claims, func(t *jwt.Token) (any, error) {
			if t.Method != jwt.SigningMethodHS256 {
				return nil, jwt.ErrTokenSignatureInvalid
			}
			return []byte(cfg.JWTSecret), nil
		}, jwt.WithIssuer(cfg.JWTIssuer))
		if err != nil || token == nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		userID, err := uuid.Parse(strings.TrimSpace(claims.Subject))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		agencyID, err := uuid.Parse(strings.TrimSpace(claims.AgencyID))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		c.Set(authContextKey, AuthContext{
			UserID:   userID,
			AgencyID: agencyID,
			Role:     strings.ToLower(strings.TrimSpace(claims.Role)),
			Email:    strings.ToLower(strings.TrimSpace(claims.Email)),
		})

		c.Next()
	}
}

func RequireRole(allowedRoles ...string) gin.HandlerFunc {
	roleSet := map[string]struct{}{}
	for _, r := range allowedRoles {
		roleSet[strings.ToLower(strings.TrimSpace(r))] = struct{}{}
	}

	return func(c *gin.Context) {
		authCtx, err := GetAuthContext(c)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		if _, ok := roleSet[authCtx.Role]; !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}

		c.Next()
	}
}

func GetAuthContext(c *gin.Context) (AuthContext, error) {
	v, ok := c.Get(authContextKey)
	if !ok {
		return AuthContext{}, errors.New("missing auth context")
	}
	authCtx, ok := v.(AuthContext)
	if !ok {
		return AuthContext{}, errors.New("invalid auth context")
	}
	return authCtx, nil
}

