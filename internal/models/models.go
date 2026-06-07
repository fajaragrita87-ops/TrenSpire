package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type Agency struct {
	ID           uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Name         string    `gorm:"type:text;not null"`
	LogoURL      string    `gorm:"type:text"`
	PrimaryColor string    `gorm:"type:text"`
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`

	Users   []AgencyUser `gorm:"foreignKey:AgencyID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
	Clients []Client     `gorm:"foreignKey:AgencyID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}

type AgencyUser struct {
	ID           uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID     uuid.UUID `gorm:"type:uuid;not null;index"`
	Email        string    `gorm:"type:text;not null;uniqueIndex"`
	PasswordHash string    `gorm:"type:text;not null"`
	Role         string    `gorm:"type:text;not null;default:member"`
	Name         string    `gorm:"type:text"`
	LastLoginAt  *time.Time
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`

	Agency Agency `gorm:"foreignKey:AgencyID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}

type Client struct {
	ID              uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID        uuid.UUID `gorm:"type:uuid;not null;index"`
	Name            string    `gorm:"type:text;not null"`
	LogoURL         string    `gorm:"type:text"`
	ReportBrandName string    `gorm:"type:text"`
	Industry        string    `gorm:"type:text"`
	Location        string    `gorm:"type:text"`
	CreatedAt       time.Time `gorm:"not null"`
	UpdatedAt       time.Time `gorm:"not null"`

	Agency         Agency          `gorm:"foreignKey:AgencyID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
	SocialAccounts []SocialAccount `gorm:"foreignKey:ClientID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}

type SocialAccount struct {
	ID                uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	ClientID          uuid.UUID `gorm:"type:uuid;not null;index"`
	Platform          string    `gorm:"type:text;not null;index"`
	ExternalAccountID string    `gorm:"type:text"`
	Username          string    `gorm:"type:text"`
	AccessToken       string    `gorm:"type:text"`
	RefreshToken      string    `gorm:"type:text"`
	FollowersCount    int64     `gorm:"not null;default:0"`
	ExpiresAt         *time.Time
	ConnectedAt       *time.Time
	CreatedAt         time.Time `gorm:"not null"`
	UpdatedAt         time.Time `gorm:"not null"`

	Client Client `gorm:"foreignKey:ClientID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}

type Post struct {
	ID        uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID  uuid.UUID      `gorm:"type:uuid;not null;index"`
	ClientID  uuid.UUID      `gorm:"type:uuid;not null;index"`
	Content   string         `gorm:"type:text;not null"`
	Platforms datatypes.JSON `gorm:"type:jsonb;not null"`
	Status    string         `gorm:"type:text;not null;default:draft"`
	CreatedAt time.Time      `gorm:"not null"`
	UpdatedAt time.Time      `gorm:"not null"`

	Client    Client      `gorm:"foreignKey:ClientID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
	Media     []PostMedia `gorm:"foreignKey:PostID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Schedules []Schedule  `gorm:"foreignKey:PostID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

type PostMedia struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	PostID    uuid.UUID `gorm:"type:uuid;not null;index"`
	URL       string    `gorm:"type:text;not null"`
	MimeType  string    `gorm:"type:text"`
	CreatedAt time.Time `gorm:"not null"`

	Post Post `gorm:"foreignKey:PostID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

type Schedule struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	PostID    uuid.UUID `gorm:"type:uuid;not null;index"`
	ExecuteAt time.Time `gorm:"not null;index"`
	Status    string    `gorm:"type:text;not null;default:scheduled"`
	CreatedAt time.Time `gorm:"not null"`

	Post Post `gorm:"foreignKey:PostID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

type AIGeneration struct {
	ID               uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID         uuid.UUID      `gorm:"type:uuid;not null;index"`
	UserID           uuid.UUID      `gorm:"type:uuid;not null;index"`
	Kind             string         `gorm:"type:text;not null;index"`
	Model            string         `gorm:"type:text;not null"`
	Input            datatypes.JSON `gorm:"type:jsonb;not null"`
	Output           datatypes.JSON `gorm:"type:jsonb;not null"`
	PromptTokens     int            `gorm:"not null;default:0"`
	CompletionTokens int            `gorm:"not null;default:0"`
	TotalTokens      int            `gorm:"not null;default:0"`
	CostUSD          float64        `gorm:"type:numeric(12,6);not null;default:0"`
	CreatedAt        time.Time      `gorm:"not null"`
}

type PublishAttempt struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	PostID    uuid.UUID `gorm:"type:uuid;not null;index"`
	Platform  string    `gorm:"type:text;not null;index"`
	Status    string    `gorm:"type:text;not null"`
	Attempt   int       `gorm:"not null;default:1"`
	Error     string    `gorm:"type:text"`
	CreatedAt time.Time `gorm:"not null"`

	Post Post `gorm:"foreignKey:PostID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

type AnalyticsDaily struct {
	ID             uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID       uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_analytics_daily_unique"`
	ClientID       uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_analytics_daily_unique"`
	Platform       string    `gorm:"type:text;not null;index;uniqueIndex:idx_analytics_daily_unique"`
	Date           time.Time `gorm:"type:date;not null;index;uniqueIndex:idx_analytics_daily_unique"`
	Followers      int64     `gorm:"not null;default:0"`
	Likes          int64     `gorm:"not null;default:0"`
	Comments       int64     `gorm:"not null;default:0"`
	Impressions    int64     `gorm:"not null;default:0"`
	EngagementRate float64   `gorm:"type:numeric(10,6);not null;default:0"`
	WoWGrowthPct   float64   `gorm:"type:numeric(10,6);not null;default:0"`
	MoMGrowthPct   float64   `gorm:"type:numeric(10,6);not null;default:0"`
	CreatedAt      time.Time `gorm:"not null"`
	UpdatedAt      time.Time `gorm:"not null"`
}

type AnalyticsPost struct {
	ID          uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID    uuid.UUID `gorm:"type:uuid;not null;index"`
	ClientID    uuid.UUID `gorm:"type:uuid;not null;index"`
	PostID      uuid.UUID `gorm:"type:uuid;not null;index"`
	Platform    string    `gorm:"type:text;not null;index"`
	Likes       int64     `gorm:"not null;default:0"`
	Comments    int64     `gorm:"not null;default:0"`
	Impressions int64     `gorm:"not null;default:0"`
	FetchedAt   time.Time `gorm:"not null;index"`
	CreatedAt   time.Time `gorm:"not null"`

	Post Post `gorm:"foreignKey:PostID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

type AnalyticsAlert struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID  uuid.UUID `gorm:"type:uuid;not null;index"`
	ClientID  uuid.UUID `gorm:"type:uuid;not null;index"`
	Platform  string    `gorm:"type:text;not null;index"`
	Date      time.Time `gorm:"type:date;not null;index"`
	Metric    string    `gorm:"type:text;not null"`
	PrevValue int64     `gorm:"not null;default:0"`
	Value     int64     `gorm:"not null;default:0"`
	ChangePct float64   `gorm:"type:numeric(10,6);not null;default:0"`
	CreatedAt time.Time `gorm:"not null"`
}

type Report struct {
	ID            uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID      uuid.UUID  `gorm:"type:uuid;not null;index"`
	ClientID      uuid.UUID  `gorm:"type:uuid;not null;index"`
	Token         string     `gorm:"type:text;not null;uniqueIndex"`
	PDFURL        string     `gorm:"type:text;not null"`
	HTML          string     `gorm:"type:text;not null"`
	PeriodStart   *time.Time `gorm:"type:date;index"`
	PeriodEnd     *time.Time `gorm:"type:date;index"`
	CreatedAt     time.Time  `gorm:"not null;index"`
	ExpiresAt     *time.Time `gorm:"index"`
	ViewCount     int64      `gorm:"not null;default:0"`
	DownloadCount int64      `gorm:"not null;default:0"`

	Client Client `gorm:"foreignKey:ClientID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}

func MustMarshalPlatforms(platforms []string) datatypes.JSON {
	b, _ := json.Marshal(platforms)
	return datatypes.JSON(b)
}

type CompetitorAnalysis struct {
	ID         uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID   uuid.UUID      `gorm:"type:uuid;not null;index"`
	UserID     uuid.UUID      `gorm:"type:uuid;not null;index"`
	ClientID   *uuid.UUID     `gorm:"type:uuid;index"`
	ClientName string         `gorm:"type:text;not null"`
	Industry   string         `gorm:"type:text"`
	Location   string         `gorm:"type:text"`
	Input      datatypes.JSON `gorm:"type:jsonb;not null"`
	Output     datatypes.JSON `gorm:"type:jsonb;not null"`
	CreatedAt  time.Time      `gorm:"not null;index"`
}

type OfflineCampaign struct {
	ID        uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AgencyID  uuid.UUID      `gorm:"type:uuid;not null;index"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null;index"`
	ClientID  *uuid.UUID     `gorm:"type:uuid;index"`
	FileURL   string         `gorm:"type:text;not null"`
	FileMime  string         `gorm:"type:text;not null"`
	Status    string         `gorm:"type:text;not null;default:uploaded"`
	Extracted datatypes.JSON `gorm:"type:jsonb"`
	CreatedAt time.Time      `gorm:"not null;index"`
	UpdatedAt time.Time      `gorm:"not null"`
}
