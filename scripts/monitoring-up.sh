#!/usr/bin/env bash
# Deploy the monitoring stack (Prometheus + Grafana) into the current kube-context.
#
# Usage: bash scripts/monitoring-up.sh
#
# Independent of the app overlays: it applies deployment/monitoring into the `monitoring` namespace.
# Upstream images (prom/prometheus, grafana/grafana) are pulled by the kind node, so no build/load
# step is needed. Safe to re-run (kubectl apply is idempotent).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE="monitoring"

command -v kubectl >/dev/null || { echo "kubectl not found on PATH" >&2; exit 1; }

CONTEXT="$(kubectl config current-context)"
echo "==> Target kube-context: $CONTEXT"
echo "==> Applying deployment/monitoring (namespace: $NAMESPACE)"
if [[ "${CONFIRM:-}" != "yes" ]]; then
  read -r -p "Deploy the monitoring stack to this context? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

kubectl apply -k "$ROOT/deployment/monitoring"

echo "==> Waiting for Prometheus and Grafana to become available"
kubectl -n "$NAMESPACE" rollout status deploy/prometheus --timeout=180s || true
kubectl -n "$NAMESPACE" rollout status deploy/grafana --timeout=180s || true

cat <<EOF

==> Monitoring stack deployed.

Access (via the same ingress as the app):
  * Grafana:    http://localhost/grafana     (login: admin / admin — demo only)
                The "Video Upload Platform" dashboard is provisioned automatically.
  * Prometheus: http://localhost/prometheus

Fallback (no ingress):
  kubectl -n $NAMESPACE port-forward svc/grafana    3001:3000   # http://localhost:3001/grafana
  kubectl -n $NAMESPACE port-forward svc/prometheus 9090:9090   # http://localhost:9090/prometheus

Tear down with:
  kubectl delete -k deployment/monitoring
EOF
