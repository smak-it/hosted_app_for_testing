package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// The private listener is deliberately separate from the public frontend/API.
// Container deployment uses host networking; local Compose does not publish it.
func (a application) startInvocations() (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /rukie", a.privateRequest)
	listener, err := net.Listen("tcp", "127.0.0.1:8081")
	if err != nil {
		return nil, err
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second}
	go func() { _ = server.Serve(listener) }()
	return server, nil
}

type actionRequest struct {
	Operation   string                     `json:"operation"`
	Action      string                     `json:"action"`
	Body        map[string]json.RawMessage `json:"body"`
	Attachments []attachmentMetadata       `json:"attachments"`
}
type attachmentMetadata struct {
	Name        string `json:"name"`
	SizeBytes   int64  `json:"size_bytes"`
	ContentType string `json:"content_type"`
}
type privateInvocation struct {
	InvocationID string        `json:"invocation_id"`
	Body         actionRequest `json:"body"`
	Attachments  []struct {
		Name    string `json:"name"`
		BlobKey string `json:"blob_key"`
	} `json:"attachments"`
}

func (a application) privateRequest(w http.ResponseWriter, r *http.Request) {
	var input privateInvocation
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024)).Decode(&input); err != nil {
		jsonResponse(w, 400, map[string]string{"error": "Invalid request"})
		return
	}
	switch input.Body.Operation {
	case "list":
		a.actions(w, r)
	case "describe":
		a.actionHelp(w, r, input.Body.Action)
	case "validate":
		a.validateAction(w, input.Body)
	case "invoke":
		a.invoke(w, r, input)
	default:
		jsonResponse(w, 400, map[string]string{"error": "Unknown operation"})
	}
}

type actionInputError struct {
	status  int
	message string
}

func (e actionInputError) Error() string { return e.message }
func (a application) actionFailure(w http.ResponseWriter, err error) {
	var input actionInputError
	if errors.As(err, &input) {
		jsonResponse(w, input.status, map[string]string{"error": input.message})
		return
	}
	a.failure(w, err)
}

func (a application) invoke(w http.ResponseWriter, r *http.Request, input privateInvocation) {
	action, exists := noteActions[input.Body.Action]
	if !exists {
		jsonResponse(w, 404, map[string]string{"error": "Unknown action"})
		return
	}
	if input.InvocationID == "" || input.Body.Body == nil || len(input.Attachments) > 50 {
		jsonResponse(w, 400, map[string]string{"error": "Expected invocation_id, a JSON body object and at most 50 attachments"})
		return
	}
	// Invocation attachments are blob references, not the caller's preview metadata.
	input.Body.Attachments = nil
	for _, file := range input.Attachments {
		if strings.TrimSpace(file.Name) == "" || file.BlobKey == "" {
			jsonResponse(w, 400, map[string]string{"error": "Attachment name and blob_key required"})
			return
		}
		input.Body.Attachments = append(input.Body.Attachments, attachmentMetadata{Name: file.Name})
	}
	if failures := action.validate(input.Body); len(failures) > 0 {
		jsonResponse(w, 400, map[string]any{"errors": failures})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if action.ReadOnly {
		response, err := action.execute(ctx, a, nil, input)
		if err != nil {
			a.actionFailure(w, err)
			return
		}
		jsonResponse(w, 200, response)
		return
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		a.failure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	// The mutation, formatted response and receipt commit together.
	if _, err = tx.Exec(ctx, `
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
`, input.InvocationID); err != nil {
		a.failure(w, err)
		return
	}
	var saved json.RawMessage
	err = tx.QueryRow(ctx, `
SELECT result
FROM rukie_invocations
WHERE id = $1
`, input.InvocationID).Scan(&saved)
	if err == nil {
		jsonResponse(w, 200, saved)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		a.failure(w, err)
		return
	}
	response, err := action.execute(ctx, a, tx, input)
	if err != nil {
		a.actionFailure(w, err)
		return
	}
	saved, err = json.Marshal(response)
	if err != nil {
		a.failure(w, err)
		return
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO rukie_invocations (id, result)
VALUES ($1, $2)
`, input.InvocationID, saved); err != nil {
		a.failure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		a.failure(w, err)
		return
	}
	var lose bool
	_ = json.Unmarshal(input.Body.Body["lose_response_once"], &lose)
	if lose {
		jsonResponse(w, 503, map[string]string{"error": "Validation: successful response lost; retry the same invocation"})
		return
	}
	jsonResponse(w, 200, saved)
}

type createdNote struct {
	note
	AttachmentCount int `json:"-"`
}

func createNote(ctx context.Context, a application, tx pgx.Tx, input privateInvocation) (createdNote, error) {
	var text string
	_ = json.Unmarshal(input.Body.Body["text"], &text)
	var created createdNote
	if err := tx.QueryRow(ctx, `
INSERT INTO notes (body)
VALUES ($1)
RETURNING id, body, updated_at
`, text).Scan(&created.ID, &created.Body, &created.UpdatedAt); err != nil {
		return created, err
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
			return created, err
		}
		// Sniff a small prefix and count the rest without buffering a whole file.
		header, readErr := io.ReadAll(io.LimitReader(response.Body, 512))
		var remaining int64
		if readErr == nil {
			remaining, readErr = io.Copy(io.Discard, io.LimitReader(response.Body, int64(maxAttachmentBytes+1-len(header))))
		}
		response.Body.Close()
		if readErr != nil {
			return created, readErr
		}
		size := int64(len(header)) + remaining
		if size <= 0 || size > maxAttachmentBytes {
			return created, actionInputError{http.StatusBadRequest, "Files must contain 1 byte to 32 MiB"}
		}
		// The existing attachment ID is also its blob key, so normal downloads
		// and deletion work without copying bytes or adding another storage model.
		if _, err := tx.Exec(ctx, `
INSERT INTO attachments (id, note_id, filename, content_type, size)
VALUES ($1, $2, $3, $4, $5)
`, file.BlobKey, created.ID, file.Name, http.DetectContentType(header), size); err != nil {
			return created, err
		}
	}

	created.AttachmentCount = len(seen)
	return created, nil
}
