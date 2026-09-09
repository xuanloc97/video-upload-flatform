# syntax=docker/dockerfile:1
#
# Frontend image: build the React SPA with Vite, then serve the static assets with NGINX.
#
# The frontend is a self-contained package (not part of the Node workspaces), so the build context
# is the FRONTEND directory:
#   docker build -f frontend/Dockerfile -t video-platform/frontend:dev frontend

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime (NGINX static) ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# The unprivileged image runs as a non-root user and listens on 8080 by default.
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
