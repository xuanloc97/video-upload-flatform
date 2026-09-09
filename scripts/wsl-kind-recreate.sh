#!/usr/bin/env bash
# Delete and recreate the local kind cluster cleanly, then install the ingress controller.
set -euo pipefail
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"

ROOT=/mnt/d/PROJECTS/video-upload-flatform

echo "=== deleting any existing cluster ==="
kind delete cluster --name video-platform || true

echo "=== creating cluster ==="
kind create cluster --config "$ROOT/deployment/kind-cluster.yaml"

echo "=== waiting for node Ready ==="
kubectl wait --for=condition=Ready node --all --timeout=120s

echo "=== context ==="
kubectl config current-context
