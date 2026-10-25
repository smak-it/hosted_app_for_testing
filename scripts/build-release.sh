#!/usr/bin/env bash
# Run in the app repository: ./scripts/build-release.sh my-app:dev [docker build options]
set -euo pipefail
image=${1:?Usage: build-release.sh IMAGE [docker build options]}
shift
metadata=$(python3 - <<'PY'
import json
from pathlib import Path

metadata = json.loads(Path('rukie-app.json').read_text())
metadata.pop('dockerfile', None)
metadata.pop('build_resources', None)
guidance = {}
for kind, name in [('description', 'rukie-app.md'), ('deployment', 'rukie-deploy.md'), ('invocation', 'rukie-api.md')]:
    path = Path(name)
    if path.is_file():
        data = path.read_bytes()
        guidance[kind] = {'path': name, 'content': data[:5120].decode('utf-8', errors='ignore'), 'truncated': len(data) > 5120}
if guidance:
    metadata['guidance'] = guidance
print(json.dumps(metadata, separators=(',', ':')))
PY
)
docker build --platform linux/amd64 --label "app.rukie.release=$metadata" --tag "$image" "$@" .
