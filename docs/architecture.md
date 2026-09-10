# Architecture

This document describes how the Video Upload Platform is put together: its components, how data
flows through them, the storage and processing designs, how failures are handled, and the main
trade-offs and limitations. It is deliberately explicit about *why* the shared-storage approach was
chosen, how it behaves during failover, and where its reliability limits are.

## Overview

The platform is four cooperating pieces on a local Kubernetes cluster:

```
                       ┌─────────────────────────── kind cluster ───────────────────────────┐
   User ──HTTP──▶ NGINX Ingress ──/──▶ Frontend (React SPA, NGINX, ≥1 replica)               │
                        │                                                                    │
                        ├─ /graphql ─┐                                                       │
                        ├─ /health  ─┼──▶ Backend (NestJS + Apollo, ≥1 replica) ──┐          │
                        └─ /files   ─┘        │  owns metadata.db (single writer)  │          │
                                              │                                    ▼          │
                Processing worker ◀── internal GraphQL ── (claimNext / result)  Shared NFS    │
                (Node + FFmpeg, 1 replica) ───────────── reads/writes ─────────▶  /uploads    │
                                                                                (RWX PVC)     │
                       └───────────────────────────────────────────────────────────────────┘
```

- The **frontend** talks to the **backend** exclusively over GraphQL; binary file fetches
  (thumbnails, rendition playback) use backend `/files/...` URLs returned in metadata.
- The **backend** is the single writer of the SQLite metadata database on the shared volume.
- The **processing worker** never opens the database; it claims work and reports results *through*
  the backend, preserving the single-writer invariant.
- **Shared NFS storage** (`ReadWriteMany`) is mounted at `/uploads` by both backend and worker and
  holds originals, generated renditions/thumbnails, and `metadata.db`.

## Components

### Frontend (React SPA)
React + TypeScript built with Vite, served as static assets by NGINX. Uses Apollo Client with
`apollo-upload-client` for the multipart `uploadVideo` mutation. Three concerns: an upload view
(file picker + success/error banner), a list view (filename, upload time, live status badge, polled
every 3 s), and a detail view (thumbnail + HTML5 `<video>` player with selectable rendition sources)
for `COMPLETED` records. All API access is GraphQL; the SPA is stateless and horizontally scalable.

### Backend (NestJS + Apollo Server)
Code-first GraphQL API:
- `uploadVideo(file)` streams the multipart file straight to `originals/<id>.mp4` (never buffering a
  4K file in memory), validates it as MP4 (ftyp magic bytes + `ffprobe` container/stream check),
  and — only on success — creates a `PENDING` record.
- `videos`, `videoStatus(id)`, `videoMetadata(id)` for listing/status/metadata (metadata withholds
  rendition/thumbnail references until `COMPLETED`).
- Internal `claimNext`, `updateProcessingResult`, `retryProcessing` for the worker and manual retry.
- A REST-style `/files/...` route streams renditions/thumbnails from `/uploads` with correct
  content types and HTTP range support (so the `<video>` element can seek).
- `@nestjs/terminus` health at `/health/live` (liveness, no dependencies) and `/health/ready`
  (readiness; performs a real write/delete probe under `/uploads` so a pod that has lost storage
  leaves rotation).

The backend is stateless (all durable state is on the shared volume) and runs with multiple replicas
in the `ha` overlay.

### Processing worker (Node + FFmpeg)
A single-replica poll loop: `claimNext` atomically moves one `PENDING` record to `PROCESSING`; the
worker probes the source dimensions, plans the downscale-only rendition set, transcodes each
rendition and extracts a thumbnail into a private `tmp/<id>/` staging dir, then atomically moves the
completed set into `renditions/<id>/` and `thumbnails/<id>.jpg` and calls
`updateProcessingResult(COMPLETED, refs)`. Any error calls `updateProcessingResult(FAILED, error)`
and leaves the original intact.

### Shared storage (NFS)
A `ReadWriteMany` PVC (`uploads-pvc`) provisioned by an in-cluster nfs-ganesha provisioner, mounted
at `/uploads` by backend and worker. Layout:

```
/uploads/
  metadata.db                     # SQLite (backend-owned)
  originals/<id>.mp4
  renditions/<id>/{2k,1080p,720p,480p}.mp4
  thumbnails/<id>.jpg
  tmp/<id>/                       # in-progress worker output, atomically moved on success
```

## Data flow

1. **Upload.** Browser → GraphQL `uploadVideo` (multipart). Backend streams bytes to
   `originals/<id>.mp4`, validates, creates a `PENDING` record, returns the id.
2. **Claim.** Worker polls `claimNext`; the backend atomically flips the oldest `PENDING` row to
   `PROCESSING` (guarded `UPDATE ... WHERE status='PENDING'`) and returns it.
3. **Transcode.** Worker reads the original, produces renditions + thumbnail into `tmp/<id>/`, then
   atomically renames them into their final paths.
