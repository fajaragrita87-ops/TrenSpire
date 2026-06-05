package main

import (
	"log"

	"trendspire/internal/config"
	"trendspire/internal/db"
	"trendspire/internal/migrate"
)

func main() {
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

