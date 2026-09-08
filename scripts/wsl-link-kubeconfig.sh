#!/usr/bin/env bash
# One-off helper: link the WSL kubeconfig to the Windows kubeconfig so both
# stay in sync. From inside WSL, C:\Users\Admin\.kube\config lives at
# /mnt/c/Users/Admin/.kube/config.
# Run with: wsl -d Ubuntu-20.04 -- bash /mnt/d/PROJECTS/video-upload-flatform/scripts/wsl-link-kubeconfig.sh
set -euo pipefail

# Guard against Windows->WSL HOME leaking in as a Windows path (e.g. C:UsersAdmin).
export HOME="/home/$(whoami)"

WIN_KUBECONFIG="/mnt/c/Users/Admin/.kube/config"
WSL_KUBECONFIG="$HOME/.kube/config"

if [ ! -f "$WIN_KUBECONFIG" ]; then
  echo "ERROR: Windows kubeconfig not found at $WIN_KUBECONFIG" >&2
  echo "Create it on Windows first (e.g. via kubectl / Docker Desktop), then re-run." >&2
  exit 1
fi

mkdir -p "$HOME/.kube"

# Back up any existing real config so we don't clobber it silently.
if [ -f "$WSL_KUBECONFIG" ] && [ ! -L "$WSL_KUBECONFIG" ]; then
  backup="$WSL_KUBECONFIG.bak.$(date +%Y%m%d%H%M%S)"
  echo "Existing config found; backing it up to $backup"
  mv "$WSL_KUBECONFIG" "$backup"
fi

ln -sf "$WIN_KUBECONFIG" "$WSL_KUBECONFIG"

echo "Linked:"
ls -l "$WSL_KUBECONFIG"

if command -v kubectl >/dev/null 2>&1; then
  echo "Current context: $(kubectl config current-context 2>/dev/null || echo '<none>')"
else
  echo "Note: kubectl not found on PATH in WSL; the symlink is still in place."
fi
