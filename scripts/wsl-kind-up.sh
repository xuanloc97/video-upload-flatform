#!/usr/bin/env bash
# Create the local kind cluster for the demo. Idempotent: skips creation if it already exists.
set -euo pipefail
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"

ROOT=/mnt/d/PROJECTS/video-upload-flatform

if kind get clusters 2>/dev/null | grep -qx "video-platform"; then
  echo "kind cluster 'video-platform' already exists."
else
  kind create cluster --config "$ROOT/deployment/kind-cluster.yaml"
fi

echo "--- current context ---"
kubectl config current-context
echo "--- nodes ---"
kubectl get nodes
