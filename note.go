package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"time"
)

func (a application) getNote(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		jsonResponse(w, 400, map[string]string{"error": "Invalid note ID."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var result note
	err = a.db.QueryRow(ctx, "SELECT id,body,updated_at FROM notes WHERE id=$1", id).Scan(&result.ID, &result.Body, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonResponse(w, 404, map[string]string{"error": "Note not found."})
		return
	}
	if err != nil {
		a.failure(w, err)
		return
	}
	jsonResponse(w, 200, result)
}
