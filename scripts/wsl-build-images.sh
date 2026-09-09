#!/usr/bin/env bash
# Wrapper: run scripts/build.sh with kind + docker on PATH inside WSL.
set -euo pipefail
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"
exec bash /mnt/d/PROJECTS/video-upload-flatform/scripts/build.sh video-platform
