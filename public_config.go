package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
)

// Only these public settings are sent to browsers. Storage credentials never
// enter frontend assets or this response.
func registerPublicConfig(mux *http.ServeMux) error {
	environment := os.Getenv("RUKIE_APP_ENV")
	if environment == "" {
		environment = "production"
	}
	if environment != "production" && environment != "development" {
		return errors.New("invalid RUKIE_APP_ENV")
	}
	urls := map[string]string{}
	if raw := os.Getenv("RUKIE_PUBLIC_URLS"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &urls); err != nil {
			return err
		}
	}
	if urls["web"] == "" {
		urls["web"] = "http://localhost:8080/"
	}
	web, err := url.Parse(urls["web"])
	if err != nil || web.Host == "" || (web.Scheme != "http" && web.Scheme != "https") {
		return errors.New("invalid public web URL")
	}
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"environment": environment, "urls": urls})
	})
	// A display preference, not authentication. It exercises host-only cookies
	// and an absolute redirect through the platform's public exposure path.
	mux.HandleFunc("GET /session/start", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "notes_demo", Value: "remembered", Path: "/", HttpOnly: true, Secure: web.Scheme == "https", SameSite: http.SameSiteLaxMode})
		http.Redirect(w, r, web.String(), http.StatusSeeOther)
	})
	mux.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("notes_demo")
		jsonResponse(w, 200, map[string]bool{"remembered": err == nil && cookie.Value == "remembered"})
	})
	// Validation proof only: demonstrate runtime secret injection without returning
	// the value. This is not an authentication endpoint.
	secret, configured := os.LookupEnv("TESTING_APP_SECRET")
	mux.HandleFunc("GET /api/secret-proof", func(w http.ResponseWriter, r *http.Request) {
		proof := ""
		if configured {
			mac := hmac.New(sha256.New, []byte(secret))
			_, _ = mac.Write([]byte("hosted-app-validation"))
			proof = hex.EncodeToString(mac.Sum(nil))
		}
		jsonResponse(w, 200, map[string]any{"configured": configured, "proof": proof})
	})
	return nil
}
