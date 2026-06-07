package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"trendspire/internal/config"
	"trendspire/internal/models"
	"trendspire/internal/queue"
	"trendspire/internal/storage"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PostsHandler struct {
	cfg config.Config
	db  *gorm.DB
}

func NewPostsHandler(cfg config.Config, db *gorm.DB) PostsHandler {
	return PostsHandler{cfg: cfg, db: db}
}

type createPostRequest struct {
	ClientID  string   `json:"client_id" binding:"required"`
	Content   string   `json:"content" binding:"required"`
	Platforms []string `json:"platforms" binding:"required,min=1"`
	MediaURLs []string `json:"media_urls"`
}

type scheduleRequest struct {
	ExecuteAt string `json:"execute_at" binding:"required"`
}

type postOut struct {
	ID        string    `json:"id"`
	ClientID  string    `json:"client_id"`
	Content   string    `json:"content"`
	Platforms []string  `json:"platforms"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type postListItem struct {
	ID        string     `json:"id"`
	ClientID  string     `json:"client_id"`
	ClientName string    `json:"client_name"`
	Content   string     `json:"content"`
	Platforms []string   `json:"platforms"`
	Status    string     `json:"status"`
	ExecuteAt *time.Time `json:"execute_at"`
	MediaURLs []string   `json:"media_urls"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type calendarEventOut struct {
	ID         string    `json:"id"`
	PostID     string    `json:"post_id"`
	ClientID   string    `json:"client_id"`
	ClientName string    `json:"client_name"`
	Title      string    `json:"title"`
	Start      time.Time `json:"start"`
	End        time.Time `json:"end"`
	Platforms  []string  `json:"platforms"`
	Status     string    `json:"status"`
}

func (h PostsHandler) ListPosts(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			if v > 200 {
				v = 200
			}
			limit = v
		}
	}

	var clientID uuid.UUID
	if raw := strings.TrimSpace(c.Query("client_id")); raw != "" {
		clientID, err = uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
	}

	statuses := splitComma(c.Query("status"))
	for i := range statuses {
		statuses[i] = strings.ToLower(strings.TrimSpace(statuses[i]))
	}

	q := h.db.
		Preload("Client").
		Preload("Media").
		Preload("Schedules", func(db *gorm.DB) *gorm.DB { return db.Order("execute_at asc") }).
		Where("agency_id = ?", authCtx.AgencyID).
		Order("created_at desc").
		Limit(limit)

	if clientID != uuid.Nil {
		q = q.Where("client_id = ?", clientID)
	}
	if len(statuses) > 0 {
		q = q.Where("status IN ?", statuses)
	}

	var posts []models.Post
	if err := q.Find(&posts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list posts failed"})
		return
	}

	out := make([]postListItem, 0, len(posts))
	now := time.Now().UTC()
	for _, p := range posts {
		var platforms []string
		_ = json.Unmarshal(p.Platforms, &platforms)

		var executeAt *time.Time
		for _, s := range p.Schedules {
			if s.Status != "scheduled" && s.Status != "queued" {
				continue
			}
			t := s.ExecuteAt.UTC()
			if t.Before(now) {
				continue
			}
			executeAt = &t
			break
		}

		media := make([]string, 0, len(p.Media))
		for _, m := range p.Media {
			media = append(media, m.URL)
		}

		out = append(out, postListItem{
			ID:         p.ID.String(),
			ClientID:   p.ClientID.String(),
			ClientName: p.Client.Name,
			Content:    p.Content,
			Platforms:  platforms,
			Status:     p.Status,
			ExecuteAt:  executeAt,
			MediaURLs:  media,
			CreatedAt:  p.CreatedAt,
			UpdatedAt:  p.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h PostsHandler) CalendarPosts(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	startRaw := strings.TrimSpace(c.Query("start"))
	endRaw := strings.TrimSpace(c.Query("end"))
	if startRaw == "" || endRaw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	start, err := time.Parse(time.RFC3339, startRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	end, err := time.Parse(time.RFC3339, endRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	start = start.UTC()
	end = end.UTC()
	if end.Before(start) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var clientID uuid.UUID
	if raw := strings.TrimSpace(c.Query("client_id")); raw != "" {
		clientID, err = uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
	}

	postIDsSub := h.db.Model(&models.Post{}).Select("id").Where("agency_id = ?", authCtx.AgencyID)
	if clientID != uuid.Nil {
		postIDsSub = postIDsSub.Where("client_id = ?", clientID)
	}

	var schedules []models.Schedule
	if err := h.db.
		Preload("Post").
		Preload("Post.Client").
		Where("post_id IN (?)", postIDsSub).
		Where("execute_at >= ? AND execute_at <= ?", start, end).
		Where("status IN ?", []string{"scheduled", "queued"}).
		Order("execute_at asc").
		Find(&schedules).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list calendar failed"})
		return
	}

	out := make([]calendarEventOut, 0, len(schedules))
	for _, s := range schedules {
		var platforms []string
		_ = json.Unmarshal(s.Post.Platforms, &platforms)

		title := s.Post.Client.Name
		if strings.TrimSpace(s.Post.Content) != "" {
			title = fmtTitle(title, s.Post.Content)
		}

		startAt := s.ExecuteAt.UTC()
		endAt := startAt.Add(30 * time.Minute)
		out = append(out, calendarEventOut{
			ID:         s.ID.String(),
			PostID:     s.PostID.String(),
			ClientID:   s.Post.ClientID.String(),
			ClientName: s.Post.Client.Name,
			Title:      title,
			Start:      startAt,
			End:        endAt,
			Platforms:  platforms,
			Status:     s.Status,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h PostsHandler) CreatePost(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var clientID uuid.UUID
	var content string
	var platforms []string
	var mediaURLs []string

	ct := strings.ToLower(strings.TrimSpace(c.ContentType()))
	if strings.HasPrefix(ct, "multipart/form-data") {
		clientID, content, platforms, mediaURLs, err = h.parseMultipartCreate(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
	} else {
		var req createPostRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		clientID, err = uuid.Parse(strings.TrimSpace(req.ClientID))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		content = strings.TrimSpace(req.Content)
		platforms = req.Platforms
		mediaURLs = req.MediaURLs
	}

	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	normalizedPlatforms, err := validateAndNormalizePlatforms(platforms)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateContentForPlatforms(content, normalizedPlatforms); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if contains(normalizedPlatforms, "instagram") && len(mediaURLs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instagram requires media"})
		return
	}

	var cl models.Client
	if err := h.db.Where("id = ? AND agency_id = ?", clientID, authCtx.AgencyID).First(&cl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	post := models.Post{
		AgencyID:  authCtx.AgencyID,
		ClientID:  cl.ID,
		Content:   content,
		Platforms: models.MustMarshalPlatforms(normalizedPlatforms),
		Status:    "draft",
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&post).Error; err != nil {
			return err
		}
		for _, u := range mediaURLs {
			u = strings.TrimSpace(u)
			if u == "" {
				continue
			}
			m := models.PostMedia{
				PostID: post.ID,
				URL:    u,
			}
			if err := tx.Create(&m).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create post failed"})
		return
	}

	c.JSON(http.StatusCreated, postOut{
		ID:        post.ID.String(),
		ClientID:  post.ClientID.String(),
		Content:   post.Content,
		Platforms: normalizedPlatforms,
		Status:    post.Status,
		CreatedAt: post.CreatedAt,
		UpdatedAt: post.UpdatedAt,
	})
}

func (h PostsHandler) SchedulePost(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	postID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var req scheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	executeAt, err := parseExecuteAt(req.ExecuteAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	executeAt = executeAt.UTC()
	if executeAt.Before(time.Now().UTC().Add(30 * time.Second)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var post models.Post
	if err := h.db.Where("id = ? AND agency_id = ?", postID, authCtx.AgencyID).First(&post).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}

	now := time.Now().UTC()
	s := models.Schedule{
		PostID:    post.ID,
		ExecuteAt: executeAt,
		Status:    "scheduled",
		CreatedAt: now,
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Post{}).Where("id = ?", post.ID).Update("status", "scheduled").Error; err != nil {
			return err
		}
		return tx.Create(&s).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "schedule failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"post_id":     post.ID.String(),
		"status":      "scheduled",
		"execute_at":  s.ExecuteAt,
		"schedule_id": s.ID.String(),
	})
}

func (h PostsHandler) PublishNow(c *gin.Context) {
	authCtx, err := GetAuthContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	postID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var post models.Post
	if err := h.db.Where("id = ? AND agency_id = ?", postID, authCtx.AgencyID).First(&post).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}

	if err := queue.EnqueueNow(h.cfg, "posts.publish", map[string]string{"post_id": post.ID.String()}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "queue enqueue failed"})
		return
	}

	if err := h.db.Model(&models.Post{}).Where("id = ?", post.ID).Update("status", "queued").Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "publish failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"post_id": post.ID.String(), "status": "queued"})
}

func (h PostsHandler) parseMultipartCreate(c *gin.Context) (uuid.UUID, string, []string, []string, error) {
	clientID, err := uuid.Parse(strings.TrimSpace(c.PostForm("client_id")))
	if err != nil {
		return uuid.Nil, "", nil, nil, err
	}
	content := strings.TrimSpace(c.PostForm("content"))
	rawPlatforms := strings.TrimSpace(c.PostForm("platforms"))
	platforms := splitComma(rawPlatforms)

	var mediaURLs []string
	form, err := c.MultipartForm()
	if err != nil {
		return uuid.Nil, "", nil, nil, err
	}
	files := form.File["media"]
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			return uuid.Nil, "", nil, nil, err
		}
		up, upErr := storage.UploadToMinIO(c.Request.Context(), h.cfg, f, fh.Size, fh.Header.Get("Content-Type"))
		_ = f.Close()
		if upErr != nil {
			return uuid.Nil, "", nil, nil, upErr
		}
		mediaURLs = append(mediaURLs, up.URL)
	}

	return clientID, content, platforms, mediaURLs, nil
}

func splitComma(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func validateAndNormalizePlatforms(in []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, p := range in {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if p != "instagram" && p != "facebook" && p != "tiktok" && p != "x" {
			return nil, errors.New("invalid platform")
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil, errors.New("platforms required")
	}
	return out, nil
}

func validateContentForPlatforms(content string, platforms []string) error {
	n := len([]rune(content))
	for _, p := range platforms {
		switch p {
		case "x":
			if n > 280 {
				return errors.New("content too long for X")
			}
		case "instagram":
			if n > 2200 {
				return errors.New("content too long for Instagram")
			}
		}
	}
	return nil
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func parseExecuteAt(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, errors.New("missing execute_at")
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t, nil
	}
	if t, err := time.ParseInLocation("2006-01-02 15:04", raw, time.Local); err == nil {
		return t, nil
	}
	return time.Time{}, errors.New("invalid execute_at")
}

func fmtTitle(prefix string, content string) string {
	prefix = strings.TrimSpace(prefix)
	content = strings.TrimSpace(content)
	if prefix == "" {
		return truncateRunes(content, 80)
	}
	if content == "" {
		return prefix
	}
	return prefix + " — " + truncateRunes(content, 80)
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
