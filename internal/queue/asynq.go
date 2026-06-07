package queue

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/cryptoutil"
	"trendspire/internal/models"
	"trendspire/internal/storage"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func EnqueueAt(cfg config.Config, taskType string, payload any, executeAt time.Time) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	client := asynq.NewClient(asynq.RedisClientOpt{
		Addr:     cfg.Queue.RedisAddr,
		Password: cfg.Queue.RedisPassword,
		DB:       cfg.Queue.RedisDB,
	})
	defer client.Close()

	task := asynq.NewTask(taskType, b)
	_, err = client.Enqueue(task, asynq.ProcessAt(executeAt), asynq.MaxRetry(3))
	return err
}

func EnqueueNow(cfg config.Config, taskType string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	client := asynq.NewClient(asynq.RedisClientOpt{
		Addr:     cfg.Queue.RedisAddr,
		Password: cfg.Queue.RedisPassword,
		DB:       cfg.Queue.RedisDB,
	})
	defer client.Close()

	task := asynq.NewTask(taskType, b)
	_, err = client.Enqueue(task, asynq.MaxRetry(3))
	return err
}

type Worker struct {
	server *asynq.Server
	mux    *asynq.ServeMux
	db     *gorm.DB
	cfg    config.Config
}

func NewWorker(cfg config.Config, db *gorm.DB) *Worker {
	srv := asynq.NewServer(
		asynq.RedisClientOpt{
			Addr:     cfg.Queue.RedisAddr,
			Password: cfg.Queue.RedisPassword,
			DB:       cfg.Queue.RedisDB,
		},
		asynq.Config{
			Concurrency: 10,
		},
	)

	mux := asynq.NewServeMux()
	w := &Worker{server: srv, mux: mux, db: db, cfg: cfg}
	mux.HandleFunc("posts.publish", w.handlePublishPost)
	mux.HandleFunc("analytics.refresh", w.handleAnalyticsRefresh)
	mux.HandleFunc("intel.competitor.refresh", w.handleCompetitorRefresh)
	return w
}

func (w *Worker) Start() error {
	if w == nil || w.server == nil || w.mux == nil {
		return fmt.Errorf("worker not initialized")
	}
	go w.scanDueSchedulesLoop()
	go w.scanAnalyticsLoop()
	go w.scanIntelLoop()
	return w.server.Run(w.mux)
}

func (w *Worker) Stop() {
	if w == nil || w.server == nil {
		return
	}
	w.server.Shutdown()
}

func (w *Worker) handlePublishPost(ctx context.Context, t *asynq.Task) error {
	var payload struct {
		PostID string `json:"post_id"`
	}
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return err
	}
	postID, err := uuid.Parse(strings.TrimSpace(payload.PostID))
	if err != nil {
		return errors.New("invalid post_id")
	}

	var post models.Post
	if err := w.db.Preload("Media").Where("id = ?", postID).First(&post).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	if post.Status == "published" {
		return nil
	}

	platforms := []string{}
	_ = json.Unmarshal(post.Platforms, &platforms)
	if len(platforms) == 0 {
		return nil
	}

	retryCount, _ := asynq.GetRetryCount(ctx)
	maxRetry, _ := asynq.GetMaxRetry(ctx)
	attempt := retryCount + 1
	if maxRetry <= 0 {
		maxRetry = 3
	}

	err = w.publishPost(ctx, post, platforms, attempt)
	if err != nil {
		if attempt >= maxRetry {
			_ = w.db.Model(&models.Post{}).Where("id = ?", post.ID).Update("status", "failed").Error
			_ = w.db.Model(&models.Schedule{}).
				Where("post_id = ? AND status IN ?", post.ID, []string{"scheduled", "queued"}).
				Update("status", "failed").Error
			return nil
		}
		return err
	}

	if err := w.db.Model(&models.Post{}).Where("id = ?", post.ID).Update("status", "published").Error; err != nil {
		return err
	}
	_ = w.db.Model(&models.Schedule{}).
		Where("post_id = ? AND status IN ?", post.ID, []string{"scheduled", "queued"}).
		Update("status", "executed").Error

	_ = EnqueueNow(w.cfg, "analytics.refresh", map[string]string{"post_id": post.ID.String()})
	return nil
}

