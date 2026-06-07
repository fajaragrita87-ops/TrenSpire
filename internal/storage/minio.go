package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
	"time"

	"trendspire/internal/config"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type UploadedObject struct {
	URL      string
	MimeType string
}

func UploadToMinIO(ctx context.Context, cfg config.Config, r io.Reader, size int64, contentType string) (UploadedObject, error) {
	if cfg.Storage.MinIOEndpoint == "" || cfg.Storage.MinIOAccessKey == "" || cfg.Storage.MinIOSecretKey == "" {
		return UploadedObject{}, errors.New("minio not configured")
	}

	mc, err := minio.New(cfg.Storage.MinIOEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.Storage.MinIOAccessKey, cfg.Storage.MinIOSecretKey, ""),
		Secure: cfg.Storage.MinIOUseSSL,
	})
	if err != nil {
		return UploadedObject{}, err
	}

	bucket := strings.TrimSpace(cfg.Storage.MinIOBucket)
	if bucket == "" {
		return UploadedObject{}, errors.New("minio bucket not configured")
	}

	ok, err := mc.BucketExists(ctx, bucket)
	if err != nil {
		return UploadedObject{}, err
	}
	if !ok {
		if err := mc.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return UploadedObject{}, err
		}
	}

	objectName := uuid.NewString()
	opts := minio.PutObjectOptions{}
	if strings.TrimSpace(contentType) != "" {
		opts.ContentType = strings.TrimSpace(contentType)
	}

	_, err = mc.PutObject(ctx, bucket, objectName, r, size, opts)
	if err != nil {
		return UploadedObject{}, err
	}

	publicBase := strings.TrimRight(strings.TrimSpace(cfg.Storage.MinIOPublicURL), "/")
	if publicBase == "" {
		scheme := "http"
		if cfg.Storage.MinIOUseSSL {
			scheme = "https"
		}
		publicBase = fmt.Sprintf("%s://%s", scheme, cfg.Storage.MinIOEndpoint)
	}

	u, err := url.Parse(publicBase)
	if err != nil {
		return UploadedObject{}, err
	}
	u.Path = path.Join(u.Path, bucket, objectName)

	return UploadedObject{
		URL:      u.String(),
		MimeType: opts.ContentType,
	}, nil
}

func UploadBytesToMinIO(ctx context.Context, cfg config.Config, b []byte, contentType string) (UploadedObject, error) {
	return UploadToMinIO(ctx, cfg, bytes.NewReader(b), int64(len(b)), contentType)
}

func PresignGetURL(ctx context.Context, cfg config.Config, objectName string, expiry time.Duration) (string, error) {
	if cfg.Storage.MinIOEndpoint == "" || cfg.Storage.MinIOAccessKey == "" || cfg.Storage.MinIOSecretKey == "" {
		return "", errors.New("minio not configured")
	}
	mc, err := minio.New(cfg.Storage.MinIOEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.Storage.MinIOAccessKey, cfg.Storage.MinIOSecretKey, ""),
		Secure: cfg.Storage.MinIOUseSSL,
	})
	if err != nil {
		return "", err
	}
	bucket := strings.TrimSpace(cfg.Storage.MinIOBucket)
	if bucket == "" {
		return "", errors.New("minio bucket not configured")
	}
	u, err := mc.PresignedGetObject(ctx, bucket, objectName, expiry, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
