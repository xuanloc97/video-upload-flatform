#!/usr/bin/env bash
# Run the full workspace test suite (shared + backend) inside WSL with a generous per-test timeout,
# since the /mnt/d Windows filesystem makes the default 5s timeout too tight.
set -euo pipefail

export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

ROOT=/mnt/d/PROJECTS/video-upload-flatform

echo "=================== shared ==================="
( cd "$ROOT/shared"  && npx jest --runInBand --testTimeout=180000 )

echo "=================== backend ==================="
( cd "$ROOT/backend" && npx jest --runInBand --testTimeout=180000 )

echo "=================== processing ==================="
( cd "$ROOT/processing" && npx jest --runInBand --testTimeout=180000 )

echo "=================== ALL SUITES PASSED ==================="
