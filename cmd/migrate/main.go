package main

import (
	"log"

	"trendspire/internal/config"
	"trendspire/internal/db"
	"trendspire/internal/migrate"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	gormDB, err := db.OpenPostgres(cfg.DB)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}

	if err := migrate.Run(gormDB); err != nil {
		log.Fatalf("migrate failed: %v", err)
	}

	log.Printf("migrate ok")
}
