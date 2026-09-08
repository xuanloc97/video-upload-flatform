#!/usr/bin/env bash
# Generate the committed Sample_Video used to demonstrate the end-to-end flow (Req 6.6).
#
# Produces a short, small, real MP4 (H.264 video + AAC audio, faststart) so it can be uploaded and
# transcoded by the platform. Deterministic inputs (lavfi testsrc + sine) keep it reproducible.
#
# Run with: bash scripts/generate-sample.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/samples/sample-video.mp4"

echo "Generating Sample_Video at $OUT ..."
ffmpeg \
  -f lavfi -i "testsrc=size=1280x720:rate=25:duration=3" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -c:a aac -shortest -movflags +faststart \
  -y "$OUT"

echo "Done:"
ffprobe -v error -show_entries stream=codec_type,width,height,duration \
  -of default=noprint_wrappers=1 "$OUT" || true
ls -l "$OUT"