func (w *Worker) publishPost(ctx context.Context, post models.Post, platforms []string, attempt int) error {
	for _, p := range platforms {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}

		var acc models.SocialAccount
		err := w.db.Where("client_id = ? AND platform = ? AND connected_at is not null", post.ClientID, p).
			Order("connected_at desc").
			First(&acc).Error
		if err != nil {
			_ = w.db.Create(&models.PublishAttempt{
				PostID:    post.ID,
				Platform:  p,
				Status:    "failed",
				Attempt:   attempt,
				Error:     "no connected account",
				CreatedAt: time.Now().UTC(),
			}).Error
			return errors.New("no connected account")
		}

		if p == "instagram" && strings.TrimSpace(w.cfg.OAuth.MetaAppID) != "" && strings.TrimSpace(w.cfg.OAuth.MetaAppSecret) != "" {
			if strings.HasPrefix(strings.TrimSpace(acc.ExternalAccountID), "mock_") {
				if err := w.publishMock(post, []string{p}, attempt); err != nil {
					return err
				}
				continue
			}
			if err := w.publishInstagram(ctx, post, acc, attempt); err != nil {
				return err
			}
			continue
		}

		if err := w.publishMock(post, []string{p}, attempt); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) publishMock(post models.Post, platforms []string, attempt int) error {
	for _, p := range platforms {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}

		var hasAccount bool
		_ = w.db.Model(&models.SocialAccount{}).
			Where("client_id = ? AND platform = ? AND connected_at is not null", post.ClientID, p).
			Select("count(*) > 0").Scan(&hasAccount).Error

		if !hasAccount {
			_ = w.db.Create(&models.PublishAttempt{
				PostID:    post.ID,
				Platform:  p,
				Status:    "failed",
				Attempt:   attempt,
				Error:     "no connected account",
				CreatedAt: time.Now().UTC(),
			}).Error
			return errors.New("no connected account")
		}

		_ = w.db.Create(&models.PublishAttempt{
			PostID:    post.ID,
			Platform:  p,
			Status:    "success",
			Attempt:   attempt,
			Error:     "",
			CreatedAt: time.Now().UTC(),
		}).Error
	}
	return nil
}

func (w *Worker) publishInstagram(ctx context.Context, post models.Post, acc models.SocialAccount, attempt int) error {
	igUserID := strings.TrimSpace(acc.ExternalAccountID)
	if igUserID == "" {
		_ = w.db.Create(&models.PublishAttempt{
			PostID:    post.ID,
			Platform:  "instagram",
			Status:    "failed",
			Attempt:   attempt,
			Error:     "missing instagram account id",
			CreatedAt: time.Now().UTC(),
		}).Error
		return errors.New("missing instagram account id")
	}

	key, err := cryptoutil.KeyFromConfig(w.cfg)
	if err != nil {
		return err
	}
	token, err := cryptoutil.DecryptString(key, acc.AccessToken)
	if err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("empty access token")
	}

	if len(post.Media) == 0 || strings.TrimSpace(post.Media[0].URL) == "" {
		_ = w.db.Create(&models.PublishAttempt{
			PostID:    post.ID,
			Platform:  "instagram",
			Status:    "failed",
			Attempt:   attempt,
			Error:     "instagram requires image_url",
			CreatedAt: time.Now().UTC(),
		}).Error
		return errors.New("instagram requires image_url")
	}

	imageURL := strings.TrimSpace(post.Media[0].URL)
	if obj := extractObjectNameFromURL(imageURL); obj != "" && strings.TrimSpace(w.cfg.Storage.MinIOEndpoint) != "" {
		if presigned, err := storage.PresignGetURL(ctx, w.cfg, obj, 2*time.Hour); err == nil && presigned != "" {
			imageURL = presigned
		}
	}

	caption := strings.TrimSpace(post.Content)
	caption = truncateRunes(caption, 2200)

	creationID, err := metaIGCreateMedia(ctx, igUserID, token, imageURL, caption)
	if err != nil {
		_ = w.db.Create(&models.PublishAttempt{
			PostID:    post.ID,
			Platform:  "instagram",
			Status:    "failed",
			Attempt:   attempt,
			Error:     err.Error(),
			CreatedAt: time.Now().UTC(),
		}).Error
		return err
	}

	if _, err := metaIGPublishMedia(ctx, igUserID, token, creationID); err != nil {
		_ = w.db.Create(&models.PublishAttempt{
			PostID:    post.ID,
			Platform:  "instagram",
			Status:    "failed",
			Attempt:   attempt,
			Error:     err.Error(),
			CreatedAt: time.Now().UTC(),
		}).Error
		return err
	}

	_ = w.db.Create(&models.PublishAttempt{
		PostID:    post.ID,
		Platform:  "instagram",
		Status:    "success",
		Attempt:   attempt,
		Error:     "",
		CreatedAt: time.Now().UTC(),
	}).Error
	return nil
}

func metaIGCreateMedia(ctx context.Context, igUserID, accessToken, imageURL, caption string) (string, error) {
	form := url.Values{}
	form.Set("image_url", strings.TrimSpace(imageURL))
	form.Set("caption", strings.TrimSpace(caption))
	form.Set("access_token", strings.TrimSpace(accessToken))

	endpoint := fmt.Sprintf("https://graph.facebook.com/v20.0/%s/media", url.PathEscape(igUserID))
	var parsed struct {
		ID string `json:"id"`
	}
	if err := metaPOSTForm(ctx, endpoint, form, &parsed); err != nil {
		return "", err
	}
	id := strings.TrimSpace(parsed.ID)
	if id == "" {
		return "", errors.New("instagram media container failed")
	}
	return id, nil
}

