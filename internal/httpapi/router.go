package httpapi

import (
	"strings"

	"trendspire/internal/config"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func NewRouter(cfg config.Config, gormDB *gorm.DB) *gin.Engine {
	env := strings.ToLower(strings.TrimSpace(cfg.Server.Env))
	if env == "production" || env == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())

	v1 := r.Group("/api/v1")
	{
		authHandler := NewAuthHandler(cfg, gormDB)
		auth := v1.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
		}

		protected := v1.Group("")
		protected.Use(RequireJWT(cfg.Auth))
		{
			healthHandler := NewHealthHandler(gormDB)
			protected.GET("/health", healthHandler.Health)

			clientsHandler := NewClientsHandler(gormDB)
			clients := protected.Group("")
			clients.Use(RequireRole("owner", "admin"))
			{
				clients.POST("/clients", clientsHandler.CreateClient)
				clients.GET("/clients", clientsHandler.ListClients)
			}
		}
	}

	return r
}
