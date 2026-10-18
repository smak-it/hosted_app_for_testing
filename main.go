package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed web migrations/001_notes.sql VERSION
var assets embed.FS

type application struct{ db *pgxpool.Pool }
type note struct {
	ID        int64     `json:"id"`
	Body      string    `json:"body"`
	UpdatedAt time.Time `json:"updated_at"`
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (a application) failure(w http.ResponseWriter, err error) {
	slog.Error("database operation failed", "error", err)
	jsonResponse(w, 503, map[string]string{"error": "Database unavailable. Please try again."})
}

func (a application) list(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	rows, err := a.db.Query(ctx, "SELECT id, body, updated_at FROM notes ORDER BY id DESC LIMIT 200")
	if err != nil {
		a.failure(w, err)
		return
	}
	notes, err := pgx.CollectRows(rows, pgx.RowToStructByName[note])
	if err != nil {
		a.failure(w, err)
		return
	}
	if notes == nil {
		notes = []note{}
	}
	jsonResponse(w, 200, notes)
}

func (a application) save(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Body string `json:"body"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF {
		jsonResponse(w, 400, map[string]string{"error": "Send a JSON object with a body field."})
		return
	}
	input.Body = strings.TrimSpace(input.Body)
	if len(input.Body) == 0 || len(input.Body) > 4000 {
		jsonResponse(w, 400, map[string]string{"error": "A note must contain 1–4000 bytes of text."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var saved note
	var err error
	status := 201
	if r.Method == http.MethodPost {
		err = a.db.QueryRow(ctx, "INSERT INTO notes(body) VALUES($1) RETURNING id,body,updated_at", input.Body).Scan(&saved.ID, &saved.Body, &saved.UpdatedAt)
	} else {
		id, parseErr := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if parseErr != nil || id < 1 {
			jsonResponse(w, 400, map[string]string{"error": "Invalid note ID."})
			return
		}
		status = 200
		err = a.db.QueryRow(ctx, "UPDATE notes SET body=$1,updated_at=now() WHERE id=$2 RETURNING id,body,updated_at", input.Body, id).Scan(&saved.ID, &saved.Body, &saved.UpdatedAt)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		jsonResponse(w, 404, map[string]string{"error": "Note not found."})
		return
	}
	if err != nil {
		a.failure(w, err)
		return
	}
	jsonResponse(w, status, saved)
}

func (a application) remove(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		jsonResponse(w, 400, map[string]string{"error": "Invalid note ID."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	result, err := a.db.Exec(ctx, "DELETE FROM notes WHERE id=$1", id)
	if err != nil {
		a.failure(w, err)
		return
	}
	if result.RowsAffected() == 0 {
		jsonResponse(w, 404, map[string]string{"error": "Note not found."})
		return
	}
	w.WriteHeader(204)
}

func migrate(ctx context.Context, db *pgxpool.Pool) error {
	script, err := assets.ReadFile("migrations/001_notes.sql")
	if err != nil {
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serialize startup migrations if two instances overlap during a deployment.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(710031)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, string(script)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func run(ctx context.Context) error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return errors.New("DATABASE_URL is invalid")
	}
	cfg.MaxConns = 4
	cfg.ConnConfig.ConnectTimeout = 3 * time.Second
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	err = migrate(startup, db)
	cancel()
	if err != nil {
		return err
	}
	a := application{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/notes", a.list)
	mux.HandleFunc("POST /api/notes", a.save)
	mux.HandleFunc("PUT /api/notes/{id}", a.save)
	mux.HandleFunc("DELETE /api/notes/{id}", a.remove)
	version, _ := assets.ReadFile("VERSION")
	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]string{"version": strings.TrimSpace(string(version)), "message": os.Getenv("WELCOME_MESSAGE")})
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		check, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		var ready bool
		err := db.QueryRow(check, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=1) AND (SELECT count(*)>=0 FROM notes)").Scan(&ready)
		if err != nil {
			a.failure(w, err)
			return
		}
		if !ready {
			jsonResponse(w, 503, map[string]string{"error": "Schema is not ready."})
			return
		}
		jsonResponse(w, 200, map[string]string{"status": "ready"})
	})
	web, _ := fs.Sub(assets, "web")
	mux.Handle("GET /", http.FileServer(http.FS(web)))
	server := &http.Server{Addr: ":8080", Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	finished := make(chan error, 1)
	go func() { finished <- server.ListenAndServe() }()
	slog.Info("notes app ready", "port", 8080, "version", strings.TrimSpace(string(version)))
	select {
	case err := <-finished:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("application stopped", "error", err)
		os.Exit(1)
	}
}