func metaIGPublishMedia(ctx context.Context, igUserID, accessToken, creationID string) (string, error) {
	form := url.Values{}
	form.Set("creation_id", strings.TrimSpace(creationID))
	form.Set("access_token", strings.TrimSpace(accessToken))

	endpoint := fmt.Sprintf("https://graph.facebook.com/v20.0/%s/media_publish", url.PathEscape(igUserID))
	var parsed struct {
		ID string `json:"id"`
	}
	if err := metaPOSTForm(ctx, endpoint, form, &parsed); err != nil {
		return "", err
	}
	id := strings.TrimSpace(parsed.ID)
	if id == "" {
		return "", errors.New("instagram publish failed")
	}
	return id, nil
}

func metaPOSTForm(ctx context.Context, endpoint string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		msg := strings.TrimSpace(string(b))
		if msg == "" {
			msg = "meta api request failed"
		}
		return errors.New(msg)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func extractObjectNameFromURL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u == nil {
		return ""
	}
	p := strings.Trim(u.Path, "/")
	if p == "" {
		return ""
	}
	parts := strings.Split(p, "/")
	if len(parts) < 2 {
		return ""
	}
	return strings.TrimSpace(parts[len(parts)-1])
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func (w *Worker) handleAnalyticsRefresh(ctx context.Context, t *asynq.Task) error {
	var payload map[string]string
	_ = json.Unmarshal(t.Payload(), &payload)

	if postIDStr := strings.TrimSpace(payload["post_id"]); postIDStr != "" {
		postID, err := uuid.Parse(postIDStr)
		if err != nil {
			return nil
		}
		return w.refreshPostAnalytics(ctx, postID)
	}

	if agencyIDStr := strings.TrimSpace(payload["agency_id"]); agencyIDStr != "" {
		agencyID, err := uuid.Parse(agencyIDStr)
		if err != nil {
			return nil
		}
		return w.fetchAnalyticsForAgency(ctx, agencyID)
	}

	return w.fetchAllAnalytics(ctx)
}

func (w *Worker) scanDueSchedulesLoop() {
	intervalSec := 60
	if v := strings.TrimSpace(os.Getenv("WORKER_SCHEDULE_SCAN_SEC")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			intervalSec = n
		}
	}

	ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if err := w.scanAndEnqueueDueSchedules(); err != nil {
			log.Printf("schedule scan error: %v", err)
		}
	}
}

func (w *Worker) scanAndEnqueueDueSchedules() error {
	if w == nil || w.db == nil {
		return nil
	}

	type row struct {
		PostID uuid.UUID `gorm:"column:post_id"`
	}
	rows := []row{}

	err := w.db.Raw(
		`update schedules
		   set status = 'queued'
		 where status = 'scheduled'
		   and execute_at <= now()
		 returning post_id`,
	).Scan(&rows).Error
	if err != nil {
		return err
	}

	for _, r := range rows {
		_ = EnqueueNow(w.cfg, "posts.publish", map[string]string{"post_id": r.PostID.String()})
	}
	return nil
}

func (w *Worker) scanAnalyticsLoop() {
	intervalSec := 900
	if v := strings.TrimSpace(os.Getenv("WORKER_ANALYTICS_SCAN_SEC")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			intervalSec = n
		}
	}

	ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		ctx := context.Background()
		ok := w.acquireLock(ctx, "lock:analytics:cron", time.Duration(intervalSec-5)*time.Second)
		if !ok {
			continue
		}
		if err := w.fetchAllAnalytics(ctx); err != nil {
			log.Printf("analytics fetch error: %v", err)
		}
	}
}

func (w *Worker) scanIntelLoop() {
	intervalSec := 3600
	if v := strings.TrimSpace(os.Getenv("WORKER_INTEL_SCAN_SEC")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			intervalSec = n
		}
	}

	ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		ctx := context.Background()
		ok := w.acquireLock(ctx, "lock:intel:cron", time.Duration(intervalSec-5)*time.Second)
		if !ok {
			continue
		}
		if err := w.scanAndEnqueueCompetitorRefresh(ctx); err != nil {
			log.Printf("intel scan error: %v", err)
		}
	}
}

