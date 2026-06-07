package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

func (h AIHandler) openAIChatJSONWithImageURLs(ctx context.Context, system, user string, imageURLs []string) (string, openAIUsage, string, error) {
	base := strings.TrimRight(strings.TrimSpace(h.cfg.AI.OpenAIBaseURL), "/")
	if base == "" {
		base = "https://api.openai.com"
	}
	model := strings.TrimSpace(h.cfg.AI.OpenAIModel)
	if model == "" {
		model = "gpt-4o-mini"
	}

	content := make([]map[string]any, 0, 1+len(imageURLs))
	content = append(content, map[string]any{"type": "text", "text": user})
	for _, u := range imageURLs {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]any{
				"url": u,
			},
		})
	}

	payload := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "system", "content": system},
			{"role": "user", "content": content},
		},
		"temperature": 0.4,
		"response_format": map[string]any{
			"type": "json_object",
		},
	}
	b, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return "", openAIUsage{}, "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(h.cfg.AI.OpenAIAPIKey))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 45 * time.Second}
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
	out := strings.TrimSpace(parsed.Choices[0].Message.Content)
	usage := openAIUsage{
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
		TotalTokens:      parsed.Usage.TotalTokens,
	}
	return out, usage, parsed.Model, nil
}

