#!/usr/bin/env bash
# Build and run the full test suite: shared + backend + processing (npm workspaces) and the
# frontend (separate package). No cluster required — everything runs against the temp-dir Storage
# and temp-SQLite MetadataStore abstractions.
#
# Usage: bash scripts/test.sh
#
# Requires Node >= 18 (Node 20 recommended). If your default `node` is older, switch first, e.g.
#   nvm use 20
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 1; }
command -v npm  >/dev/null || { echo "npm not found on PATH" >&2; exit 1; }

# Enforce the engines.node >= 18 requirement up front with a clear message (the workspaces and
# better-sqlite3 prebuilds do not work on older Node).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  echo "Node >= 18 is required (found $(node -v)). Switch Node (e.g. 'nvm use 20') and retry." >&2
  exit 1
fi
echo "==> Using $(node -v)"

echo "==> Installing workspace dependencies (shared/backend/processing)"
npm install

echo "==> Building the Node workspaces"
npm run build

echo "==> Testing the Node workspaces (shared + backend + processing)"
npm test

echo "==> Installing frontend dependencies"
npm --prefix frontend install

echo "==> Building the frontend (tsc --noEmit + vite build)"
npm --prefix frontend run build

echo "==> Testing the frontend (vitest run)"
npm --prefix frontend test

echo "==> All test suites passed."