4. **Report.** Worker calls `updateProcessingResult(COMPLETED, refs)`; the backend records the
   renditions + thumbnail and sets `COMPLETED` (or `FAILED` on error).
5. **View.** Frontend polls `videos`; for a `COMPLETED` row it queries `videoMetadata` and renders
   the thumbnail + rendition players using backend `/files/...` URLs.

## Storage design — why shared NFS, how it works, failover, limits

**Why chosen.** The core requirement is that the backend (potentially multiple replicas) and the
processing worker read/write the *same* files, and that those files survive pod restarts/failover.
That demands a `ReadWriteMany` volume. Most local storage classes (`hostPath`, default kind SC) are
`ReadWriteOnce`. Options considered:
- *`ReadWriteOnce` PV* — cannot be mounted by backend and worker simultaneously. Rejected.
- *Object storage (MinIO/S3)* — great for production, but adds an object-store API and rewrites the
  file-path model just for a local demo. Rejected for scope.
- *Managed RWX (EFS/Filestore)* — paid cloud, not local. Rejected for the demo.
- *NFS `RWX` PV/PVC (chosen)* — local, free, genuinely `ReadWriteMany`, and survives consumer-pod
  deletion.

**Metadata single-writer model.** SQLite lives on the same NFS volume, but *only the backend writes
it*. The worker reports results through the backend. Multiple backend replicas serialize their
writes through a `BEGIN IMMEDIATE` transaction with `busy_timeout` and an outer retry-on-`SQLITE_BUSY`
loop; WAL is intentionally **not** used because it is unsafe on NFS (the default rollback journal is
kept). This gives transactional status updates while avoiding the classic "multiple SQLite writers
over NFS" corruption hazard.

**Failover behavior.** Because originals, renditions, thumbnails, and `metadata.db` all live on the
shared volume, deleting/recreating a backend or worker pod does not lose data — a new pod mounts the
same PVC and sees the same files and records. The stateless backend/frontend tiers run ≥2 replicas
in the `ha` overlay, so terminating one replica leaves the Service serving from the others.

**Reliability limits (honest).** On a single-node `kind` cluster the NFS provisioner's backing
directory is an `emptyDir`, so exported data survives *consumer* pod restarts (what the durability
requirement needs) but **not** a restart of the NFS-provisioner pod itself, and there is no
node-level HA. SQLite-over-NFS is fine for this low-concurrency demo but is not suitable for high
write concurrency or many backend replicas hammering writes — effectively one writer at a time.

## Video processing design

- **Downscale-only ladder.** Targets 2K (1440p) / 1080p / 720p / 480p by height; only rungs at or
  below the source height are produced (a 720p source yields 720p + 480p; a 480p source yields only
  480p). Aspect ratio is preserved and dimensions forced even (yuv420p). Sources smaller than every
  rung still get one rendition at their own resolution so there is always a playable output.
- **Atomic tmp-then-rename.** All outputs are written under `tmp/<id>/` and moved into final paths
  only after FFmpeg succeeds, so a partial/incomplete file is never visible at a final path. A
  retried run cleans `tmp/<id>/` first and reproduces an equivalent complete set (idempotent).
- **Injectable seams.** The transcoder (FFmpeg CLI) and the backend client (GraphQL) are interfaces,
  so the worker's job loop is property-tested against fast stubs; a separate integration test
  exercises the real FFmpeg path, and an end-to-end test runs the committed Sample_Video through the
  full pipeline.

## Failure handling

- **Invalid upload** → rejected before any record/file persists; descriptive GraphQL error.
- **Transcode failure** → `FAILED` with an error message; original left intact; no partial output.
- **Worker pod dies mid-job** → the record is stuck in `PROCESSING`; a stuck-job recovery resets
  records older than a timeout back to `PENDING` so they are re-claimed (outputs are re-derived
  cleanly thanks to tmp-then-rename).
- **Manual retry** → `retryProcessing(id)` resets a `FAILED` record to `PENDING`.
- **Storage unreachable** → `/health/ready` fails its writable probe, so Kubernetes pulls the pod
  from rotation until storage returns.
- **Backend rollout** → `ha` uses `RollingUpdate` with `maxUnavailable: 0` + readiness gating for
  zero-downtime updates; `kubectl rollout undo` rolls back.

## Trade-offs and limitations

- **SQLite on NFS** keeps the stack dependency-free and durable on shared storage, at the cost of
  low write throughput and a single-writer constraint. Production would use Postgres.
- **DB-as-queue** (the `status` column is the queue) needs no broker and is recoverable on shared
  storage, at the cost of polling latency and no built-in backoff/priorities/dead-letter.
- **Single-replica worker** — the single-writer queue means extra workers add contention, not
  throughput; correctness across restarts comes from atomic claim + stuck-job recovery, not
  replicas. It is a throughput single point of failure (not a durability one).
- **Local-only NFS** — no node-level HA, provisioner-pod restart is not survived; media is served
  through the backend file route rather than a CDN.

How these change for production is covered in [`production-notes.md`](production-notes.md).
