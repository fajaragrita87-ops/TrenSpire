package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/db"
	"trendspire/internal/httpapi"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	gormDB, err := db.OpenPostgres(cfg.DB)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}

	router := httpapi.NewRouter(cfg, gormDB)

	srv := &http.Server{
		Addr:              ":" + cfg.Server.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-stop:
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}

	ctx, cancel := config.ShutdownContext(10 * time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
