# Production Notes

This document explains how the local demo design would change for a real production deployment:
larger workloads, high concurrency, long videos, and heavy transcoding traffic. The demo is
deliberately the smallest thing that delivers upload → store → transcode → view on a local cluster
with no paid services; the choices below are where that simplicity would be traded for scale,
durability, and operability.

## Scalability

**Demo:** stateless frontend and backend can run with N replicas behind their Services; the worker
is a single replica because the queue is single-writer SQLite. The kind cluster is **single-node**
(`deployment/kind-cluster.yaml`), so today's failover is pod-level only — a node failure takes
everything down, and replicas can only ever land on that one node.

**Production:**
- **Multi-node cluster across availability zones.** Run a real multi-node cluster (managed node
  pools spread over ≥2–3 AZs) so the platform tolerates node and zone failures, not just pod
  restarts. Spread replicas with `topologySpreadConstraints` / pod anti-affinity (one backend and
  one frontend replica per node/zone) and set PodDisruptionBudgets so rolling node upgrades never
  drain a whole tier at once. Use separate **node pools**: a general pool for the stateless tiers
  and a CPU/GPU-optimized pool for the transcoding workers (see Cloud deployment).
- **Backend** scales horizontally behind a load balancer. The scaling ceiling today is the SQLite
  single-writer model — remove it by moving metadata to a managed relational DB (see Storage), after
  which many backend replicas can write concurrently. Drive replica count with an HPA on
  CPU/latency.
- **Processing** becomes horizontally scalable once the queue supports safe concurrent claims
  (a real broker or a DB with `SELECT ... FOR UPDATE SKIP LOCKED`). Run a worker pool sized to
  transcode throughput, with an autoscaler keyed on queue depth (KEDA) rather than CPU alone, and
  let the **cluster autoscaler** add/remove nodes in the worker pool as that pool scales.
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

### Protecting sensitive configuration

**Demo:** configuration is intentionally in the clear for a single-tenant local cluster. The
monitoring stack ships Grafana credentials as plain env literals (`admin` / `admin` in
`deployment/monitoring/grafana.yaml`), Prometheus has no authentication at all, and both are exposed
through the ingress at `/grafana` and `/prometheus`. Application config (`UPLOADS_DIR`, `PORT`,
`BACKEND_GRAPHQL_URL`, poll interval) is non-secret and lives in Deployment env / ConfigMaps. No
Kubernetes `Secret` objects are used yet.

**Production:**
- **No secrets in manifests or images.** Move every credential (Grafana admin password, DB
  connection strings, object-store keys, JWT signing keys, TLS private keys) out of env literals and
  ConfigMaps into Kubernetes `Secret`s sourced from a real secret manager — External Secrets
  Operator / Vault / cloud KMS-backed secret stores — and inject via `envFrom`/`secretKeyRef` or
  mounted files. Never bake secrets into container images.
- **Keep secrets out of source control.** Enforce with pre-commit secret scanning (gitleaks) and CI
  scanning; if a secret must live in Git for GitOps, encrypt it (SOPS/sealed-secrets) rather than
  committing plaintext. Keep `.env`, keys, and credential files in `.gitignore`.
- **Least-privilege access to config.** Scope RBAC so only the workloads that need a secret can read
  it (per-namespace, per-ServiceAccount); avoid cluster-wide secret read. Tighten the Prometheus
  `ClusterRole` (currently broad read for scraping) and prefer the Prometheus Operator's scoped
  discovery where possible.
- **Rotation and encryption at rest.** Enable rotation for DB/object-store credentials and Grafana
  admin, turn on etcd encryption-at-rest for `Secret`s, and short-lived, auto-rotated tokens over
  long-lived static keys.
- **Lock down the ops surfaces.** Put Grafana behind SSO/OIDC (disable local `admin`), require auth
  and TLS in front of Prometheus (it exposes cluster internals), or keep both off the public ingress
  entirely (internal-only ingress / port-forward / VPN). Redact secret values from logs and error
  messages.

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

### Infrastructure as Code (Terraform)

**Demo:** the local cluster and its add-ons are created imperatively by shell scripts
(`scripts/cluster-up.sh` runs `kind create cluster` and installs the ingress controller). That is
fine for a laptop but is not reproducible, reviewable, or drift-controlled for real environments.

**Production:** manage all cloud infrastructure declaratively with **Terraform**, keeping a clear
split between *infrastructure* (Terraform) and *application* (Kustomize overlays, applied by GitOps):

- **Layout.** Reusable **modules** (`network`, `cluster`, `storage`, `database`, `dns_tls`,
  `iam`, `observability`) composed per environment. Separate the state per environment via
  workspaces or per-env root modules (`envs/dev`, `envs/staging`, `envs/ha`) so a `dev` change can
  never touch `prod`.
- **Resources Terraform owns:**
  - **Networking:** VPC, subnets, NAT, security groups.
  - **Managed Kubernetes:** the cluster + node pools (a general pool for stateless tiers and a
    CPU/GPU-optimized pool for the transcoding worker fan-out), with the cluster autoscaler.
  - **Object storage** for media (S3/GCS) with lifecycle/retention policies, plus the CDN.
  - **Managed Postgres** (RDS/Cloud SQL) for metadata, replacing SQLite-over-NFS — or a managed RWX
    filesystem (EFS/Filestore) if the POSIX path is kept.
  - **DNS + TLS certificates** (Route53/Cloud DNS + ACM/managed certs) and the ingress/LB.
  - **IAM / workload identity** (IRSA / GKE Workload Identity) so pods get scoped, keyless access to
    buckets and the database.
  - **Secrets** provisioned into a secret manager (see “Protecting sensitive configuration”), never
    hard-coded in `.tf` or committed state.
- **State & safety:** a **remote backend** with locking (S3 + DynamoDB / GCS) and encryption at
  rest; run `terraform plan` on PRs and `apply` only through CI on merge; enable **drift detection**
  and require plan review for production. Pin provider and module versions.
- **Boundary with the app:** Terraform stops at the cluster and its managed dependencies; it can
  bootstrap the GitOps controller (Argo CD/Flux), which then reconciles the same Kustomize overlays
  used locally. This keeps `scripts/*.sh` as the local-dev path and Terraform + GitOps as the
  cloud path, without duplicating application manifests.

A future `deployment/terraform/` (or a dedicated infra repo) would hold these modules and per-env
roots, mirroring how `deployment/overlays/` already separates `dev` from `ha` for the app layer.
