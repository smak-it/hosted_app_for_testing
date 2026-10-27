# Notes API

Discover actions with `discover_hosted_app_actions`. `list_notes` reads the
latest notes; `create_note` saves text and optional attachments, including images.
Read an action's help for its body and response. Validation previews the request
without saving notes or transferring files. Mutating invocation retries use the
same invocation ID and return the original result.
