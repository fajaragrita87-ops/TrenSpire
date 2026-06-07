package oauth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"trendspire/internal/config"
)

type TokenResult struct {
	AccessToken       string
	RefreshToken      string
	ExpiresAtUTC      *time.Time
	ExternalAccountID string
	Username          string
	FollowerCount     int64
}

func BuildRedirectURI(cfg config.Config, platform string) string {
	base := strings.TrimRight(cfg.OAuth.PublicBaseURL, "/")
	return fmt.Sprintf("%s/api/v1/accounts/%s/callback", base, url.PathEscape(platform))
}

func IsConfigured(cfg config.Config, platform string) bool {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "instagram", "facebook":
		return cfg.OAuth.MetaAppID != "" && cfg.OAuth.MetaAppSecret != ""
	case "tiktok":
		return cfg.OAuth.TikTokClientKey != "" && cfg.OAuth.TikTokClientSecret != ""
	case "x":
		return cfg.OAuth.XClientID != "" && cfg.OAuth.XClientSecret != ""
	default:
		return false
	}
}

func randomString(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func BuildAuthURL(cfg config.Config, platform, state, redirectURI, codeChallenge string) (string, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	if !IsConfigured(cfg, platform) {
		u, _ := url.Parse(redirectURI)
		q := u.Query()
		q.Set("code", "mock_code")
		q.Set("state", state)
		u.RawQuery = q.Encode()
		return u.String(), nil
	}

	switch platform {
	case "instagram", "facebook":
		u, _ := url.Parse("https://www.facebook.com/v20.0/dialog/oauth")
		q := u.Query()
		q.Set("client_id", cfg.OAuth.MetaAppID)
		q.Set("redirect_uri", redirectURI)
		q.Set("state", state)
		q.Set("response_type", "code")
		if platform == "instagram" {
			q.Set("scope", "public_profile,email,pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights,instagram_content_publish")
		} else {
			q.Set("scope", "public_profile,email,pages_show_list,pages_read_engagement")
		}
		u.RawQuery = q.Encode()
		return u.String(), nil
	case "tiktok":
		return "", errors.New("tiktok auth url not implemented")
	case "x":
		_ = codeChallenge
		return "", errors.New("x auth url not implemented")
	default:
		return "", errors.New("unsupported platform")
	}
}

func ExchangeCode(ctx context.Context, cfg config.Config, platform, code, redirectURI, codeVerifier string) (TokenResult, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	if !IsConfigured(cfg, platform) {
		now := time.Now().UTC()
		exp := now.Add(60 * time.Minute)
		suffix, _ := randomString(8)
		return TokenResult{
			AccessToken:       "mock_access_" + suffix,
			RefreshToken:      "mock_refresh_" + suffix,
			ExpiresAtUTC:      &exp,
			ExternalAccountID: "mock_account_" + suffix,
			Username:          "mock_user",
			FollowerCount:     0,
		}, nil
	}

	switch platform {
	case "instagram", "facebook":
		shortToken, shortExp, err := metaExchangeCode(ctx, cfg, redirectURI, code)
		if err != nil {
			return TokenResult{}, err
		}

		longToken, longExp, err := metaExchangeLongLived(ctx, cfg, shortToken)
		if err != nil {
			res := TokenResult{
				AccessToken:  shortToken,
				RefreshToken: shortToken,
				ExpiresAtUTC: shortExp,
			}
			if platform == "instagram" {
				ig, igErr := metaResolveInstagramAccount(ctx, shortToken)
				if igErr == nil {
					res.AccessToken = ig.PageAccessToken
					res.RefreshToken = ig.PageAccessToken
					res.ExternalAccountID = ig.IGUserID
					res.Username = ig.Username
					res.FollowerCount = ig.FollowerCount
				}
			}
			return res, nil
		}

		res := TokenResult{
			AccessToken:  longToken,
			RefreshToken: longToken,
			ExpiresAtUTC: longExp,
		}
		if platform == "instagram" {
			ig, err := metaResolveInstagramAccount(ctx, longToken)
			if err != nil {
				return TokenResult{}, err
			}
			res.AccessToken = ig.PageAccessToken
			res.RefreshToken = ig.PageAccessToken
			res.ExternalAccountID = ig.IGUserID
			res.Username = ig.Username
			res.FollowerCount = ig.FollowerCount
		}
		return res, nil
	case "tiktok":
		_ = codeVerifier
		return TokenResult{}, errors.New("tiktok token exchange not implemented")
	case "x":
		_ = codeVerifier
		return TokenResult{}, errors.New("x token exchange not implemented")
	default:
		return TokenResult{}, errors.New("unsupported platform")
	}
}

func metaExchangeCode(ctx context.Context, cfg config.Config, redirectURI, code string) (string, *time.Time, error) {
	form := url.Values{}
	form.Set("client_id", cfg.OAuth.MetaAppID)
	form.Set("client_secret", cfg.OAuth.MetaAppSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("code", code)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://graph.facebook.com/v20.0/oauth/access_token?"+form.Encode(), nil)
	if err != nil {
		return "", nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", nil, errors.New("token exchange failed")
	}

	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return "", nil, err
	}
	token := strings.TrimSpace(parsed.AccessToken)
	if token == "" {
		return "", nil, errors.New("token exchange failed")
	}
	var expiresAt *time.Time
	if parsed.ExpiresIn > 0 {
		t := time.Now().UTC().Add(time.Duration(parsed.ExpiresIn) * time.Second)
		expiresAt = &t
	}
	return token, expiresAt, nil
}

func metaExchangeLongLived(ctx context.Context, cfg config.Config, shortToken string) (string, *time.Time, error) {
	form := url.Values{}
	form.Set("grant_type", "fb_exchange_token")
	form.Set("client_id", cfg.OAuth.MetaAppID)
	form.Set("client_secret", cfg.OAuth.MetaAppSecret)
	form.Set("fb_exchange_token", shortToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://graph.facebook.com/v20.0/oauth/access_token?"+form.Encode(), nil)
	if err != nil {
		return "", nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", nil, errors.New("long-lived token exchange failed")
	}

	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return "", nil, err
	}
	token := strings.TrimSpace(parsed.AccessToken)
	if token == "" {
		return "", nil, errors.New("long-lived token exchange failed")
	}
	var expiresAt *time.Time
	if parsed.ExpiresIn > 0 {
		t := time.Now().UTC().Add(time.Duration(parsed.ExpiresIn) * time.Second)
		expiresAt = &t
	}
	return token, expiresAt, nil
}

type instagramResolved struct {
	PageAccessToken string
	IGUserID        string
	Username        string
	FollowerCount   int64
}

func metaResolveInstagramAccount(ctx context.Context, userAccessToken string) (instagramResolved, error) {
	u := "https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=" + url.QueryEscape(userAccessToken)
	var parsed struct {
		Data []struct {
			ID                   string `json:"id"`
			AccessToken          string `json:"access_token"`
			InstagramBusinessAcc struct {
				ID string `json:"id"`
			} `json:"instagram_business_account"`
		} `json:"data"`
	}
	if err := metaGET(ctx, u, &parsed); err != nil {
		return instagramResolved{}, err
	}

	for _, p := range parsed.Data {
		pageToken := strings.TrimSpace(p.AccessToken)
		igID := strings.TrimSpace(p.InstagramBusinessAcc.ID)
		if pageToken == "" || igID == "" {
			continue
		}
		ig, err := metaGetIGProfile(ctx, igID, pageToken)
		if err != nil {
			continue
		}
		return instagramResolved{
			PageAccessToken: pageToken,
			IGUserID:        igID,
			Username:        ig.Username,
			FollowerCount:   ig.FollowerCount,
		}, nil
	}

	return instagramResolved{}, errors.New("no instagram business account found")
}

type igProfile struct {
	Username      string `json:"username"`
	FollowerCount int64  `json:"followers_count"`
}

func metaGetIGProfile(ctx context.Context, igUserID string, pageAccessToken string) (igProfile, error) {
	u := fmt.Sprintf("https://graph.facebook.com/v20.0/%s?fields=username,followers_count&access_token=%s", url.PathEscape(igUserID), url.QueryEscape(pageAccessToken))
	var out igProfile
	if err := metaGET(ctx, u, &out); err != nil {
		u2 := fmt.Sprintf("https://graph.facebook.com/v20.0/%s?fields=username&access_token=%s", url.PathEscape(igUserID), url.QueryEscape(pageAccessToken))
		var out2 igProfile
		if err2 := metaGET(ctx, u2, &out2); err2 != nil {
			return igProfile{}, err
		}
		return out2, nil
	}
	return out, nil
}

func metaGET(ctx context.Context, urlStr string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 15 * time.Second}
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
