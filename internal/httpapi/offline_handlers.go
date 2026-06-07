package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"
	"trendspire/internal/storage"

	"github.com/chromedp/chromedp"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type OfflineHandler struct {
	cfg config.Config
	db  *gorm.DB
}

func NewOfflineHandler(cfg config.Config, db *gorm.DB) OfflineHandler {
	return OfflineHandler{cfg: cfg, db: db}
}

func (h OfflineHandler) CreateCampaign(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	if strings.TrimSpace(h.cfg.AI.OpenAIAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI not configured"})
		return
	}

	clientID, err := parseOptionalUUID(c.PostForm("client_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if clientID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_id required"})
		return
	}

	fh, err := firstFile(c, "file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	f, err := fh.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	defer func() { _ = f.Close() }()

	mime := strings.TrimSpace(fh.Header.Get("Content-Type"))
	up, err := storage.UploadToMinIO(c.Request.Context(), h.cfg, f, fh.Size, mime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "upload failed"})
		return
	}

	now := time.Now().UTC()
	row := models.OfflineCampaign{
		AgencyID:  authCtx.AgencyID,
		UserID:    authCtx.UserID,
		ClientID:  clientID,
		FileURL:   up.URL,
		FileMime:  mime,
		Status:    "uploaded",
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.db.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save failed"})
		return
	}

	extracted, usage, model, extractErr := h.extractCampaignData(c.Request.Context(), up.URL, mime)
	if extractErr != nil {
		_ = h.db.Model(&models.OfflineCampaign{}).Where("id = ?", row.ID).Updates(map[string]any{
			"status":     "extract_failed",
			"updated_at": time.Now().UTC(),
		}).Error
		c.JSON(http.StatusBadRequest, gin.H{"error": extractErr.Error()})
		return
	}

	outB, _ := json.Marshal(extracted)
	out := datatypes.JSON(outB)
	_ = h.db.Model(&models.OfflineCampaign{}).Where("id = ?", row.ID).Updates(map[string]any{
		"status":     "extracted",
		"extracted":  out,
		"updated_at": time.Now().UTC(),
	}).Error

	in := mustJSON(datatypes.JSONMap{
		"file_url":  up.URL,
		"file_mime": mime,
	})
	_ = h.db.Create(&models.AIGeneration{
		AgencyID:         authCtx.AgencyID,
		UserID:           authCtx.UserID,
		Kind:             "offline_extract",
		Model:            model,
		Input:            in,
		Output:           mustJSON(datatypes.JSONMap{"extracted": extracted}),
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		CostUSD:          calcCostUSD(usage.TotalTokens),
		CreatedAt:        time.Now().UTC(),
	}).Error

	c.JSON(http.StatusCreated, gin.H{
		"id":        row.ID.String(),
		"file_url":  up.URL,
		"file_mime": mime,
		"status":    "extracted",
		"data":      extracted,
	})
}

func (h OfflineHandler) extractCampaignData(ctx context.Context, fileURL string, mime string) (map[string]any, openAIUsage, string, error) {
	ai := NewAIHandler(h.cfg, h.db)

	system := "You extract structured marketing campaign data. Respond ONLY as a valid JSON object (no markdown)."
	user := "Extract campaign info. Return JSON with keys:\n" +
		"campaign: {name, objective, location, start_date, end_date, channels, budget, kpis}\n" +
		"assets: array of {type, description}\n" +
		"notes: string\n"

	mime = strings.ToLower(strings.TrimSpace(mime))

	if strings.HasPrefix(mime, "image/") {
		u, err := storage.PresignGetURL(ctx, h.cfg, extractObjectNameFromMinioURL(fileURL), 30*time.Minute)
		if err != nil {
			return nil, openAIUsage{}, "", err
		}
		raw, usage, model, err := ai.openAIChatJSONWithImageURLs(ctx, system, user, []string{u})
		if err != nil {
			return nil, usage, model, err
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return nil, usage, model, err
		}
		return parsed, usage, model, nil
	}

	if mime == "application/pdf" {
		imgBytes, err := renderPDFPreviewPNG(ctx, fileURL)
		if err != nil {
			return nil, openAIUsage{}, "", err
		}
		up, err := storage.UploadBytesToMinIO(ctx, h.cfg, imgBytes, "image/png")
		if err != nil {
			return nil, openAIUsage{}, "", err
		}
		u, err := storage.PresignGetURL(ctx, h.cfg, extractObjectNameFromMinioURL(up.URL), 30*time.Minute)
		if err != nil {
			return nil, openAIUsage{}, "", err
		}
		raw, usage, model, err := ai.openAIChatJSONWithImageURLs(ctx, system, user, []string{u})
		if err != nil {
			return nil, usage, model, err
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return nil, usage, model, err
		}
		return parsed, usage, model, nil
	}

	if strings.Contains(mime, "text") || mime == "text/csv" || mime == "application/json" {
		u, err := storage.PresignGetURL(ctx, h.cfg, extractObjectNameFromMinioURL(fileURL), 30*time.Minute)
		if err != nil {
			return nil, openAIUsage{}, "", err
		}
		txt, err := fetchText(ctx, u, 200_000)
		if err != nil {
			return nil, openAIUsage{}, "", err
		}
		raw, usage, model, err := ai.openAIChatJSON(ctx, system, user+"\n\nCONTENT:\n"+txt)
		if err != nil {
			return nil, usage, model, err
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return nil, usage, model, err
		}
		return parsed, usage, model, nil
	}

	return nil, openAIUsage{}, "", errorsNew("unsupported file type")
}

func renderPDFPreviewPNG(ctx context.Context, pdfURL string) ([]byte, error) {
	allocCtx, cancel := chromedp.NewExecAllocator(ctx,
		append(
			chromedp.DefaultExecAllocatorOptions[:],
			chromedp.NoDefaultBrowserCheck,
			chromedp.Flag("headless", true),
			chromedp.Flag("disable-gpu", true),
		)...,
	)
	defer cancel()
	browserCtx, cancel2 := chromedp.NewContext(allocCtx)
	defer cancel2()

	var buf []byte
	err := chromedp.Run(browserCtx,
		chromedp.Navigate(pdfURL),
		chromedp.Sleep(1200*time.Millisecond),
		chromedp.FullScreenshot(&buf, 90),
	)
	if err != nil {
		return nil, err
	}
	return buf, nil
}

func firstFile(c *gin.Context, field string) (*multipart.FileHeader, error) {
	fh, err := c.FormFile(field)
	if err == nil && fh != nil {
		return fh, nil
	}
	form, err2 := c.MultipartForm()
	if err2 != nil || form == nil {
		return nil, errorsNew("missing file")
	}
	if len(form.File[field]) == 0 {
		return nil, errorsNew("missing file")
	}
	return form.File[field][0], nil
}

func parseOptionalUUID(raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func errorsNew(msg string) error { return &simpleError{s: msg} }

type simpleError struct{ s string }

func (e *simpleError) Error() string { return e.s }

func fetchText(ctx context.Context, urlStr string, maxBytes int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return "", err
	}
	res, err := (&http.Client{Timeout: 25 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", errorsNew("fetch failed")
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, maxBytes))
	return string(b), nil
}
