#!/usr/bin/env bash
# Build the three service images and load them into the kind cluster (Req 10.6).
#
# Usage: bash scripts/build.sh [KIND_CLUSTER_NAME]
#   KIND_CLUSTER_NAME defaults to "kind".
#
# Images are tagged :dev to match the Kustomize overlays. Run scripts/deploy.sh afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER="${1:-kind}"
TAG="dev"

command -v docker >/dev/null || { echo "docker not found on PATH" >&2; exit 1; }
command -v kind >/dev/null || { echo "kind not found on PATH" >&2; exit 1; }

echo "==> Building backend image"
docker build -f "$ROOT/backend/Dockerfile" -t "video-platform/backend:$TAG" "$ROOT"

echo "==> Building processing image"
docker build -f "$ROOT/processing/Dockerfile" -t "video-platform/processing:$TAG" "$ROOT"

echo "==> Building frontend image"
docker build -f "$ROOT/frontend/Dockerfile" -t "video-platform/frontend:$TAG" "$ROOT/frontend"

echo "==> Loading images into kind cluster '$CLUSTER'"
kind load docker-image "video-platform/backend:$TAG" --name "$CLUSTER"
kind load docker-image "video-platform/processing:$TAG" --name "$CLUSTER"
kind load docker-image "video-platform/frontend:$TAG" --name "$CLUSTER"

echo "==> Done. Next: bash scripts/deploy.sh [dev|ha]"
