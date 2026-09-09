#!/usr/bin/env bash
# Install `kind` (Kubernetes IN Docker) as a user-local binary in WSL, no sudo required.
# Run with: wsl -d Ubuntu-20.04 -- bash /mnt/d/PROJECTS/video-upload-flatform/scripts/wsl-install-kind.sh
set -euo pipefail

export HOME="/home/$(whoami)"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

KIND_VERSION="v0.23.0"
URL="https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"

echo "Downloading kind ${KIND_VERSION} ..."
curl -fsSL -o "$BIN_DIR/kind" "$URL"
chmod +x "$BIN_DIR/kind"

echo "Installed: $("$BIN_DIR/kind" version)"
echo "Location: $BIN_DIR/kind"
