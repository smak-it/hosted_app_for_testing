package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func callAction(t *testing.T, app application, operation, action, id string, body any, attachments ...attachmentMetadata) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"invocation_id": id, "body": map[string]any{"operation": operation, "action": action, "body": body, "attachments": attachments}})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	app.privateRequest(w, httptest.NewRequest("POST", "/rukie", strings.NewReader(string(payload))))
	return w
}

func TestEveryActionContract(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("run docker compose --profile checks run --build --rm checks for PostgreSQL contract tests")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	app := application{db: db}
	// Every discovered action must have a real executable example. New registrations
	// fail this test until an author supplies one; these are not production defaults.
	examples := map[string]map[string]any{
		"list_notes":  {},
		"create_note": {"text": "Contract note", "lose_response_once": true},
	}
	catalog := callAction(t, app, "list", "", "", nil)
	var listed struct {
		Actions []actionDefinition `json:"actions"`
	}
	if err := json.Unmarshal(catalog.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Actions) != len(examples) {
		t.Fatal("update contract examples for the registered actions")
	}
	for _, action := range listed.Actions {
		t.Run(action.Name, func(t *testing.T) {
			body, exists := examples[action.Name]
			if !exists {
				t.Fatalf("missing contract example for %s", action.Name)
			}
			help := callAction(t, app, "describe", action.Name, "", nil)
			var definition actionDefinition
			if err := json.Unmarshal(help.Body.Bytes(), &definition); err != nil || help.Code != 200 || strings.TrimSpace(definition.Markdown) == "" {
				t.Fatalf("help: %s", help.Body.String())
			}
			preview := callAction(t, app, "validate", action.Name, "", body)
			var validation struct {
				Markdown string   `json:"request_markdown"`
				Errors   []string `json:"errors"`
			}
			if err := json.Unmarshal(preview.Body.Bytes(), &validation); err != nil || preview.Code != 200 || validation.Errors == nil || len(validation.Errors) > 0 || strings.TrimSpace(validation.Markdown) == "" {
				t.Fatalf("preview: %s", preview.Body.String())
			}
			invalid := callAction(t, app, "validate", action.Name, "", map[string]any{}, attachmentMetadata{Name: "Unexpected", SizeBytes: 1})
			if err := json.Unmarshal(invalid.Body.Bytes(), &validation); err != nil || len(validation.Errors) == 0 {
				t.Fatalf("invalid preview accepted: %s", invalid.Body.String())
			}
			id := fmt.Sprintf("contract-%s-%s", action.Name, t.Name())
			// Start clean when the test database is reused.
			if _, err := db.Exec(ctx, "DELETE FROM rukie_invocations WHERE id=$1", id); err != nil {
				t.Fatal(err)
			}
			response := callAction(t, app, "invoke", action.Name, id, body)
			if !action.ReadOnly {
				if response.Code != 503 {
					t.Fatalf("expected lost reply, got %d: %s", response.Code, response.Body.String())
				}
				response = callAction(t, app, "invoke", action.Name, id, body)
			}
			var result actionResponse
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result.Result == nil || strings.TrimSpace(result.Markdown) == "" {
				t.Fatalf("result: %s", response.Body.String())
			}
			if action.ReadOnly {
				var receipts int
				if err := db.QueryRow(ctx, "SELECT count(*) FROM rukie_invocations WHERE id=$1", id).Scan(&receipts); err != nil {
					t.Fatal(err)
				}
				if receipts != 0 {
					t.Fatal("read action created a receipt")
				}
			}
			if !action.ReadOnly {
				repeated := callAction(t, app, "invoke", action.Name, id, body)
				if repeated.Body.String() != response.Body.String() {
					t.Fatal("retry changed the saved response")
				}
			}
		})
	}
	t.Run("formatter rollback and receipt", func(t *testing.T) {
		executions, formats := 0, 0
		empty := true
		action := defineAction(actionDefinition{Name: "format_failure", Description: "Test", Markdown: "Test help"}, validateCreateNote, func(actionRequest) string { return "Create note" },
			func(ctx context.Context, app application, tx pgx.Tx, input privateInvocation) (createdNote, error) {
				executions++
				return createNote(ctx, app, tx, input)
			},
			func(result createdNote) string {
				formats++
				if empty {
					return " "
				}
				return result.Body
			})
		noteActions[action.Name] = action
		defer delete(noteActions, action.Name)
		id := "format-failure-contract"
		if _, err := db.Exec(ctx, "DELETE FROM rukie_invocations WHERE id=$1", id); err != nil {
			t.Fatal(err)
		}
		count := func() int {
			var n int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM notes").Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		before := count()
		body := map[string]any{"text": "Formatted note"}
		failed := callAction(t, app, "invoke", action.Name, id, body)
		if failed.Code != 503 || count() != before {
			t.Fatal("format failure did not roll back the note")
		}
		var receipts int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM rukie_invocations WHERE id=$1", id).Scan(&receipts); err != nil {
			t.Fatal(err)
		}
		if receipts != 0 {
			t.Fatal("failed response was committed")
		}
		empty = false
		saved := callAction(t, app, "invoke", action.Name, id, body)
		empty = true
		replay := callAction(t, app, "invoke", action.Name, id, body)
		if saved.Code != 200 || replay.Code != 200 || replay.Body.String() != saved.Body.String() || count() != before+1 || executions != 2 || formats != 2 {
			t.Fatal("retry did not replay the complete receipt")
		}
	})

}

func TestActionRegistrationAndFormattingRequirements(t *testing.T) {
	definition := actionDefinition{Name: "example", Description: "Example", Markdown: "Example help"}
	validate := func(actionRequest) []string { return nil }
	request := func(actionRequest) string { return "Request" }
	execute := func(context.Context, application, pgx.Tx, privateInvocation) (int, error) { return 7, nil }
	result := func(value int) string { return fmt.Sprint(value) }
	for _, missing := range []string{"help", "validator", "request formatter", "handler", "result formatter"} {
		t.Run(missing, func(t *testing.T) {
			d, v, q, e, r := definition, validate, request, execute, result
			switch missing {
			case "help":
				d.Markdown = " "
			case "validator":
				v = nil
			case "request formatter":
				q = nil
			case "handler":
				e = nil
			case "result formatter":
				r = nil
			}
			defer func() {
				if recover() == nil {
					t.Fatal("incomplete action registered")
				}
			}()
			defineAction(d, v, q, e, r)
		})
	}
	empty := defineAction(definition, validate, request, execute, func(int) string { return " " })
	if _, err := empty.execute(context.Background(), application{}, nil, privateInvocation{}); err == nil {
		t.Fatal("empty result Markdown accepted")
	}
	t.Run("duplicate", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("duplicate registered")
			}
		}()
		registerActions(empty, empty)
	})
}
