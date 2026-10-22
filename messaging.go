package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// This reference workload deliberately has no authentication. Grant it only
// synthetic validation rooms; real applications must authorize their callers.
func registerMessaging(mux *http.ServeMux) {
	endpoint := strings.TrimRight(os.Getenv("RUKIE_API_URL"), "/")
	conversation := os.Getenv("REPORT_CONVERSATION_ID")
	mux.HandleFunc("GET /api/messaging", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"enabled": endpoint != "", "conversation_id": conversation})
	})
	mux.HandleFunc("POST /api/messaging", func(w http.ResponseWriter, r *http.Request) {
		if endpoint == "" {
			jsonResponse(w, 503, map[string]string{"error": "Rukie messaging is not configured."})
			return
		}
		var input struct {
			RequestID      string `json:"request_id"`
			ConversationID string `json:"conversation_id"`
			Content        string `json:"content"`
			Attachments    []struct {
				BlobKey string `json:"blob_key"`
				Name    string `json:"name"`
			} `json:"attachments,omitempty"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024)).Decode(&input); err != nil {
			jsonResponse(w, 400, map[string]string{"error": "Invalid message."})
			return
		}
		if input.ConversationID == "" {
			input.ConversationID = conversation
		}
		body, _ := json.Marshal(input)
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint+"/messages", bytes.NewReader(body))
		if err != nil {
			jsonResponse(w, 503, map[string]string{"error": "Invalid messaging configuration."})
			return
		}
		req.Header.Set("Content-Type", "application/json")
		response, err := (&http.Client{Timeout: 50 * time.Second}).Do(req)
		if err != nil {
			jsonResponse(w, 503, map[string]string{"error": "Delivery unavailable. Retry without changing the form."})
			return
		}
		defer response.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(response.Body, 128*1024))
	})
}