func (w *Worker) scanAndEnqueueCompetitorRefresh(ctx context.Context) error {
	if w == nil || w.db == nil {
		return nil
	}
	if strings.TrimSpace(w.cfg.AI.OpenAIAPIKey) == "" {
		return nil
	}

	refreshDays := 7
	if v := strings.TrimSpace(os.Getenv("WORKER_COMPETITOR_REFRESH_DAYS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			refreshDays = n
		}
	}

	var clients []models.Client
	if err := w.db.Find(&clients).Error; err != nil {
		return err
	}

	now := time.Now().UTC()
	staleBefore := now.Add(-time.Duration(refreshDays) * 24 * time.Hour)

	for _, cl := range clients {
		clientName := strings.TrimSpace(cl.Name)
		industry := strings.TrimSpace(cl.Industry)
		if clientName == "" || industry == "" {
			continue
		}
		if cl.ID == uuid.Nil || cl.AgencyID == uuid.Nil {
			continue
		}

		var last models.CompetitorAnalysis
		err := w.db.Select("created_at").
			Where("agency_id = ? AND client_id = ?", cl.AgencyID, cl.ID).
			Order("created_at desc").
			First(&last).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				_ = EnqueueNow(w.cfg, "intel.competitor.refresh", map[string]string{
					"agency_id": cl.AgencyID.String(),
					"client_id": cl.ID.String(),
				})
			}
			continue
		}

		if last.CreatedAt.Before(staleBefore) {
			_ = EnqueueNow(w.cfg, "intel.competitor.refresh", map[string]string{
				"agency_id": cl.AgencyID.String(),
				"client_id": cl.ID.String(),
			})
		}
	}

	_ = ctx
	return nil
}

func (w *Worker) acquireLock(ctx context.Context, key string, ttl time.Duration) bool {
	rdb := redis.NewClient(&redis.Options{
		Addr:     w.cfg.Queue.RedisAddr,
		Password: w.cfg.Queue.RedisPassword,
		DB:       w.cfg.Queue.RedisDB,
	})
	defer func() { _ = rdb.Close() }()

	if ttl <= 0 {
		ttl = 55 * time.Second
	}
	ok, err := rdb.SetNX(ctx, key, uuid.NewString(), ttl).Result()
	if err != nil {
		return false
	}
	return ok
}

func (w *Worker) handleCompetitorRefresh(ctx context.Context, t *asynq.Task) error {
	var payload struct {
		AgencyID string `json:"agency_id"`
		ClientID string `json:"client_id"`
	}
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return err
	}
	agencyID, err := uuid.Parse(strings.TrimSpace(payload.AgencyID))
	if err != nil {
		return errors.New("invalid agency_id")
	}
	clientID, err := uuid.Parse(strings.TrimSpace(payload.ClientID))
	if err != nil {
		return errors.New("invalid client_id")
	}
	if strings.TrimSpace(w.cfg.AI.OpenAIAPIKey) == "" {
		return nil
	}

	var cl models.Client
	if err := w.db.Where("id = ? AND agency_id = ?", clientID, agencyID).First(&cl).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	clientName := strings.TrimSpace(cl.Name)
	industry := strings.TrimSpace(cl.Industry)
	location := strings.TrimSpace(cl.Location)
	if clientName == "" || industry == "" {
		return nil
	}

	var user models.AgencyUser
	if err := w.db.
		Where("agency_id = ? AND role IN ?", agencyID, []string{"owner", "admin"}).
		Order("created_at asc").
		First(&user).Error; err != nil {
		_ = w.db.Where("agency_id = ?", agencyID).Order("created_at asc").First(&user).Error
	}
	if user.ID == uuid.Nil {
		return nil
	}

	system := "You are a marketing strategist. Respond ONLY as a valid JSON object (no markdown)."
	userPrompt := "Analyze competitors for a business.\n" +
		"Return JSON with keys:\n" +
		"competitors: array of {name, why_relevant, channels, positioning, strengths, weaknesses}\n" +
		"benchmark: {pricing_level, content_quality, posting_frequency, engagement_quality, ads_presence}\n" +
		"gaps: array of {gap, impact, evidence}\n" +
		"opportunities: array of {opportunity, expected_impact, first_steps}\n" +
		"quick_wins_7_days: array of strings\n" +
		"\nInput:\n" +
		"client_name: " + clientName + "\n" +
		"industry: " + industry + "\n" +
		"location: " + location + "\n"

	raw, usage, model, err := openAIChatJSON(ctx, w.cfg, system, userPrompt)
	if err != nil {
		return err
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return errors.New("AI returned invalid JSON")
	}

	in := mustJSON(datatypes.JSONMap{
		"client_id":   clientID.String(),
		"client_name": clientName,
		"industry":    industry,
		"location":    location,
	})
	out := datatypes.JSON([]byte(raw))
	if !json.Valid(out) {
		return errors.New("AI returned invalid JSON")
	}

	now := time.Now().UTC()
	_ = w.db.Create(&models.AIGeneration{
		AgencyID:         agencyID,
		UserID:           user.ID,
		Kind:             "competitor",
		Model:            model,
		Input:            in,
		Output:           mustJSON(datatypes.JSONMap{"result": parsed}),
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		CostUSD:          calcCostUSD(usage.TotalTokens),
		CreatedAt:        now,
	}).Error

	if err := w.db.Create(&models.CompetitorAnalysis{
		AgencyID:   agencyID,
		UserID:     user.ID,
		ClientID:   &cl.ID,
		ClientName: clientName,
		Industry:   industry,
		Location:   location,
		Input:      datatypes.JSON(in),
		Output:     out,
		CreatedAt:  now,
	}).Error; err != nil {
		return err
	}
	return nil
}

