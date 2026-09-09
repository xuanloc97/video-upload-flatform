#!/usr/bin/env bash
# Deploy the ha overlay to the local kind cluster, with an explicit context guard.
set -euo pipefail
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"

CTX="$(kubectl config current-context)"
if [[ "$CTX" != "kind-video-platform" ]]; then
  echo "Refusing to deploy: current context is '$CTX', expected 'kind-video-platform'." >&2
  exit 1
fi

CONFIRM=yes bash /mnt/d/PROJECTS/video-upload-flatform/scripts/deploy.sh ha
