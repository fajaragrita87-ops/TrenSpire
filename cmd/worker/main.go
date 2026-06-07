package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"trendspire/internal/config"
	"trendspire/internal/db"
	"trendspire/internal/queue"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	gormDB, err := db.OpenPostgres(cfg.DB)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}

	worker := queue.NewWorker(cfg, gormDB)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() {
		errCh <- worker.Start()
	}()

	select {
	case <-stop:
		worker.Stop()
	case err := <-errCh:
		if err != nil {
			log.Fatalf("worker failed: %v", err)
		}
	}
}