type openAIUsage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

type openAIChatResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error,omitempty"`
}

func openAIChatJSON(ctx context.Context, cfg config.Config, system, user string) (string, openAIUsage, string, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.AI.OpenAIBaseURL), "/")
	if base == "" {
		base = "https://api.openai.com"
	}
	model := strings.TrimSpace(cfg.AI.OpenAIModel)
	if model == "" {
		model = "gpt-4o-mini"
	}

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
		"temperature": 0.7,
		"response_format": map[string]any{
			"type": "json_object",
		},
	}
	b, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return "", openAIUsage{}, "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.AI.OpenAIAPIKey))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 25 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", openAIUsage{}, "", errors.New("AI request failed")
	}
	defer res.Body.Close()

	raw, _ := io.ReadAll(res.Body)
	var parsed openAIChatResponse
	_ = json.Unmarshal(raw, &parsed)

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := ""
		if parsed.Error != nil {
			msg = strings.TrimSpace(parsed.Error.Message)
		}
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		if msg == "" {
			msg = "AI error"
		}
		return "", openAIUsage{}, model, errors.New(msg)
	}
	if len(parsed.Choices) == 0 {
		return "", openAIUsage{}, parsed.Model, errors.New("AI returned empty response")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	usage := openAIUsage{
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
		TotalTokens:      parsed.Usage.TotalTokens,
	}
	return content, usage, parsed.Model, nil
}

func calcCostUSD(totalTokens int) float64 {
	return float64(totalTokens) * 0.0006 / 1000.0
}

func mustJSON(v any) datatypes.JSON {
	b, _ := json.Marshal(v)
	return datatypes.JSON(b)
}

func (w *Worker) fetchAllAnalytics(ctx context.Context) error {
	accounts := []models.SocialAccount{}
	if err := w.db.Preload("Client").Where("connected_at is not null").Find(&accounts).Error; err != nil {
		return err
	}

	agencyTouched := map[uuid.UUID]struct{}{}
	clientTouched := map[string]struct{}{}

	for _, acc := range accounts {
		if acc.Client.ID == uuid.Nil {
			continue
		}
		agencyID := acc.Client.AgencyID
		if agencyID == uuid.Nil {
			continue
		}
		if strings.ToLower(strings.TrimSpace(acc.Platform)) == "instagram" && strings.TrimSpace(acc.ExternalAccountID) != "" {
			if err := w.upsertInstagramDaily(ctx, agencyID, acc); err != nil {
				log.Printf("analytics instagram error: %v", err)
				continue
			}
			agencyTouched[agencyID] = struct{}{}
			clientTouched[agencyID.String()+":"+acc.ClientID.String()] = struct{}{}
			continue
		}
		if err := w.upsertDaily(ctx, agencyID, acc.ClientID, acc.Platform, acc.FollowersCount); err != nil {
			log.Printf("analytics upsert error: %v", err)
		} else {
			agencyTouched[agencyID] = struct{}{}
			clientTouched[agencyID.String()+":"+acc.ClientID.String()] = struct{}{}
		}
	}

	w.invalidateAnalyticsCache(ctx, agencyTouched, clientTouched)
	return nil
}

func (w *Worker) fetchAnalyticsForAgency(ctx context.Context, agencyID uuid.UUID) error {
	var accounts []models.SocialAccount
	if err := w.db.Joins("join clients on clients.id = social_accounts.client_id").
		Where("clients.agency_id = ? AND social_accounts.connected_at is not null", agencyID).
		Find(&accounts).Error; err != nil {
		return err
	}

	agencyTouched := map[uuid.UUID]struct{}{agencyID: {}}
	clientTouched := map[string]struct{}{}
	for _, acc := range accounts {
		if strings.ToLower(strings.TrimSpace(acc.Platform)) == "instagram" && strings.TrimSpace(acc.ExternalAccountID) != "" {
			if err := w.upsertInstagramDaily(ctx, agencyID, acc); err == nil {
				clientTouched[agencyID.String()+":"+acc.ClientID.String()] = struct{}{}
			}
			continue
		}
		if err := w.upsertDaily(ctx, agencyID, acc.ClientID, acc.Platform, acc.FollowersCount); err == nil {
			clientTouched[agencyID.String()+":"+acc.ClientID.String()] = struct{}{}
		}
	}
	w.invalidateAnalyticsCache(ctx, agencyTouched, clientTouched)
	return nil
}

