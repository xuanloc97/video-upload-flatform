#!/usr/bin/env bash
# Install a static FFmpeg (ffmpeg + ffprobe) into $HOME/.local/bin inside WSL, no sudo required.
# Uses John Van Sickle's static Linux x86_64 build (the de-facto standard static distribution).
# Run with: wsl -d Ubuntu-20.04 -- bash /mnt/d/PROJECTS/video-upload-flatform/scripts/wsl-install-ffmpeg.sh
set -euo pipefail

# Guard against Windows->WSL HOME leaking in as a Windows path.
export HOME="/home/$(whoami)"

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
echo "Downloading static FFmpeg from $URL ..."
curl -fsSL -o ffmpeg.tar.xz "$URL"

echo "Extracting ..."
tar -xf ffmpeg.tar.xz
DIR="$(find . -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' | head -n1)"

install -m 0755 "$DIR/ffmpeg"  "$BIN_DIR/ffmpeg"
install -m 0755 "$DIR/ffprobe" "$BIN_DIR/ffprobe"

echo "Installed:"
"$BIN_DIR/ffmpeg"  -version | head -n1
"$BIN_DIR/ffprobe" -version | head -n1
echo "Location: $BIN_DIR"
