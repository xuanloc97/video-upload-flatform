#!/usr/bin/env bash
# Install workspace dependencies inside WSL using the nvm-managed Node.
# Run with: wsl -d Ubuntu-20.04 -- bash /mnt/d/PROJECTS/video-upload-flatform/scripts/wsl-npm-install.sh
set -euo pipefail

# Guard against Windows->WSL HOME leaking in as a Windows path.
export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

cd /mnt/d/PROJECTS/video-upload-flatform

echo "node: $(node -v)  npm: $(npm -v)"
echo "Installing workspace dependencies (this compiles better-sqlite3 natively)..."
npm install