func (w *Worker) upsertDaily(ctx context.Context, agencyID, clientID uuid.UUID, platform string, followers int64) error {
	_ = ctx
	platform = strings.ToLower(strings.TrimSpace(platform))
	if platform == "" {
		return nil
	}

	today := utcDate(time.Now().UTC())
	start := today.AddDate(0, 0, -29)
	now := time.Now().UTC()

	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		dFollowers := syntheticFollowers(agencyID, clientID, platform, day, followers)
		likes, comments, impressions := mockEngagement(agencyID, clientID, platform, day, dFollowers)
		er := 0.0
		if impressions > 0 {
			er = float64(likes+comments) / float64(impressions)
		}

		row := models.AnalyticsDaily{
			AgencyID:       agencyID,
			ClientID:       clientID,
			Platform:       platform,
			Date:           day,
			Followers:      dFollowers,
			Likes:          likes,
			Comments:       comments,
			Impressions:    impressions,
			EngagementRate: er,
			UpdatedAt:      now,
		}

		if err := w.db.Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ?", agencyID, clientID, platform, day).
			Assign(row).
			FirstOrCreate(&row).Error; err != nil {
			return err
		}

		wow := w.growthPct(agencyID, clientID, platform, day.AddDate(0, 0, -7), dFollowers)
		mom := w.growthPct(agencyID, clientID, platform, day.AddDate(0, 0, -30), dFollowers)
		_ = w.db.Model(&models.AnalyticsDaily{}).
			Where("id = ?", row.ID).
			Updates(map[string]any{"wo_w_growth_pct": wow, "mo_m_growth_pct": mom}).Error

		if day.Equal(today) {
			w.checkAnomaly(agencyID, clientID, platform, day, dFollowers)
			w.checkAnomalyMetric(agencyID, clientID, platform, day, "impressions", impressions, 0.50)
		}
	}
	return nil
}

