package httpapi

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type TrendsHandler struct {
	mu    sync.Mutex
	cache map[string]cachedTrends
}

type cachedTrends struct {
	FetchedAt time.Time
	Data      googleTrendsResponse
}

func NewTrendsHandler() TrendsHandler {
	return TrendsHandler{cache: map[string]cachedTrends{}}
}

type googleTrendsNewsItem struct {
	Title   string `xml:"ht:news_item_title"`
	URL     string `xml:"ht:news_item_url"`
	Source  string `xml:"ht:news_item_source"`
	Snippet string `xml:"ht:news_item_snippet"`
}

type googleTrendsRSSItem struct {
	Title         string                 `xml:"title"`
	ApproxTraffic string                 `xml:"ht:approx_traffic"`
	PubDate       string                 `xml:"pubDate"`
	Description   string                 `xml:"description"`
	NewsItems     []googleTrendsNewsItem `xml:"ht:news_item"`
	Picture       string                 `xml:"ht:picture"`
	PictureSource string                 `xml:"ht:picture_source"`
}

type googleTrendsRSSChannel struct {
	Title string                `xml:"title"`
	Items []googleTrendsRSSItem `xml:"item"`
}

type googleTrendsRSS struct {
	Channel googleTrendsRSSChannel `xml:"channel"`
}

type googleTrendsItem struct {
	Title         string                 `json:"title"`
	ApproxTraffic string                 `json:"approx_traffic,omitempty"`
	PubDate       string                 `json:"pub_date,omitempty"`
	Description   string                 `json:"description,omitempty"`
	Picture       string                 `json:"picture,omitempty"`
	PictureSource string                 `json:"picture_source,omitempty"`
	News          []googleTrendsNewsItem `json:"news,omitempty"`
}

type googleTrendsResponse struct {
	Source    string             `json:"source"`
	Geo       string             `json:"geo"`
	Title     string             `json:"title"`
	FetchedAt time.Time          `json:"fetched_at"`
	DebugURL  string             `json:"debug_url"`
	Items     []googleTrendsItem `json:"items"`
}

func (h *TrendsHandler) GoogleTrending(c *gin.Context) {
	geo := strings.ToUpper(strings.TrimSpace(c.Query("geo")))
	if geo == "" {
		geo = "ID"
	}
	if len(geo) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid geo"})
		return
	}
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			if n > 50 {
				n = 50
			}
			limit = n
		}
	}

	cacheKey := "google:" + geo + ":" + strconv.Itoa(limit)
	if hit := h.getCache(cacheKey, 10*time.Minute); hit != nil {
		c.JSON(http.StatusOK, gin.H{"data": hit})
		return
	}

	debugURL := "https://trends.google.com/trending/rss?geo=" + geo
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, debugURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request build failed"})
		return
	}
	req.Header.Set("User-Agent", "TrendSpire/1.0")
	res, err := (&http.Client{Timeout: 18 * time.Second}).Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "fetch failed"})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream error"})
		return
	}
	b, _ := io.ReadAll(res.Body)
	if len(b) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "empty response"})
		return
	}

	var rss googleTrendsRSS
	if err := xml.Unmarshal(b, &rss); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "parse failed"})
		return
	}

	out := googleTrendsResponse{
		Source:    "google_trends",
		Geo:       geo,
		Title:     strings.TrimSpace(rss.Channel.Title),
		FetchedAt: time.Now().UTC(),
		DebugURL:  debugURL,
		Items:     []googleTrendsItem{},
	}
	for _, it := range rss.Channel.Items {
		out.Items = append(out.Items, googleTrendsItem{
			Title:         strings.TrimSpace(it.Title),
			ApproxTraffic: strings.TrimSpace(it.ApproxTraffic),
			PubDate:       strings.TrimSpace(it.PubDate),
			Description:   strings.TrimSpace(it.Description),
			Picture:       strings.TrimSpace(it.Picture),
			PictureSource: strings.TrimSpace(it.PictureSource),
			News:          it.NewsItems,
		})
		if len(out.Items) >= limit {
			break
		}
	}
	if len(out.Items) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "no items"})
		return
	}

	h.setCache(cacheKey, out)
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *TrendsHandler) getCache(key string, ttl time.Duration) *googleTrendsResponse {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cache == nil {
		h.cache = map[string]cachedTrends{}
	}
	v, ok := h.cache[key]
	if !ok {
		return nil
	}
	if v.FetchedAt.IsZero() {
		return nil
	}
	if time.Since(v.FetchedAt) > ttl {
		delete(h.cache, key)
		return nil
	}
	out := v.Data
	return &out
}

func (h *TrendsHandler) setCache(key string, data googleTrendsResponse) {
	if strings.TrimSpace(key) == "" {
		return
	}
	if strings.TrimSpace(data.Source) == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cache == nil {
		h.cache = map[string]cachedTrends{}
	}
	h.cache[key] = cachedTrends{FetchedAt: time.Now().UTC(), Data: data}
}

type explodingTopicsResponse struct {
	Source    string    `json:"source"`
	FetchedAt time.Time `json:"fetched_at"`
	DebugURL  string    `json:"debug_url"`
	Items     []any     `json:"items"`
}

