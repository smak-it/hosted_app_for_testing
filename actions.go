package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

var noteActions = registerActions(
	defineAction(actionDefinition{
		Name: "list_notes", Description: "Read the latest 200 notes.", ReadOnly: true,
		Markdown: "Body: `{}`. Returns {result: an array of notes with id, body and updated_at, response_markdown}. No attachments.",
	}, validateListNotes, func(actionRequest) string { return "Read the latest 200 notes." },
		func(ctx context.Context, app application, _ pgx.Tx, _ privateInvocation) ([]note, error) {
			return app.readNotes(ctx)
		}, formatNotes),
	defineAction(actionDefinition{
		Name: "create_note", Description: "Create a note with optional file attachments.",
		Markdown: "Body: `{\"text\":\"Review ready\"}`. Returns {result: the created note, response_markdown}. Up to 50 attachments, each up to 32 MiB, are saved on the note, including screenshots. Optional `lose_response_once: true` simulates a lost reply for validation; retries reuse the invocation ID.",
	}, validateCreateNote, func(input actionRequest) string {
		var text string
		_ = json.Unmarshal(input.Body["text"], &text)
		encoded, _ := json.Marshal(text)
		return fmt.Sprintf("Create a note with %d attachment(s).\n\n    %s", len(input.Attachments), encoded)
	}, createNote, func(result createdNote) string {
		quoted, _ := json.Marshal(result.Body)
		return fmt.Sprintf("Created a note with %d attachment(s).\n\n    %s", result.AttachmentCount, quoted)
	}),
)

func validateListNotes(input actionRequest) []string {
	if len(input.Attachments) > 0 {
		return []string{"list_notes does not accept attachments."}
	}
	return nil
}
func validateCreateNote(input actionRequest) []string {
	var text string
	if json.Unmarshal(input.Body["text"], &text) != nil || strings.TrimSpace(text) == "" {
		return []string{"text must be a non-empty string."}
	}
	var lose bool
	if value, exists := input.Body["lose_response_once"]; exists && json.Unmarshal(value, &lose) != nil {
		return []string{"lose_response_once must be a boolean."}
	}
	return nil
}
func formatNotes(notes []note) string {
	var markdown strings.Builder
	fmt.Fprintf(&markdown, "%d notes.\n", len(notes))
	for _, note := range notes {
		text, _ := json.Marshal(note.Body)
		fmt.Fprintf(&markdown, "\n    %s\n", text)
	}
	return markdown.String()
}

func (a application) actions(w http.ResponseWriter, _ *http.Request) {
	summaries := make([]actionDefinition, 0, len(noteActions))
	for _, action := range noteActions {
		summary := action.actionDefinition
		summary.Markdown = ""
		summaries = append(summaries, summary)
	}
	sort.Slice(summaries, func(i, j int) bool { return summaries[i].Name < summaries[j].Name })
	jsonResponse(w, 200, map[string]any{"actions": summaries})
}
func (a application) actionHelp(w http.ResponseWriter, r *http.Request, name string) {
	action, ok := noteActions[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	jsonResponse(w, 200, action.actionDefinition)
}

func validateRequest(action registeredAction, input actionRequest) []string {
	failures := []string{}
	if input.Body == nil {
		failures = append(failures, "Expected a JSON body object.")
	}
	if len(input.Attachments) > 50 {
		failures = append(failures, "At most 50 attachments.")
	}
	for _, file := range input.Attachments {
		if file.Name == "" || file.SizeBytes <= 0 || file.SizeBytes > maxAttachmentBytes {
			failures = append(failures, "Attachments require a name and 1 byte to 32 MiB.")
		}
	}
	return append(failures, action.validate(input)...)
}
func (a application) validateAction(w http.ResponseWriter, input actionRequest) {
	action, ok := noteActions[input.Action]
	if !ok {
		jsonResponse(w, 404, map[string]string{"error": "Unknown action"})
		return
	}
	failures := validateRequest(action, input)
	markdown := ""
	if len(failures) == 0 {
		markdown = action.requestMarkdown(input)
		if strings.TrimSpace(markdown) == "" {
			a.failure(w, fmt.Errorf("action %s produced empty request Markdown", action.Name))
			return
		}
	}
	jsonResponse(w, 200, map[string]any{"request_markdown": markdown, "errors": failures})
}
