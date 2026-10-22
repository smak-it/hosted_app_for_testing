package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

const maxAttachmentBytes = 32 << 20

type blobStorage struct {
	endpoint, token string
	client          *http.Client
}

func (b blobStorage) request(ctx context.Context, method, key string, body io.Reader) (*http.Response, error) {
	target, err := url.JoinPath(b.endpoint, key)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+b.token)
	req.Header.Set("Content-Type", "application/octet-stream")
	response, err := b.client.Do(req)
	if err != nil {
		return nil, errors.New("blob service request failed")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, fmt.Errorf("blob service returned %d", response.StatusCode)
	}
	return response, nil
}

type attachment struct {
	ID          string `json:"id"`
	NoteID      int64  `json:"note_id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

func (a application) attachments(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonResponse(w, 400, map[string]string{"error": "Invalid note ID."})
		return
	}
	rows, err := a.db.Query(r.Context(), "SELECT id,note_id,filename,content_type,size FROM attachments WHERE note_id=$1 ORDER BY id", id)
	if err != nil {
		a.failure(w, err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByName[attachment])
	if err != nil {
		a.failure(w, err)
		return
	}
	if items == nil {
		items = []attachment{}
	}
	jsonResponse(w, 200, items)
}
func (a application) upload(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonResponse(w, 400, map[string]string{"error": "Invalid note ID."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentBytes+65536)
	if err = r.ParseMultipartForm(maxAttachmentBytes); err != nil {
		jsonResponse(w, 400, map[string]string{"error": "Upload one file, at most 32 MiB."})
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonResponse(w, 400, map[string]string{"error": "Choose a file."})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAttachmentBytes+1))
	if err != nil || len(data) > maxAttachmentBytes {
		jsonResponse(w, 413, map[string]string{"error": "File exceeds 32 MiB."})
		return
	}
	key := make([]byte, 16)
	if _, err = rand.Read(key); err != nil {
		a.failure(w, err)
		return
	}
	item := attachment{ID: hex.EncodeToString(key), NoteID: id, Filename: header.Filename, ContentType: http.DetectContentType(data), Size: int64(len(data))}
	// Lock the parent note so deletion cannot race an attachment upload.
	tx, err := a.db.Begin(ctx)
	if err != nil {
		a.failure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var parent int64
	if err = tx.QueryRow(ctx, "SELECT id FROM notes WHERE id=$1 FOR UPDATE", id).Scan(&parent); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonResponse(w, 404, map[string]string{"error": "Note not found."})
			return
		}
		a.failure(w, err)
		return
	}
	response, err := a.blobs.request(ctx, http.MethodPut, item.ID, bytes.NewReader(data))
	if err != nil {
		a.failure(w, err)
		return
	}
	response.Body.Close()
	_, err = tx.Exec(ctx, "INSERT INTO attachments(id,note_id,filename,content_type,size) VALUES($1,$2,$3,$4,$5)", item.ID, id, item.Filename, item.ContentType, item.Size)
	if err == nil {
		err = tx.Commit(ctx)
	}
	// A lost commit response is ambiguous: retain the blob rather than corrupt a possibly committed attachment.
	if err != nil {
		a.failure(w, err)
		return
	}
	jsonResponse(w, 201, item)
}
func (a application) download(w http.ResponseWriter, r *http.Request) {
	var item attachment
	err := a.db.QueryRow(r.Context(), "SELECT id,note_id,filename,content_type,size FROM attachments WHERE id=$1", r.PathValue("key")).Scan(&item.ID, &item.NoteID, &item.Filename, &item.ContentType, &item.Size)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		a.failure(w, err)
		return
	}
	response, err := a.blobs.request(r.Context(), http.MethodGet, item.ID, nil)
	if err != nil {
		a.failure(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": item.Filename}))
	w.Header().Set("Content-Length", strconv.FormatInt(item.Size, 10))
	_, _ = io.Copy(w, response.Body)
}

// Metadata is authoritative. Never remove bytes before deletion commits: a lost
// database response could otherwise leave a visible attachment with missing data.
func (a application) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	result, err := a.db.Exec(r.Context(), "DELETE FROM attachments WHERE id=$1", key)
	if err != nil {
		a.failure(w, err)
		return
	}
	if result.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	a.removeBlob(r.Context(), key)
	w.WriteHeader(204)
}

// Byte cleanup is best effort for this reference workload. Unreferenced objects
// remain private and are removed with the app's container when the app is deleted.
func (a application) removeBlob(ctx context.Context, key string) {
	response, err := a.blobs.request(ctx, http.MethodDelete, key, nil)
	if err != nil {
		slog.Warn("unreferenced attachment retained until app deletion", "key", key, "error", err)
		return
	}
	response.Body.Close()
}
