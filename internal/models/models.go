package models

import (
	"time"

	"github.com/google/uuid"
)

type Agency struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Name      string    `gorm:"type:text;not null"`
	LogoURL   string    `gorm:"type:text"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`

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
	ExpiresAt         *time.Time
	ConnectedAt       *time.Time
	CreatedAt         time.Time `gorm:"not null"`
	UpdatedAt         time.Time `gorm:"not null"`

	Client Client `gorm:"foreignKey:ClientID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}