func (h *TrendsHandler) ExplodingTopics(c *gin.Context) {
	apiKey := strings.TrimSpace(os.Getenv("EXPLODING_TOPICS_API_KEY"))
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "EXPLODING_TOPICS_API_KEY not configured"})
		return
	}

	limit := 10
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			if n > 50 {
				n = 50
			}
			limit = n
		}
	}

	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	if raw := strings.TrimSpace(c.Query("type")); raw != "" {
		q.Set("type", raw)
	}
	if raw := strings.TrimSpace(c.Query("sort")); raw != "" {
		q.Set("sort", raw)
	}
	if raw := strings.TrimSpace(c.Query("order")); raw != "" {
		q.Set("order", raw)
	}
	if raw := strings.TrimSpace(c.Query("timeframe")); raw != "" {
		q.Set("timeframe", raw)
	}
	if raw := strings.TrimSpace(c.Query("response_timeframe")); raw != "" {
		q.Set("response_timeframe", raw)
	}
	if raw := strings.TrimSpace(c.Query("brand")); raw != "" {
		q.Set("brand", raw)
	}
	if raw := strings.TrimSpace(c.Query("categories")); raw != "" {
		parts := strings.Split(raw, ",")
		for _, p := range parts {
			v := strings.TrimSpace(p)
			if v == "" {
				continue
			}
			q.Add("categories", v)
		}
	}

	debugURL := "https://api.explodingtopics.com/api/v1/topics?" + q.Encode()
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, debugURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request build failed"})
		return
	}
	req.Header.Set("User-Agent", "TrendSpire/1.0")
	req.Header.Set("x-api-key", apiKey)

	res, err := (&http.Client{Timeout: 22 * time.Second}).Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "fetch failed"})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream error"})
		return
	}
	b, _ := io.ReadAll(res.Body)
	if len(b) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "empty response"})
		return
	}

	var items []any
	if err := json.Unmarshal(b, &items); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "parse failed"})
		return
	}

	out := explodingTopicsResponse{
		Source:    "exploding_topics",
		FetchedAt: time.Now().UTC(),
		DebugURL:  debugURL,
		Items:     items,
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type similarwebTrafficRow struct {
	Date                 string   `json:"date"`
	Visits               *float64 `json:"visits"`
	BounceRate           *float64 `json:"bounce_rate"`
	AverageVisitDuration *float64 `json:"average_visit_duration"`
	PagesPerVisit        *float64 `json:"pages_per_visit"`
	PageViews            *float64 `json:"page_views"`
	UniqueVisitors       *float64 `json:"unique_visitors"`
}

type similarwebTrafficResponse struct {
	Meta any                    `json:"meta"`
	Data []similarwebTrafficRow `json:"data"`
}

type similarwebResponse struct {
	Source    string                    `json:"source"`
	Domain    string                    `json:"domain"`
	Country   string                    `json:"country"`
	FetchedAt time.Time                 `json:"fetched_at"`
	DebugURL  string                    `json:"debug_url"`
	Latest    *similarwebTrafficRow     `json:"latest,omitempty"`
	Raw       similarwebTrafficResponse `json:"raw"`
}

func (h *TrendsHandler) SimilarwebTraffic(c *gin.Context) {
	apiKey := strings.TrimSpace(os.Getenv("SIMILARWEB_API_KEY"))
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SIMILARWEB_API_KEY not configured"})
		return
	}

	domain := strings.TrimSpace(c.Query("domain"))
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain is required"})
		return
	}
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimPrefix(domain, "www.")
	domain = strings.TrimSuffix(domain, "/")
	if strings.Contains(domain, "/") || strings.Contains(domain, " ") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain"})
		return
	}

	country := strings.ToLower(strings.TrimSpace(c.Query("country")))
	if country == "" {
		country = "ww"
	}
	if len(country) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid country"})
		return
	}

	now := time.Now().UTC()
	ym := now.Format("2006-01")

	q := url.Values{}
	q.Set("domain", domain)
	q.Set("granularity", "monthly")
	q.Set("web_source", "total")
	q.Set("country", country)
	q.Set("start_date", ym)
	q.Set("end_date", ym)
	q.Set("format", "json")
	q.Set("metrics", "visits,bounce_rate,average_visit_duration,pages_per_visit,page_views,unique_visitors")

	debugURL := "https://api.similarweb.com/v5/website-analysis/websites/traffic-and-engagement?" + q.Encode()
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, debugURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request build failed"})
		return
	}
	req.Header.Set("User-Agent", "TrendSpire/1.0")
	req.Header.Set("api-key", apiKey)

	res, err := (&http.Client{Timeout: 22 * time.Second}).Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "fetch failed"})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream error"})
		return
	}
	b, _ := io.ReadAll(res.Body)
	if len(b) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "empty response"})
		return
	}

	var raw similarwebTrafficResponse
	if err := json.Unmarshal(b, &raw); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "parse failed"})
		return
	}

	var latest *similarwebTrafficRow
	if len(raw.Data) > 0 {
		x := raw.Data[len(raw.Data)-1]
		latest = &x
	}

	out := similarwebResponse{
		Source:    "similarweb",
		Domain:    domain,
		Country:   country,
		FetchedAt: time.Now().UTC(),
		DebugURL:  debugURL,
		Latest:    latest,
		Raw:       raw,
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
