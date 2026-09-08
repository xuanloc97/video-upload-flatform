#!/usr/bin/env bash
# Run the shared package Jest suite inside WSL with a generous timeout (the /mnt/d Windows
# filesystem is slow, so the default 5s per-test timeout is too tight here).
set -euo pipefail

export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

cd /mnt/d/PROJECTS/video-upload-flatform/shared
exec npx jest --runInBand --testTimeout=120000 "$@"
