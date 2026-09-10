#!/usr/bin/env bash
# Deploy the platform to the current kube-context by applying the chosen Kustomize overlay.
#
# Usage: bash scripts/deploy.sh [dev|ha]
#   overlay defaults to "dev".
#
# Safety: prints the target kube-context and requires confirmation unless CONFIRM=yes is set, so a
# stray context (e.g. a real cluster) is never deployed to by accident.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="${1:-dev}"
NAMESPACE="video-platform"

case "$OVERLAY" in
  dev|ha) ;;
  *) echo "Unknown overlay '$OVERLAY' (expected 'dev' or 'ha')" >&2; exit 1 ;;
esac

command -v kubectl >/dev/null || { echo "kubectl not found on PATH" >&2; exit 1; }

CONTEXT="$(kubectl config current-context)"
echo "==> Target kube-context: $CONTEXT"
echo "==> Overlay: $OVERLAY   Namespace: $NAMESPACE"
if [[ "${CONFIRM:-}" != "yes" ]]; then
  read -r -p "Deploy to this context? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

echo "==> Applying overlays/$OVERLAY"
kubectl apply -k "$ROOT/deployment/overlays/$OVERLAY"

echo "==> Waiting for workloads to become available"
kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=180s || true
kubectl -n "$NAMESPACE" rollout status deploy/frontend --timeout=180s || true
kubectl -n "$NAMESPACE" rollout status deploy/processing --timeout=180s || true

cat <<EOF

==> Deployed.

Access the app:
  * If an NGINX ingress controller is installed and reachable, browse to http://localhost/
  * Fallback (no ingress): port-forward the frontend and backend, e.g.
      kubectl -n $NAMESPACE port-forward svc/frontend 8080:80
      kubectl -n $NAMESPACE port-forward svc/backend  3000:3000
    then open http://localhost:8080/ (the SPA calls /graphql, proxied in dev / via ingress in cluster).
EOF
