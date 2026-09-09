# Production Notes

This document explains how the local demo design would change for a real production deployment:
larger workloads, high concurrency, long videos, and heavy transcoding traffic. The demo is
deliberately the smallest thing that delivers upload → store → transcode → view on a local cluster
with no paid services; the choices below are where that simplicity would be traded for scale,
durability, and operability.

## Scalability

**Demo:** stateless frontend and backend can run with N replicas behind their Services; the worker
is a single replica because the queue is single-writer SQLite.

**Production:**
- **Backend** scales horizontally behind a load balancer. The scaling ceiling today is the SQLite
  single-writer model — remove it by moving metadata to a managed relational DB (see Storage), after
  which many backend replicas can write concurrently.
- **Processing** becomes horizontally scalable once the queue supports safe concurrent claims
  (a real broker or a DB with `SELECT ... FOR UPDATE SKIP LOCKED`). Run a worker pool sized to
  transcode throughput, with an autoscaler keyed on queue depth (KEDA) rather than CPU alone.
- **Frontend** is static assets; put them behind a CDN and scale replicas to zero relevance.

## Large uploads

**Demo:** the backend streams multipart uploads straight to disk (no in-memory buffering), so even
4K files upload without blowing memory; the ingress allows unlimited body size.

**Production:**
- Prefer **direct-to-object-store uploads** via pre-signed URLs (S3/GCS), so large files never
  transit the API pods. The backend then only records metadata and kicks off processing.
- Support **resumable/multipart uploads** (tus or S3 multipart) for reliability over flaky networks.
- Enforce size/type/duration quotas and virus/type scanning at the edge.

## Long-running processing

**Demo:** a single worker transcodes synchronously per job; tmp-then-rename makes each job atomic
and retry-safe.

**Production:**
- Treat transcoding as a **fan-out job graph**: one job per rendition, run in parallel across a
  worker pool, optionally segment-based (split → transcode segments → stitch) for very long videos.
- Use **hardware acceleration** (NVENC/QSV/VAAPI) or a managed transcoding service (MediaConvert,
  Transcoder API) for cost/latency at scale.
- Add **progress reporting** and per-job **timeouts**; checkpoint long jobs so a killed pod resumes
  rather than restarts.

## Retry and failure handling

**Demo:** failures set `FAILED` with a message; stuck `PROCESSING` records recover to `PENDING` past
a timeout; `retryProcessing` is a manual reset.

**Production:**
- **Exponential backoff + max attempts**, then a **dead-letter queue** for jobs that keep failing,
  with alerting.
- Distinguish **transient** (retryable: storage blip, node eviction) from **permanent** (bad input)
  failures and route them differently.
- Make retries **idempotent** (already true here via tmp-then-rename) and safe under at-least-once
  delivery.

## Storage

**Demo:** one NFS `ReadWriteMany` volume holds originals, outputs, and `metadata.db`; the NFS
provisioner's backing store is an `emptyDir` (survives consumer-pod restarts, not the provisioner
pod; no node-level HA).

**Production:**
- **Media → object storage** (S3/GCS) with lifecycle policies (e.g. move originals to cold storage
  after processing) and a **CDN** for delivery instead of the backend file route.
- If POSIX semantics are genuinely needed, use a **managed RWX filesystem** (EFS/Filestore) that is
  itself HA and backed up — not a single in-cluster NFS pod.
- **Metadata → managed Postgres** (RDS/Cloud SQL) with a connection pool, replacing the
  single-writer SQLite-over-NFS design and its write-throughput ceiling. This is the single biggest
  change and unlocks backend and worker horizontal scaling.

## Security

**Demo:** trusted single-tenant, no auth, no TLS — appropriate only for a local evaluation.

**Production:**
- **AuthN/AuthZ** (OIDC/JWT), per-user ownership of uploads, and object-level access control on
  file URLs (pre-signed, expiring).
- **TLS everywhere** (ingress termination + internal mTLS), a WAF, and rate limiting on uploads.
- Containers already run **non-root with read-only root filesystems and dropped capabilities**;
  add image scanning, signed images, NetworkPolicies, and secrets from a vault (not env literals).
- Validate/transcode in a **sandboxed** worker (FFmpeg parses untrusted input); drop the network
  from worker pods where possible.

## Observability

**Demo:** health endpoints (`/health/live`, `/health/ready`) and container logs.

**Production:**
- **Metrics** (Prometheus): request rate/latency/errors, queue depth, job duration, failure rate,
  storage usage. Autoscale workers on queue depth.
- **Structured logs** shipped to a central store, correlated by upload id.
- **Distributed tracing** (OpenTelemetry) across upload → claim → transcode → complete.
- **Alerts** on readiness failures, growing `FAILED`/dead-letter counts, and storage pressure.

## Cost

- Object storage + CDN is far cheaper and more durable than serving media from API pods; use
  storage tiers and set retention.
- Transcoding dominates compute cost — use spot/preemptible workers for the fan-out pool, hardware
  encoders, and only produce renditions that are actually requested (or generate on-demand/ABR).
- Scale stateless tiers to demand; the frontend can be pure CDN with near-zero compute.

## CI/CD

**Demo:** build/test locally; `scripts/build.sh` builds images and `kind load`s them.

**Production:**
- Pipeline: lint → typecheck → unit/property tests → build images → scan → push to a registry →
  deploy via GitOps (Argo CD/Flux) with the same Kustomize overlays (`dev`/`staging`/`ha`).
- Pin/version images (already `:dev` locally; use immutable digests in prod), run DB migrations as
  a pre-deploy job, and gate promotion on smoke tests.
- Keep the property/integration tests in the pipeline — they encode the correctness properties
  (upload validation, atomic claim, output completeness, retry idempotence).

## Cloud deployment

The Kustomize layout ports directly to a managed cluster (EKS/GKE/AKS): swap the in-cluster NFS
provisioner for a managed RWX filesystem *or* (preferably) the object-storage model, point the
backend at managed Postgres, replace the local ingress with a cloud ingress/LB + TLS, and add an
autoscaler. The application code is unchanged apart from the storage/metadata adapters, which are
already behind the `Storage` and `MetadataStore` interfaces in `shared/` — the seams that make this
migration a configuration-and-adapter change rather than a rewrite.
