package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Server ServerConfig
	DB     PostgresConfig
	Auth   AuthConfig
	Crypto CryptoConfig
	OAuth  OAuthConfig
	AI     AIConfig
	Queue  QueueConfig
	Storage StorageConfig
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
	RefreshTokenTTLDays  int
}

type CryptoConfig struct {
	EncryptionKeyB64 string
}

type OAuthConfig struct {
	PublicBaseURL string

	MetaAppID     string
	MetaAppSecret string

	TikTokClientKey    string
	TikTokClientSecret string

	XClientID     string
	XClientSecret string
}

type AIConfig struct {
	OpenAIAPIKey string
	OpenAIModel  string
	OpenAIBaseURL string
}

type QueueConfig struct {
	RedisAddr     string
	RedisPassword string
	RedisDB       int
}

type StorageConfig struct {
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	MinIOUseSSL    bool
	MinIOPublicURL string
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
			RefreshTokenTTLDays:  getEnvInt("JWT_REFRESH_TTL_DAYS", 14),
		},
		Crypto: CryptoConfig{
			EncryptionKeyB64: os.Getenv("ENCRYPTION_KEY_B64"),
		},
		OAuth: OAuthConfig{
			PublicBaseURL: getEnv("PUBLIC_BASE_URL", "http://localhost:8080"),

			MetaAppID:     os.Getenv("META_APP_ID"),
			MetaAppSecret: os.Getenv("META_APP_SECRET"),

			TikTokClientKey:    os.Getenv("TIKTOK_CLIENT_KEY"),
			TikTokClientSecret: os.Getenv("TIKTOK_CLIENT_SECRET"),

			XClientID:     os.Getenv("X_CLIENT_ID"),
			XClientSecret: os.Getenv("X_CLIENT_SECRET"),
		},
		AI: AIConfig{
			OpenAIAPIKey: os.Getenv("OPENAI_API_KEY"),
			OpenAIModel:  getEnv("OPENAI_MODEL", "gpt-4o-mini"),
			OpenAIBaseURL: getEnv("OPENAI_BASE_URL", "https://api.openai.com"),
		},
		Queue: QueueConfig{
			RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
			RedisPassword: os.Getenv("REDIS_PASSWORD"),
			RedisDB:       getEnvInt("REDIS_DB", 0),
		},
		Storage: StorageConfig{
			MinIOEndpoint:  os.Getenv("MINIO_ENDPOINT"),
			MinIOAccessKey: os.Getenv("MINIO_ACCESS_KEY"),
			MinIOSecretKey: os.Getenv("MINIO_SECRET_KEY"),
			MinIOBucket:    getEnv("MINIO_BUCKET", "trendspire"),
			MinIOUseSSL:    strings.ToLower(strings.TrimSpace(getEnv("MINIO_USE_SSL", "false"))) == "true",
			MinIOPublicURL: os.Getenv("MINIO_PUBLIC_URL"),
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
