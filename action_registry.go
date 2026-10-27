package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type actionDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ReadOnly    bool   `json:"read_only"`
	Markdown    string `json:"markdown,omitempty"`
}

type actionResponse struct {
	Result   any    `json:"result"`
	Markdown string `json:"response_markdown"`
}

type registeredAction struct {
	actionDefinition
	validate        func(actionRequest) []string
	requestMarkdown func(actionRequest) string
	execute         func(context.Context, application, pgx.Tx, privateInvocation) (actionResponse, error)
}

// The constructor ties the result formatter to the handler's result type.
// Registration fails at startup if any required part of an action is missing.
func defineAction[R any](definition actionDefinition, validate func(actionRequest) []string,
	requestMarkdown func(actionRequest) string,
	execute func(context.Context, application, pgx.Tx, privateInvocation) (R, error),
	responseMarkdown func(R) string,
) registeredAction {
	if strings.TrimSpace(definition.Name) == "" || strings.TrimSpace(definition.Description) == "" || strings.TrimSpace(definition.Markdown) == "" || validate == nil || requestMarkdown == nil || execute == nil || responseMarkdown == nil {
		panic("incomplete action definition: " + definition.Name)
	}
	return registeredAction{definition, validate, requestMarkdown,
		func(ctx context.Context, app application, tx pgx.Tx, input privateInvocation) (actionResponse, error) {
			result, err := execute(ctx, app, tx, input)
			if err != nil {
				return actionResponse{}, err
			}
			markdown := responseMarkdown(result)
			if strings.TrimSpace(markdown) == "" {
				return actionResponse{}, fmt.Errorf("action %s produced empty result Markdown", definition.Name)
			}
			return actionResponse{Result: result, Markdown: markdown}, nil
		},
	}
}

func registerActions(actions ...registeredAction) map[string]registeredAction {
	registry := make(map[string]registeredAction, len(actions))
	for _, action := range actions {
		if _, exists := registry[action.Name]; exists {
			panic("duplicate action: " + action.Name)
		}
		registry[action.Name] = action
	}
	return registry
}
