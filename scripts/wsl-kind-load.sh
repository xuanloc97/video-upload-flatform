#!/usr/bin/env bash
# Load the already-built images into the kind cluster (no rebuild).
set -euo pipefail
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"

for img in backend processing frontend; do
  echo "=== loading video-platform/$img:dev ==="
  kind load docker-image "video-platform/$img:dev" --name video-platform
done
echo "=== done ==="
