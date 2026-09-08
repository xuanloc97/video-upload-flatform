#!/usr/bin/env bash
set -euo pipefail
export HOME="/home/$(whoami)"
BIN_DIR="$HOME/.local/bin"

echo "ffmpeg:  $(command -v ffmpeg || echo MISSING)"
echo "ffprobe: $(command -v ffprobe || echo MISSING)"

case ":$PATH:" in
  *":$BIN_DIR:"*) echo "PATH: $BIN_DIR is on PATH" ;;
  *) echo "PATH: $BIN_DIR is NOT on PATH" ;;
esac
