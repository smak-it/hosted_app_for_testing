package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type actionDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ReadOnly    bool   `json:"read_only"`
	Markdown    string `json:"markdown,omitempty"`
}

var noteActions = []actionDefinition{
	{Name: "list_notes", Description: "Read the latest 200 notes.", ReadOnly: true, Markdown: "Body: `{}`. Returns {result: an array of notes with id, body and updated_at, response_markdown}. No attachments."},
	{Name: "create_note", Description: "Create a note with optional file attachments.", Markdown: "Body: `{\"text\":\"Review ready\"}`. Returns {result: the created note, response_markdown}. Up to 50 attachments, each up to 32 MiB, are saved on the note, including screenshots. Optional `lose_response_once: true` simulates a lost reply for validation; retries reuse the invocation ID."},
}

func (a application) actions(w http.ResponseWriter, r *http.Request) {
	summaries := make([]actionDefinition, len(noteActions))
	copy(summaries, noteActions)
	for i := range summaries {
		summaries[i].Markdown = ""
	}
	jsonResponse(w, 200, map[string]any{"actions": summaries})
}
func findNoteAction(name string) (actionDefinition, bool) {
	for _, action := range noteActions {
		if action.Name == name {
			return action, true
		}
	}
	return actionDefinition{}, false
}
func (a application) actionHelp(w http.ResponseWriter, r *http.Request, name string) {
	action, ok := findNoteAction(name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	jsonResponse(w, 200, action)
}
func (a application) validateAction(w http.ResponseWriter, input actionRequest) {
	action, ok := findNoteAction(input.Action)
	if !ok {
		jsonResponse(w, 404, map[string]string{"error": "Unknown action"})
		return
	}
	errors := []string{}
	summary := "Read the latest 200 notes."
	if input.Body == nil {
		errors = append(errors, "Expected a JSON body object.")
	}
	if action.Name == "create_note" {
		var text string
		if json.Unmarshal(input.Body["text"], &text) != nil || strings.TrimSpace(text) == "" {
			errors = append(errors, "text must be a non-empty string.")
		}
		// Quoted JSON is shown in a code block so supplied text cannot change the preview formatting.
		encoded, _ := json.Marshal(text)
		summary = fmt.Sprintf("Create a note with %d attachment(s).\n\n    %s", len(input.Attachments), encoded)
	} else if len(input.Attachments) > 0 {
		errors = append(errors, "list_notes does not accept attachments.")
	}
	if len(input.Attachments) > 50 {
		errors = append(errors, "At most 50 attachments.")
	}
	for _, file := range input.Attachments {
		if file.Name == "" || file.SizeBytes <= 0 || file.SizeBytes > maxAttachmentBytes {
			errors = append(errors, "Attachments require a name and 1 byte to 32 MiB.")
		}
	}
	jsonResponse(w, 200, map[string]any{"request_markdown": summary, "errors": errors})
}
