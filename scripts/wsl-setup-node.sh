#!/usr/bin/env bash
# One-off helper: install Node 20 via nvm inside WSL, no sudo required.
# Run with: wsl -d Ubuntu-20.04 -- bash /mnt/d/PROJECTS/video-upload-flatform/scripts/wsl-setup-node.sh
set -euo pipefail

# Under Windows->WSL interop, $HOME can leak in as a Windows path (e.g. C:UsersAdmin).
# Force it back to the real Linux home so nvm installs to /home/<user>/.nvm.
export HOME="/home/$(whoami)"

export NVM_DIR="$HOME/.nvm"
# Remove any cache polluted by a previous bad-HOME run.
rm -rf "$NVM_DIR/.cache"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

nvm install 20
nvm alias default 20

echo "node: $(node -v)"
echo "npm:  $(npm -v)"
