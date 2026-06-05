package db

import (
	"fmt"

	"trendspire/internal/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func OpenPostgres(cfg config.PostgresConfig) (*gorm.DB, error) {
	dsn := cfg.URL
	if dsn == "" {
		dsn = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			cfg.Host,
			cfg.Port,
			cfg.User,
			cfg.Password,
			cfg.DBName,
			cfg.SSLMode,
		)
	}

	return gorm.Open(postgres.Open(dsn), &gorm.Config{})
}

