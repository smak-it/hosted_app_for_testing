package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// The private listener is deliberately separate from the public frontend/API.
// Container deployment uses host networking; local Compose does not publish it.
func (a application) startInvocations() (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /rukie/invoke", a.invoke)
	listener, err := net.Listen("tcp", "127.0.0.1:8081")
	if err != nil {
		return nil, err
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second}
	go func() { _ = server.Serve(listener) }()
	return server, nil
}

func (a application) invoke(w http.ResponseWriter, r *http.Request) {
	var input struct {
		InvocationID string `json:"invocation_id"`
		Body         struct {
			Action           string `json:"action"`
			Text             string `json:"text"`
			LoseResponseOnce bool   `json:"lose_response_once,omitempty"`
		} `json:"body"`
		Attachments []struct {
			Name    string `json:"name"`
			BlobKey string `json:"blob_key"`
		} `json:"attachments,omitempty"`
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 128*1024))
	if err != nil || json.Unmarshal(data, &input) != nil || input.InvocationID == "" || input.Body.Action != "create_note" || input.Body.Text == "" {
		jsonResponse(w, 400, map[string]string{"error": "Expected invocation_id and body {action: create_note, text: ...}"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := a.db.Begin(ctx)
	if err != nil {
		a.failure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	// Serialize duplicate attempts. The receipt and note commit in one transaction.
	if _, err = tx.Exec(ctx, `
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
`, input.InvocationID); err != nil {
		a.failure(w, err)
		return
	}
	var result json.RawMessage
	err = tx.QueryRow(ctx, `
SELECT result
FROM rukie_invocations
WHERE id = $1
`, input.InvocationID).Scan(&result)
	if err == nil {
		jsonResponse(w, 200, result)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		a.failure(w, err)
		return
	}
	if len(input.Attachments) > 50 {
		jsonResponse(w, 400, map[string]string{"error": "At most 50 attachments are allowed"})
		return
	}
	var created note
	if err = tx.QueryRow(ctx, `
INSERT INTO notes (body)
VALUES ($1)
RETURNING id, body, updated_at
`, input.Body.Text).Scan(&created.ID, &created.Body, &created.UpdatedAt); err != nil {
		a.failure(w, err)
		return
	}
	seen := make(map[string]bool)
	for _, file := range input.Attachments {
		// Rukie supplies immutable blob keys scoped to this invocation and file.
		// Repeated references to the same file become one note attachment.
		if seen[file.BlobKey] {
			continue
		}
		seen[file.BlobKey] = true
		response, err := a.blobs.request(ctx, http.MethodGet, file.BlobKey, nil)
		if err != nil {
			a.failure(w, err)
			return
		}
		// Sniff a small prefix and count the rest without buffering a whole file.
		header, readErr := io.ReadAll(io.LimitReader(response.Body, 512))
		var remaining int64
		if readErr == nil {
			remaining, readErr = io.Copy(io.Discard, io.LimitReader(response.Body, int64(maxAttachmentBytes+1-len(header))))
		}
		response.Body.Close()
		if readErr != nil {
			a.failure(w, readErr)
			return
		}
		size := int64(len(header)) + remaining
		if size > maxAttachmentBytes {
			jsonResponse(w, 413, map[string]string{"error": "File exceeds 32 MiB"})
			return
		}
		// The existing attachment ID is also its blob key, so normal downloads
		// and deletion work without copying bytes or adding another storage model.
		if _, err = tx.Exec(ctx, `
INSERT INTO attachments (id, note_id, filename, content_type, size)
VALUES ($1, $2, $3, $4, $5)
`, file.BlobKey, created.ID, file.Name, http.DetectContentType(header), size); err != nil {
			a.failure(w, err)
			return
		}
	}
	result, err = json.Marshal(created)
	if err != nil {
		a.failure(w, err)
		return
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO rukie_invocations (id, result)
VALUES ($1, $2)
`, input.InvocationID, result); err != nil {
		a.failure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		a.failure(w, err)
		return
	}
	// Explicit validation action: commit the work but lose its first successful reply.
	if input.Body.LoseResponseOnce {
		jsonResponse(w, 503, map[string]string{"error": "Validation: successful response lost; retry the same invocation"})
		return
	}
	jsonResponse(w, 200, result)
}
