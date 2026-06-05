package config

import (
	"os"
	"strconv"
)

type Config struct {
	Server ServerConfig
	DB     PostgresConfig
	Auth   AuthConfig
}

type ServerConfig struct {
	Port string
	Env  string
}

type PostgresConfig struct {
	URL      string
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

type AuthConfig struct {
	JWTSecret            string
	JWTIssuer            string
	AccessTokenTTLMinute int
}

func Load() Config {
	return Config{
		Server: ServerConfig{
			Port: getEnv("PORT", "8080"),
			Env:  getEnv("APP_ENV", "development"),
		},
		DB: PostgresConfig{
			URL:      os.Getenv("DATABASE_URL"),
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "postgres"),
			Password: getEnv("DB_PASSWORD", "postgres"),
			DBName:   getEnv("DB_NAME", "trendspire"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
		Auth: AuthConfig{
			JWTSecret:            getEnv("JWT_SECRET", "dev-secret-change-me"),
			JWTIssuer:            getEnv("JWT_ISSUER", "trendspire"),
			AccessTokenTTLMinute: getEnvInt("JWT_ACCESS_TTL_MIN", 60),
		},
	}
}

func getEnv(key string, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}

func getEnvInt(key string, fallback int) int {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return fallback
	}
	return parsed
}
