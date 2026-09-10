# syntax=docker/dockerfile:1
#
# Processing worker image (Node + FFmpeg). Multi-stage build like the backend, but the runtime also
# installs the FFmpeg toolchain (ffmpeg + ffprobe) used for transcoding and thumbnails.
#
# Build context is the REPO ROOT:
#   docker build -f processing/Dockerfile -t video-platform/processing:dev .

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY processing/package.json processing/
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY shared shared
COPY processing processing
RUN npm run build --workspace @video-platform/shared \
  && npm run build --workspace @video-platform/processing

RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# FFmpeg toolchain for the transcode/thumbnail steps (ffmpeg + ffprobe).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/processing/dist ./processing/dist
COPY --from=builder /app/processing/package.json ./processing/package.json
COPY --from=builder /app/package.json ./package.json

# Shared `/uploads` mount + backend GraphQL endpoint (overridable via the manifest env).
ENV UPLOADS_DIR=/uploads
ENV BACKEND_GRAPHQL_URL=http://backend:3000/graphql
ENV POLL_INTERVAL_MS=2000

USER node

CMD ["node", "processing/dist/index.js"]
