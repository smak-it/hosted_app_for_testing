package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestActionDiscoveryAndPreview(t *testing.T) {
	// A nil database proves these handlers never execute business writes.
	app := application{}
	w := httptest.NewRecorder()
	app.privateRequest(w, httptest.NewRequest("POST", "/rukie", strings.NewReader(`{"body":{"operation":"list"}}`)))
	if !strings.Contains(w.Body.String(), `"read_only":true`) {
		t.Fatal(w.Body.String())
	}
	for _, check := range []struct {
		action, body string
		errors       int
	}{
		{"create_note", `{"body":{"text":"Review ready"},"attachments":[{"name":"Screenshot.png","size_bytes":123,"content_type":"image/png"}]}`, 0},
		{"create_note", `{"body":{}}`, 1},
		{"list_notes", `{"body":{}}`, 0},
	} {
		var body map[string]any
		if err := json.Unmarshal([]byte(check.body), &body); err != nil {
			t.Fatal(err)
		}
		body["operation"], body["action"] = "validate", check.action
		payload, _ := json.Marshal(map[string]any{"body": body})
		r := httptest.NewRequest("POST", "/rukie", strings.NewReader(string(payload)))
		w := httptest.NewRecorder()
		app.privateRequest(w, r)
		var result struct {
			Errors  []string `json:"errors"`
			Summary string   `json:"request_markdown"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Errors) != check.errors || check.errors == 0 && result.Summary == "" {
			t.Fatal(w.Body.String())
		}
	}
}
