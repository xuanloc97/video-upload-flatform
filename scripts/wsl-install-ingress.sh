#!/usr/bin/env bash
# Install the NGINX ingress controller into the kind cluster and wait for it to be ready.
# Guards on the kube-context so it only ever runs against the local kind cluster.
set -euo pipefail
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"

CTX="$(kubectl config current-context)"
if [[ "$CTX" != "kind-video-platform" ]]; then
  echo "Refusing to run: current context is '$CTX', expected 'kind-video-platform'." >&2
  exit 1
fi

kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "Waiting for ingress-nginx controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=Ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s

kubectl -n ingress-nginx get pods
