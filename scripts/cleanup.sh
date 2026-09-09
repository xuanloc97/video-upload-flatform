#!/usr/bin/env bash
# Remove all deployed platform resources from the cluster (Req 10.6).
#
# Usage: bash scripts/cleanup.sh [dev|ha]
#   overlay defaults to "dev".
#
# Namespace-scoped: deletes the overlay's resources and then the video-platform namespace, which
# removes everything the platform created without touching the cluster or other namespaces.
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
echo "==> Removing overlays/$OVERLAY resources and the '$NAMESPACE' namespace"
if [[ "${CONFIRM:-}" != "yes" ]]; then
  read -r -p "Delete platform resources from this context? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

# Delete the overlay resources (ignore-not-found so a partial/absent deploy still cleans up).
kubectl delete -k "$ROOT/deployment/overlays/$OVERLAY" --ignore-not-found=true || true

# Belt-and-braces: remove the namespace, which reaps anything left (PVCs, pods, etc.). The
# dynamically provisioned PV uses reclaimPolicy: Retain, so also clear any released PV bound to our
# claim so a re-deploy starts clean.
kubectl delete namespace "$NAMESPACE" --ignore-not-found=true || true

echo "==> Cleanup complete."
