package migrate

import (
	"trendspire/internal/models"

	"gorm.io/gorm"
)

func Run(gormDB *gorm.DB) error {
	if err := gormDB.Exec(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).Error; err != nil {
		return err
	}

	return gormDB.AutoMigrate(
		&models.Agency{},
		&models.AgencyUser{},
		&models.Client{},
		&models.SocialAccount{},
		&models.Post{},
		&models.PostMedia{},
		&models.Schedule{},
		&models.AIGeneration{},
		&models.PublishAttempt{},
		&models.AnalyticsDaily{},
		&models.AnalyticsPost{},
		&models.AnalyticsAlert{},
		&models.Report{},
		&models.CompetitorAnalysis{},
		&models.OfflineCampaign{},
	)
}
