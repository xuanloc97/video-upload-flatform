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

# Fire the overlay deletion without blocking on finalizers.
kubectl delete -k "$ROOT/deployment/overlays/$OVERLAY" --ignore-not-found=true --wait=false || true

# Pods that mount the shared NFS volume can hang on unmount once the NFS server is being torn down,
# which would otherwise stall namespace termination indefinitely. Force-delete them to unblock.
kubectl -n "$NAMESPACE" delete pods --all --grace-period=0 --force --ignore-not-found=true 2>/dev/null || true

# Remove the namespace (reaps anything left: PVCs, services, etc.). Bounded wait so a stuck
# finalizer can't hang cleanup — if it is still terminating we continue; it finishes in the background.
kubectl delete namespace "$NAMESPACE" --ignore-not-found=true --timeout=120s \
  || echo "    namespace still terminating; continuing (it finishes in the background)"

# The `nfs` StorageClass uses reclaimPolicy: Retain, so a dynamically provisioned PV can be left in
# state `Released` when its PVC/namespace goes away — it would otherwise accumulate across
# deploy/cleanup cycles. Delete any PV whose claimRef points at our namespace so a subsequent
# `deploy.sh` provisions a fresh, clean volume. `--wait=false` avoids blocking if the claim is still
# being finalized.
echo "==> Clearing retained PersistentVolumes for namespace '$NAMESPACE'"
PVS="$(kubectl get pv -o jsonpath="{range .items[?(@.spec.claimRef.namespace=='$NAMESPACE')]}{.metadata.name}{'\n'}{end}" 2>/dev/null || true)"
if [[ -n "${PVS// /}" ]]; then
  while IFS= read -r pv; do
    [[ -z "$pv" ]] && continue
    echo "    deleting PV $pv"
    kubectl delete pv "$pv" --ignore-not-found=true --wait=false || true
  done <<< "$PVS"
else
  echo "    (none found)"
fi

# Optional: tear down the whole local kind cluster too. Off by default so cleanup stays
# namespace-scoped; enable with DELETE_CLUSTER=yes (uses the cluster name from kind-cluster.yaml).
if [[ "${DELETE_CLUSTER:-}" == "yes" ]]; then
  if command -v kind >/dev/null; then
    echo "==> Deleting kind cluster 'video-platform' (DELETE_CLUSTER=yes)"
    kind delete cluster --name video-platform || true
  else
    echo "==> DELETE_CLUSTER=yes but 'kind' is not on PATH; skipping cluster deletion" >&2
  fi
fi

echo "==> Cleanup complete."
