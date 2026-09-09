# syntax=docker/dockerfile:1
#
# Backend image (NestJS + Apollo GraphQL). Multi-stage build:
#   1. builder — install ALL workspace deps and compile shared + backend to JS.
#   2. runtime — copy compiled output + a pruned production install, run as non-root.
#
# Build context is the REPO ROOT (so the npm workspaces — shared + backend — are available):
#   docker build -f backend/Dockerfile -t video-platform/backend:dev .

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 is a native addon; it compiles from source if no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install with the full workspace manifests so the shared package resolves.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY processing/package.json processing/
RUN npm ci

# Copy sources needed to build shared + backend, then compile.
COPY tsconfig.base.json tsconfig.json ./
COPY shared shared
COPY backend backend
RUN npm run build --workspace @video-platform/shared \
  && npm run build --workspace @video-platform/backend

# Prune to production dependencies only (drops dev tooling like typescript/jest).
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy the pruned node_modules (incl. compiled better-sqlite3) and built JS.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/package.json ./package.json

# Shared `/uploads` mount point (the PVC is mounted here by Kubernetes).
ENV UPLOADS_DIR=/uploads
ENV PORT=3000
EXPOSE 3000

# Run as the built-in non-root `node` user.
USER node

CMD ["node", "backend/dist/main.js"]
