#!/usr/bin/env bash
# Bring up the local kind cluster and the NGINX ingress controller for the platform.
#
# Usage: bash scripts/cluster-up.sh
#
# Idempotent: if the 'video-platform' kind cluster already exists it is reused. After this, run
#   bash scripts/build.sh video-platform   # build + load images
#   bash scripts/deploy.sh dev|ha           # apply the overlay
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER="video-platform"

command -v docker  >/dev/null || { echo "docker not found on PATH" >&2; exit 1; }
command -v kind    >/dev/null || { echo "kind not found on PATH" >&2; exit 1; }
command -v kubectl >/dev/null || { echo "kubectl not found on PATH" >&2; exit 1; }

docker info >/dev/null 2>&1 || { echo "Docker daemon is not running — start Docker and retry." >&2; exit 1; }

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "==> kind cluster '$CLUSTER' already exists — reusing it"
else
  echo "==> Creating kind cluster '$CLUSTER' (ingress-ready, host ports 80/443)"
  kind create cluster --config "$ROOT/deployment/kind-cluster.yaml"
fi

echo "==> Ensuring kube-context points at the kind cluster"
kubectl config use-context "kind-$CLUSTER" >/dev/null

echo "==> Installing the NGINX ingress controller"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "==> Waiting for the ingress controller to be ready"
kubectl wait --namespace ingress-nginx \
  --for=condition=Ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s || {
    echo "Ingress controller did not become ready in time. You can still use port-forward as a" >&2
    echo "fallback (see README). Continuing." >&2
  }

cat <<EOF

==> Cluster is up.

Next:
  bash scripts/build.sh $CLUSTER      # build + kind-load the three images
  bash scripts/deploy.sh dev          # or: ha
EOF
