#!/usr/bin/env bash
# Run an npm command at the workspace root inside WSL with the nvm-managed Node.
# Usage: wsl -d Ubuntu-20.04 -- bash scripts/wsl-npm.sh install <pkg> --workspace <ws>
set -euo pipefail

export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

cd /mnt/d/PROJECTS/video-upload-flatform
exec npm "$@"
