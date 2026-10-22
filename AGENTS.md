# Agent guidance

This repository is a validation workload; keep examples small and deterministic.

Keep the root `rukie-app.md`, `rukie-deploy.md`, and `rukie-api.md` accurate when
behavior changes. They describe purpose, deployment configuration/room access,
and invocation semantics respectively. Each should be much shorter than 5 KiB;
never exceed 5 KiB. Releases expose only the first 5 KiB and mark truncation.
Use concrete configuration names and short request/response examples. Do not put
secrets, real destination IDs, or general platform instructions in these files.
