#!/usr/bin/env bash
# Run an npm command in the frontend/ package inside WSL with the nvm-managed Node.
# Usage: wsl -d Ubuntu-20.04 -- bash scripts/wsl-frontend.sh install
#        wsl -d Ubuntu-20.04 -- bash scripts/wsl-frontend.sh run build
set -euo pipefail

export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

cd /mnt/d/PROJECTS/video-upload-flatform/frontend
exec npm "$@"
