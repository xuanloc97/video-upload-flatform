#!/usr/bin/env bash
# Run an npm script (or arbitrary command) inside WSL with the nvm-managed Node.
# Usage: wsl -d Ubuntu-20.04 -- bash scripts/wsl-run.sh <command...>
# Example: wsl ... bash scripts/wsl-run.sh npm run build
set -euo pipefail

export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

cd /mnt/d/PROJECTS/video-upload-flatform
exec "$@"
