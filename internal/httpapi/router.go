package httpapi

import (
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/oauth"

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

	healthHandler := NewHealthHandler(gormDB)
	r.GET("/healthz", healthHandler.Health)

	reportsHandler := NewReportsHandler(cfg, gormDB)
	r.GET("/r/:token", reportsHandler.View)
	r.GET("/r/:token/download", reportsHandler.Download)

	v1 := r.Group("/api/v1")
	{
		authHandler := NewAuthHandler(cfg, gormDB)
		accountsHandler := NewAccountsHandler(cfg, gormDB, oauth.NewStateStore(10*time.Minute))

		auth := v1.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.POST("/refresh", authHandler.Refresh)
		}

		v1.GET("/accounts/:platform/callback", accountsHandler.Callback)

		protected := v1.Group("")
		protected.Use(RequireJWT(cfg.Auth))
		{
			protected.GET("/health", healthHandler.Health)

			clientsHandler := NewClientsHandler(gormDB)
			postsHandler := NewPostsHandler(cfg, gormDB)
			aiHandler := NewAIHandler(cfg, gormDB)
			competitorHandler := NewCompetitorHandler(cfg, gormDB)
			offlineHandler := NewOfflineHandler(cfg, gormDB)
			analyticsHandler := NewAnalyticsHandler(cfg, gormDB)
			reportsHandler := NewReportsHandler(cfg, gormDB)
			admin := protected.Group("")
			admin.Use(RequireRole("owner", "admin"))
			{
				admin.POST("/clients", clientsHandler.CreateClient)
				admin.GET("/clients", clientsHandler.ListClients)
				admin.PATCH("/clients/:id", clientsHandler.UpdateClient)
				admin.POST("/accounts/:platform/connect", accountsHandler.Connect)
				admin.GET("/accounts", accountsHandler.List)
				admin.POST("/posts", postsHandler.CreatePost)
				admin.GET("/posts", postsHandler.ListPosts)
				admin.POST("/posts/:id/schedule", postsHandler.SchedulePost)
				admin.POST("/posts/:id/publish-now", postsHandler.PublishNow)
				admin.GET("/calendar/posts", postsHandler.CalendarPosts)
				admin.POST("/ai/caption", aiHandler.Caption)
				admin.POST("/ai/hashtags", aiHandler.Hashtags)
				admin.POST("/ai/content-plan", aiHandler.ContentPlan)
				admin.POST("/competitor/analyze", competitorHandler.Analyze)
				admin.POST("/offline/campaigns", offlineHandler.CreateCampaign)
				admin.GET("/analytics/clients/:id", analyticsHandler.ClientAnalytics)
				admin.GET("/analytics/dashboard", analyticsHandler.Dashboard)
				admin.POST("/reports", reportsHandler.CreateReport)
				admin.GET("/reports", reportsHandler.ListReports)
				admin.POST("/reports/:token/refresh", reportsHandler.Refresh)
			}
		}
	}

	return r
}
