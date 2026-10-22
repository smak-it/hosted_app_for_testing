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
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", input.InvocationID); err != nil {
		a.failure(w, err)
		return
	}
	var result json.RawMessage
	err = tx.QueryRow(ctx, "SELECT result FROM rukie_invocations WHERE id=$1", input.InvocationID).Scan(&result)
	if err == nil {
		jsonResponse(w, 200, result)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		a.failure(w, err)
		return
	}
	body := input.Body.Text
	for _, attachment := range input.Attachments {
		response, err := a.blobs.request(ctx, http.MethodGet, attachment.BlobKey, nil)
		if err != nil {
			a.failure(w, err)
			return
		}
		content, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		response.Body.Close()
		if err != nil {
			a.failure(w, err)
			return
		}
		if len(content) > 4096 {
			jsonResponse(w, 400, map[string]string{"error": "Example handler accepts text attachments up to 4 KiB"})
			return
		}
		body += "\n" + attachment.Name + ": " + string(content)
	}
	var created note
	if err = tx.QueryRow(ctx, "INSERT INTO notes(body) VALUES($1) RETURNING id,body,updated_at", body).Scan(&created.ID, &created.Body, &created.UpdatedAt); err != nil {
		a.failure(w, err)
		return
	}
	result, err = json.Marshal(created)
	if err != nil {
		a.failure(w, err)
		return
	}
	if _, err = tx.Exec(ctx, "INSERT INTO rukie_invocations(id,result) VALUES($1,$2)", input.InvocationID, result); err != nil {
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