type igInsightsResponse struct {
	Data []struct {
		Name   string `json:"name"`
		Period string `json:"period"`
		Values []struct {
			Value   any    `json:"value"`
			EndTime string `json:"end_time"`
		} `json:"values"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

type igUserResponse struct {
	FollowersCount int64 `json:"followers_count"`
	Error          *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

func (w *Worker) upsertInstagramDaily(ctx context.Context, agencyID uuid.UUID, acc models.SocialAccount) error {
	if w == nil || w.db == nil {
		return nil
	}
	if strings.TrimSpace(acc.AccessToken) == "" {
		return errors.New("missing token")
	}
	key, err := cryptoutil.KeyFromConfig(w.cfg)
	if err != nil {
		return err
	}
	token, err := cryptoutil.DecryptString(key, acc.AccessToken)
	if err != nil {
		return err
	}
	igUserID := strings.TrimSpace(acc.ExternalAccountID)
	if igUserID == "" || strings.HasPrefix(igUserID, "mock_") {
		return errors.New("invalid instagram account")
	}

	today := utcDate(time.Now().UTC())
	start := today.AddDate(0, 0, -29)
	end := today

	followers, _ := w.metaGetIGFollowers(ctx, igUserID, token)
	if followers > 0 {
		_ = w.db.Model(&models.SocialAccount{}).Where("id = ?", acc.ID).Update("followers_count", followers).Error
	}

	impressionsByDay, reachByDay := w.metaGetIGInsightsDaily(ctx, igUserID, token, start, end)

	now := time.Now().UTC()
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		k := day.Format("2006-01-02")
		impr := impressionsByDay[k]
		reach := reachByDay[k]
		f := int64(0)
		if day.Equal(end) && followers > 0 {
			f = followers
		}
		likes := int64(0)
		comments := int64(0)
		er := 0.0
		if impr > 0 {
			er = float64(likes+comments) / float64(impr)
		}

		row := models.AnalyticsDaily{
			AgencyID:       agencyID,
			ClientID:       acc.ClientID,
			Platform:       "instagram",
			Date:           day,
			Followers:      f,
			Likes:          likes,
			Comments:       comments,
			Impressions:    maxI64(impr, reach),
			EngagementRate: er,
			UpdatedAt:      now,
		}

		if err := w.db.Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ?", agencyID, acc.ClientID, "instagram", day).
			Assign(row).
			FirstOrCreate(&row).Error; err != nil {
			return err
		}

		if day.Equal(end) {
			w.checkAnomalyMetric(agencyID, acc.ClientID, "instagram", day, "impressions", row.Impressions, 0.50)
			if row.Followers > 0 {
				w.checkAnomaly(agencyID, acc.ClientID, "instagram", day, row.Followers)
			}
		}
	}
	return nil
}

func (w *Worker) metaGetIGFollowers(ctx context.Context, igUserID string, token string) (int64, error) {
	u := fmt.Sprintf("https://graph.facebook.com/v20.0/%s?fields=followers_count&access_token=%s", url.PathEscape(igUserID), url.QueryEscape(token))
	var out igUserResponse
	if err := w.metaGET(ctx, u, &out); err != nil {
		return 0, err
	}
	if out.Error != nil && strings.TrimSpace(out.Error.Message) != "" {
		return 0, errors.New(out.Error.Message)
	}
	return out.FollowersCount, nil
}

func (w *Worker) metaGetIGInsightsDaily(ctx context.Context, igUserID string, token string, start time.Time, end time.Time) (map[string]int64, map[string]int64) {
	impressions := map[string]int64{}
	reach := map[string]int64{}

	since := start.UTC().Unix()
	until := end.AddDate(0, 0, 1).UTC().Unix()
	u := fmt.Sprintf(
		"https://graph.facebook.com/v20.0/%s/insights?metric=impressions,reach&period=day&since=%d&until=%d&access_token=%s",
		url.PathEscape(igUserID),
		since,
		until,
		url.QueryEscape(token),
	)
	var out igInsightsResponse
	if err := w.metaGET(ctx, u, &out); err != nil {
		return impressions, reach
	}
	if out.Error != nil {
		return impressions, reach
	}
	for _, m := range out.Data {
		name := strings.ToLower(strings.TrimSpace(m.Name))
		for _, v := range m.Values {
			d := parseEndTimeDate(v.EndTime)
			if d == "" {
				continue
			}
			n := toInt64(v.Value)
			switch name {
			case "impressions":
				impressions[d] = n
			case "reach":
				reach[d] = n
			}
		}
	}
	return impressions, reach
}

func (w *Worker) metaGET(ctx context.Context, urlStr string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(b, out)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return errors.New("meta request failed")
	}
	return nil
}

func parseEndTimeDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return utcDate(t.UTC()).Format("2006-01-02")
	}
	return ""
}

func toInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int64:
		return t
	case int:
		return int64(t)
	case string:
		t = strings.TrimSpace(t)
		if t == "" {
			return 0
		}
		if n, err := strconv.ParseInt(t, 10, 64); err == nil {
			return n
		}
	}
	return 0
}

func syntheticFollowers(agencyID, clientID uuid.UUID, platform string, day time.Time, currentFollowers int64) int64 {
	if currentFollowers <= 0 {
		return 0
	}
	today := utcDate(time.Now().UTC())
	daysBack := int(today.Sub(utcDate(day)).Hours() / 24)
	if daysBack <= 0 {
		return currentFollowers
	}
	if daysBack > 365 {
		daysBack = 365
	}
	seed := sha256.Sum256([]byte(agencyID.String() + "|" + clientID.String() + "|" + platform + "|followers|" + today.Format("2006-01-02")))
	baseDelta := int64(seed[0])%4 + 1
	delta := baseDelta * int64(daysBack)
	if delta >= currentFollowers {
		return maxI64(0, currentFollowers/3)
	}
	return currentFollowers - delta
}

func (w *Worker) growthPct(agencyID, clientID uuid.UUID, platform string, prevDate time.Time, currentFollowers int64) float64 {
	var prev models.AnalyticsDaily
	if err := w.db.Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ?", agencyID, clientID, platform, prevDate).
		First(&prev).Error; err != nil {
		return 0
	}
	if prev.Followers <= 0 {
		return 0
	}
	return float64(currentFollowers-prev.Followers) / float64(prev.Followers)
}

func (w *Worker) checkAnomaly(agencyID, clientID uuid.UUID, platform string, day time.Time, followers int64) {
	var prev models.AnalyticsDaily
	if err := w.db.Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ?", agencyID, clientID, platform, day.AddDate(0, 0, -1)).
		First(&prev).Error; err != nil {
		return
	}
	if prev.Followers <= 0 {
		return
	}
	change := float64(followers-prev.Followers) / float64(prev.Followers)
	if math.Abs(change) < 0.30 {
		return
	}

	var exists int64
	_ = w.db.Model(&models.AnalyticsAlert{}).
		Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ? AND metric = ?", agencyID, clientID, platform, day, "followers").
		Count(&exists).Error
	if exists > 0 {
		return
	}

	_ = w.db.Create(&models.AnalyticsAlert{
		AgencyID:  agencyID,
		ClientID:  clientID,
		Platform:  platform,
		Date:      day,
		Metric:    "followers",
		PrevValue: prev.Followers,
		Value:     followers,
		ChangePct: change,
		CreatedAt: time.Now().UTC(),
	}).Error
}

func (w *Worker) checkAnomalyMetric(agencyID, clientID uuid.UUID, platform string, day time.Time, metric string, value int64, threshold float64) {
	metric = strings.ToLower(strings.TrimSpace(metric))
	if metric == "" {
		return
	}
	if threshold <= 0 {
		threshold = 0.30
	}

	var prev models.AnalyticsDaily
	if err := w.db.Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ?", agencyID, clientID, platform, day.AddDate(0, 0, -1)).
		First(&prev).Error; err != nil {
		return
	}

	prevValue := int64(0)
	switch metric {
	case "followers":
		prevValue = prev.Followers
	case "impressions":
		prevValue = prev.Impressions
	default:
		return
	}
	if prevValue <= 0 {
		return
	}

	change := float64(value-prevValue) / float64(prevValue)
	if math.Abs(change) < threshold {
		return
	}

	var exists int64
	_ = w.db.Model(&models.AnalyticsAlert{}).
		Where("agency_id = ? AND client_id = ? AND platform = ? AND date = ? AND metric = ?", agencyID, clientID, platform, day, metric).
		Count(&exists).Error
	if exists > 0 {
		return
	}

	_ = w.db.Create(&models.AnalyticsAlert{
		AgencyID:  agencyID,
		ClientID:  clientID,
		Platform:  platform,
		Date:      day,
		Metric:    metric,
		PrevValue: prevValue,
		Value:     value,
		ChangePct: change,
		CreatedAt: time.Now().UTC(),
	}).Error
}

func (w *Worker) refreshPostAnalytics(ctx context.Context, postID uuid.UUID) error {
	_ = ctx
	var post models.Post
	if err := w.db.Where("id = ?", postID).First(&post).Error; err != nil {
		return nil
	}

	platforms := []string{}
	_ = json.Unmarshal(post.Platforms, &platforms)
	if len(platforms) == 0 {
		return nil
	}

	now := time.Now().UTC()
	for _, p := range platforms {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		likes, comments, impressions := mockPostEngagement(post.AgencyID, post.ClientID, post.ID, p, now)
		_ = w.db.Create(&models.AnalyticsPost{
			AgencyID:    post.AgencyID,
			ClientID:    post.ClientID,
			PostID:      post.ID,
			Platform:    p,
			Likes:       likes,
			Comments:    comments,
			Impressions: impressions,
			FetchedAt:   now,
			CreatedAt:   now,
		}).Error
	}

	agencyTouched := map[uuid.UUID]struct{}{post.AgencyID: {}}
	clientTouched := map[string]struct{}{post.AgencyID.String() + ":" + post.ClientID.String(): {}}
	w.invalidateAnalyticsCache(context.Background(), agencyTouched, clientTouched)
	return nil
}

func (w *Worker) invalidateAnalyticsCache(ctx context.Context, agencies map[uuid.UUID]struct{}, clients map[string]struct{}) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     w.cfg.Queue.RedisAddr,
		Password: w.cfg.Queue.RedisPassword,
		DB:       w.cfg.Queue.RedisDB,
	})
	defer func() { _ = rdb.Close() }()

	for agencyID := range agencies {
		_ = rdb.Del(ctx, fmt.Sprintf("cache:analytics:dashboard:%s", agencyID.String())).Err()
	}
	for k := range clients {
		parts := strings.SplitN(k, ":", 2)
		if len(parts) != 2 {
			continue
		}
		_ = rdb.Del(ctx, fmt.Sprintf("cache:analytics:client:%s:%s", parts[0], parts[1])).Err()
	}
}

func mockEngagement(agencyID, clientID uuid.UUID, platform string, day time.Time, followers int64) (int64, int64, int64) {
	seed := sha256.Sum256([]byte(agencyID.String() + "|" + clientID.String() + "|" + platform + "|" + day.Format("2006-01-02")))
	base := int64(seed[0])<<8 + int64(seed[1])
	impr := maxI64(200, int64(float64(followers)*0.35)+base%500)
	likes := maxI64(5, impr/20+int64(seed[2])%20)
	comments := maxI64(1, likes/10+int64(seed[3])%5)
	return likes, comments, impr
}

func mockPostEngagement(agencyID, clientID, postID uuid.UUID, platform string, t time.Time) (int64, int64, int64) {
	seed := sha256.Sum256([]byte(agencyID.String() + "|" + clientID.String() + "|" + postID.String() + "|" + platform + "|" + t.Format(time.RFC3339)))
	impr := int64(seed[0])<<8 + int64(seed[1])
	impr = maxI64(100, impr%5000)
	likes := maxI64(1, impr/25+int64(seed[2])%30)
	comments := maxI64(0, likes/8+int64(seed[3])%5)
	return likes, comments, impr
}

func utcDate(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func maxI64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
