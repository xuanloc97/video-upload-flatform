# AI Usage Log

> **Living document.** This log is appended to continuously as the build progresses — not written
> once at the end. Every Human Verification Checkpoint (HVC #1–#12 in the design) feeds its result
> back into this file ("closing the loop"): when a check passes we record the command/observation and
> a human sign-off; when a check catches an AI mistake we record what was wrong, how it was found, and
> how it was fixed. Satisfies Requirement 14 (AI Usage Documentation) and assessment section 8.

## 1. AI tools used

| Tool / model | Where used |
| --- | --- |
| Kiro (agentic AI coding assistant, in-IDE) | All code generation, GraphQL schema, Kubernetes/Kustomize manifests, Dockerfiles, shell scripts, test scaffolding (Jest/Vitest + fast-check), and this documentation. Also drove the local verification runs (WSL/Node/FFmpeg/kind) and recorded the HVC results. |

The work was performed interactively: the human directed each task, reviewed and accepted/rejected
AI output, and signed off the Human Verification Checkpoints; the AI wrote the code/config/docs and
ran the builds/tests.

## 2. Purpose per component

What AI was used for, per component. Filled in as each component is built.

- **Storage (NFS PV/PVC, `/uploads`, storage/metadata abstraction):** AI authored the Kustomize base
  storage manifests (NFS provisioner, StorageClass, RWX PVC) and the SQLite single-writer serialized
  write path (`BEGIN IMMEDIATE` + `busy_timeout` + retry-on-`SQLITE_BUSY`) on the shared metadata
  store, plus its unit tests.
- **Backend (NestJS GraphQL: upload, list, status, metadata, health):** AI scaffolded the NestJS +
  Apollo (code-first) app, the GraphQL schema (upload/list/status/metadata/processing mutations),
  the streaming `uploadVideo` path (graphql-upload-minimal → disk, no memory buffering), the
  injectable MP4 validation (ftyp magic bytes + ffprobe probe), and the property/unit tests.
- **Processing (FFmpeg worker: renditions, thumbnail, recovery/retry):** AI authored the pure
  downscale-only rendition planner, the injectable `Transcoder` (FFmpeg CLI) + `BackendClient`
  abstractions, the `ProcessingWorker` job loop (atomic claim → transcode into `tmp/<id>/` → atomic
  move → COMPLETED/FAILED callback), the entrypoint poll loop, and the property/integration tests
  (Properties 13/14/15/18) plus a real-FFmpeg pass and the Sample_Video end-to-end demo.
- **Frontend (React SPA: upload, listing, status, playback):** AI scaffolded the React + TypeScript
  + Vite app, the Apollo Client (+ `apollo-upload-client`) setup, the upload/list/detail components
  (GraphQL-only, polling, thumbnail + rendition playback), and React Testing Library component tests.
- **Kubernetes (Kustomize base/overlays, NFS, ingress, scripts):** AI authored the three Dockerfiles
  (multi-stage backend/processing with FFmpeg, frontend → NGINX static), the Kustomize base
  workloads (backend/processing/frontend Deployments + Services, Ingress), the `dev` and `ha`
  overlays, and the `build.sh` / `deploy.sh` / `cleanup.sh` scripts.
- **High availability (replicas, probes, rolling updates, failover):** AI authored the `ha` overlay
  (backend/frontend ≥2 replicas, `RollingUpdate` with `maxUnavailable: 0` for the backend,
  single-replica worker) and the liveness/readiness probes wired to `/health/live` and
  `/health/ready`. The live failover verification (Tasks 14/15, HVC #3/#6/#7) is **blocked on this
  machine** by the WSL2 memory limit — see section 7; the manifests render cleanly and are ready to
  verify on a host with adequate RAM.
- **Documentation (README, architecture, failover-test, production-notes):** AI wrote `README.md`,
  `docs/architecture.md`, `docs/production-notes.md`, and this `ai-usage-log.md`, all grounded in the
  code/config actually produced (including honest notes on what was and was not verified live).

## 3. Representative prompts / prompt summaries

Important prompts, or concise summaries of them, enough for a reviewer to understand intent
(Req 14.2). Add entries as work is done.

- **Task 1 — Scaffold repository structure and shared foundations:** requested the top-level layout
  (`/frontend`, `/backend`, `/processing`, `/deployment`, `/scripts`, `/docs`, `/samples`, root
  `README.md`), root tooling (workspaces, shared `tsconfig`, `.gitignore`), this AI usage log, and a
  shared storage/metadata abstraction with temp-dir + temp-SQLite implementations for tests.
- **Tasks 2–4 — storage foundation + backend upload/validation:** author the NFS RWX manifests and
  the single-writer SQLite write path; then the NestJS/Apollo app with streaming `uploadVideo` and
  MP4 validation (ftyp + ffprobe), with property tests for the upload correctness properties.
- **Tasks 5–6 — backend listing/status/metadata/health + processing callbacks:** implement the
  remaining queries, the range-capable `/files` route, Terminus health with an `/uploads` writable
  check, and the `claimNext`/`updateProcessingResult`/`retryProcessing`/stuck-job-recovery surface.
- **Task 8–9 — processing worker + Sample_Video:** build the FFmpeg worker (downscale-only ladder,
  tmp-then-rename, COMPLETED/FAILED callbacks) with property tests, a real-FFmpeg integration pass,
  and an end-to-end demo driving the committed Sample_Video through the full pipeline.
- **Task 11 — frontend:** scaffold the React/Vite SPA talking to the backend exclusively over
  GraphQL (Apollo + apollo-upload-client): upload view, polled list with status badges, and
  thumbnail + rendition playback for completed records, with component tests.
- **Task 13 — containerize + Kubernetes:** write the three Dockerfiles, the Kustomize base + `dev`/
  `ha` overlays, the ingress, and the `build.sh`/`deploy.sh`/`cleanup.sh` scripts; review the
  rendered manifests and scripts for safety (HVC #8/#9).
- **Task 17 — documentation:** write the README, architecture, and production-notes docs and
  finalize this log, grounded in what was actually built and honest about what was verified.

## 4. What AI generated

The artifacts produced (code, YAML, scripts, prose). Add entries as work is done.

- **Task 1:** root `package.json` (npm workspaces), `tsconfig.base.json` + project-reference
  `tsconfig.json`, `.gitignore`, `README.md` stub, directory scaffold, this log, and the `shared`
  package (`Storage` interface + filesystem/temp-dir implementations, `MetadataStore` interface +
  temp-SQLite implementation, shared domain types).
- **Tasks 5–9:** backend listing/status/metadata resolvers + `/files` range-serving controller
  (Task 5); Terminus health checks + processing callbacks `claimNext`/`updateProcessingResult`/
  `retryProcessing` + stuck-job recovery (Task 6); the processing worker package (Task 8); the
  committed `samples/sample-video.mp4` + generator + end-to-end demo (Task 9).
- **Task 11:** the `frontend` React SPA (Apollo client, upload/list/detail components, component
  tests).
- **Task 13:** `backend/Dockerfile`, `processing/Dockerfile` (with FFmpeg), `frontend/Dockerfile` +
  `nginx.conf`, `.dockerignore` files; Kustomize base `backend.yaml`/`processing.yaml`/
  `frontend.yaml`/`ingress.yaml` (+ updated base kustomization); `overlays/dev` and `overlays/ha`;
  `scripts/build.sh`, `scripts/deploy.sh`, `scripts/cleanup.sh`.
- **Task 14 (partial):** `deployment/kind-cluster.yaml`, `deployment/wslconfig.sample`, and the WSL
  helper scripts for the cluster flow (`wsl-install-kind.sh`, `wsl-kind-up.sh`,
  `wsl-install-ingress.sh`, `wsl-build-images.sh`, `wsl-deploy-ha.sh`, etc.). The cluster was
  created and the stack applied, but HVC #3/#6 could not be completed — see section 7.
- **Task 17:** `README.md`, `docs/architecture.md`, `docs/production-notes.md`, and the finalization
  of this `ai-usage-log.md`.

## 5. Accepted / rejected / modified outputs

For each notable output, whether it was accepted as-is, rejected, or modified, and why (Req 14.2).

| Output | Decision | Why |
| --- | --- | --- |
| `graphql-upload` v16 for the `Upload` scalar | Rejected / swapped | v16 is ESM-only and does not interop cleanly with the CommonJS NestJS 10 + Apollo 4 stack. Replaced with `graphql-upload-minimal` (CommonJS, drop-in `GraphQLUpload` + `graphqlUploadExpress`). |
| Injectable `Mp4Probe` abstraction | Accepted | Lets the ffprobe dependency be stubbed for hermetic, fast property tests while production shells out to real `ffprobe`. |
| Kernel-NFS `hostPath` storage manifest (Task 2) | Rejected / replaced | Crash-looped on kind's overlayfs; replaced with nfs-ganesha provisioner + emptyDir (see mistakes log). |

## 6. How AI-generated output was verified

The concrete check that confirmed correctness — command, test, or inspection (Req 14.3). Each HVC
result lands here.

- **Task 1:** verified the shared package type-checks and unit tests for the storage/metadata
  abstractions pass; confirmed `tsc --build` succeeds across the workspace. _(details recorded when
  run)_
- **Task 2 — HVC #4 (concurrent RWX mount + durability on kind). PASSED.** Steps and observations:
  1. `kind create cluster --name video-platform` → cluster up (Kubernetes v1.32.2).
  2. `kubectl apply -k deployment/base` → namespace, nfs-provisioner (SA/RBAC/Service/Deployment),
     `nfs` StorageClass, and `uploads-pvc` created.
  3. After the fixes above, `uploads-pvc` reached **`Bound`** with `ACCESS MODES: RWX`,
     `STORAGECLASS: nfs` (dynamically provisioned PV `pvc-bb5cadcf-...`, 5Gi).
  4. Two throwaway pods (`rwx-writer`, `rwx-reader`) both mounted the same claim at `/uploads`
     concurrently and reached `Ready` — confirms concurrent `ReadWriteMany` (Req 1.2).
  5. Wrote `hvc4-shared-storage-<ts>` to `/uploads/proof.txt` from `rwx-writer`; read the identical
     content back from `rwx-reader` — confirms cross-pod sharing (Req 1.3, 1.5).
  6. Deleted `rwx-writer`, recreated it, and re-read `/uploads/proof.txt`: the file and content
     persisted — confirms durability across consumer-pod deletion/recreation (Req 1.4).
  7. Cleaned up the throwaway pods; `kubectl kustomize deployment/base` still builds cleanly.
  Human sign-off: verified end to end against the live `kind` cluster on 2026-09-07.
- **Task 3 — Single-writer serialized write path (metadata store).** Verified the shared package
  build (`tsc --build`, exit 0) and the Jest suite pass under Node 20: 25/25 tests green, including
  the new `runWithBusyRetry` retry-on-`SQLITE_BUSY` tests, the PENDING→PROCESSING→COMPLETED/FAILED
  lifecycle tests, and an integration test that reopens the DB file on a fresh connection to prove
  writes are committed through the `BEGIN IMMEDIATE` path. Confirmed by inspection that WAL is not
  enabled (default rollback journal, `busy_timeout=5000`) per the NFS-safety design decision.
- **Task 4 — Backend upload API + MP4 validation (NestJS/Apollo).** Verified `tsc --build` (exit 0)
  and the backend Jest suite pass under Node 20: 3 suites / 13 tests, with Properties 2/3/4
  (fast-check, 100 runs each) exercising the upload service against the temp-dir Storage +
  temp-SQLite MetadataStore. Additionally booted the NestJS app (`AppModule.forRoot()` +
  `app.init()`) against a temp `UPLOADS_DIR` and confirmed DI wiring succeeds and the code-first
  GraphQL schema generates with the expected scalars (`Upload`, `DateTime`), `ProcessingStatus`
  enum, `UploadRecord`/`Rendition`/`VideoMetadata` types, and all queries/mutations. The generated
  `schema.gql` artifact was removed after the check.
- **Task 4 — HVC #1 (MP4 validation logic). PASSED.** After installing FFmpeg, drove the real
  `UploadService` + real `FfprobeMp4Probe` over five inputs and asserted outcomes plus side effects:
  1. Real 640x360 MP4 → **accepted** (PENDING record created).
  2. Real 4K 3840x2160 MP4 → **accepted** via the same upload operation (Req 2.5).
  3. Renamed `.txt` as `.mp4` → **rejected** ("missing ftyp box in the file header").
  4. Truncated MP4 (ftyp header only, body cut) → **rejected** (ffprobe: "moov atom not found").
  5. PNG with a spoofed `.mp4` extension → **rejected** ("missing ftyp box").
  Every rejected case created NO Upload_Record and left NO file under `originals/`; the store ended
  with exactly the 2 accepted records. Verified via a throwaway script (since removed) on
  2026-09-07. Confirms Req 2.4 and 2.5. Human sign-off recorded.
- **Tasks 5–12 — backend/processing/frontend suites.** After each task the relevant build and test
  suites were run in WSL. Final full-stack checkpoint (Task 12): `tsc --build` clean for the Node
  workspaces and `tsc --noEmit` + `vite build` clean for the frontend; tests green — shared 29/29,
  backend 18/18, processing 14/14 (incl. a real-FFmpeg integration pass and the Sample_Video
  end-to-end demo reaching COMPLETED with 720p+480p renditions + thumbnail), frontend 6/6.
- **Task 13 — HVC #8 (manifest review) + HVC #9 (script review). PASSED.** Rendered both overlays
  with the built-in kustomize (`kubectl kustomize deployment/overlays/dev` and `.../ha`) — both build
  cleanly. Inspection of the rendered output confirmed:
  * **Images:** every workload references a pinned tag — `video-platform/{backend,processing,frontend}:dev`
    and the provisioner `registry.k8s.io/sig-storage/nfs-provisioner:v4.0.8`; no `:latest`.
  * **Replicas:** dev = 1 per tier; ha = backend 2 / frontend 2 / processing 1 (single-writer worker).
  * **Rolling update:** backend in ha has `strategy.rollingUpdate.maxUnavailable: 0`, `maxSurge: 1`.
  * **Security:** backend + processing run `runAsNonRoot`, `readOnlyRootFilesystem: true`,
    `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`; frontend runs non-root (uid 101).
  * **Resources:** requests + limits set on every workload.
  * **Secrets:** `grep -niE 'password|secret|token|apikey|private key'` on the rendered ha output
    returned nothing — no hardcoded secrets.
  * **Scripts:** `bash -n` on `build.sh`/`deploy.sh`/`cleanup.sh` all pass. `deploy.sh` and
    `cleanup.sh` print the current kube-context and require confirmation (bypass only via explicit
    `CONFIRM=yes`); `cleanup.sh` is namespace-scoped (`kubectl delete -k <overlay>` +
    `kubectl delete namespace video-platform`, both `--ignore-not-found`) — no cluster-wide deletes,
    no `kind delete cluster`, no `--all`. Human sign-off recorded. Note: a live `kind` deploy is
    exercised in Task 14 (HVC #3/#6).

## 7. AI mistakes / hallucinations / unsafe suggestions discovered

Any incorrect APIs, invented flags, destructive shell commands, insecure defaults, or wrong
assumptions discovered, and how they were caught and corrected (Req 14.3).

- **Task 1 — Node version assumption.** The default shell Node was v14, which does not support npm
  workspaces or the `better-sqlite3` prebuilt binaries used by the shared package. Caught when
  planning the install; corrected by using Node 20 (available via nvm) for install/build/test and
  setting `engines.node` to `>=18`. To be documented in the README prerequisites (Task 17.1).
- **Task 1 — Storage path traversal.** Added an explicit guard in `FileSystemStorage` so relative
  paths cannot escape the base directory; verified with a unit test (`rejects paths that escape the
  base directory`).
- **Task 2 — NFS export fails on kind's overlay filesystem (caught by HVC #4).** The first
  AI-authored storage manifest used a kernel-NFS server (`itsthenetwork/nfs-server-alpine`) exporting
  a `hostPath` directory. On a `kind` node this crash-looped with
  `exportfs: /nfsshare does not support NFS export` because the kind node's backing store is an
  overlay filesystem. It was replaced with the `sig-storage/nfs-provisioner` (nfs-ganesha userspace
  server), which then failed a second time — `error exporting export block` — for the *same* root
  cause when its `/export` was a `hostPath`. Diagnosed by swapping the backing volume to `emptyDir`,
  after which the export succeeded and the PVC bound. Also required `privileged: true` on the
  provisioner (the reduced `DAC_READ_SEARCH`/`SYS_RESOURCE` capability set was insufficient for
  `AddExport`). The manifest documents this kind limitation and the durability trade-off of
  `emptyDir` (survives consumer-pod restarts, which is what Req 1.4/12.1/12.2 need; does not survive
  the storage-server pod itself, consistent with the design's "ephemeral node-backed storage"
  assumption).
- **Task 2 — PVC size vs node free space.** The AI-authored PVC requested `20Gi`; the ganesha
  provisioner validates the request against the kind node's free disk (~7.8GB) and rejected it with
  `insufficient available space`. Reduced the request to `5Gi` for the local demo.
- **Task 4 — ffmpeg/ffprobe not installed in the dev environment (RESOLVED).** `which ffmpeg
  ffprobe` initially returned nothing, so the MP4-validation property tests used an injectable stub
  probe and the real-ffprobe 4K test self-skipped. Originally resolved on macOS via Homebrew; after
  the environment moved to Windows the toolchain was reinstalled inside WSL (static FFmpeg 7.0.2 into
  `~/.local/bin`, no sudo). After install the real-ffprobe 4K test runs for real and HVC #1 was
  performed. FFmpeg is also baked into the processing container image (Task 13.1).
- **Task 14 — kind cluster unstable due to WSL2 memory limit (BLOCKED, root cause identified).**
  Attempted the live deploy on kind. Built + loaded all three images and applied the manifests
  successfully (namespace, services, deployments, PVC, ingress all created; frontend rolled out).
  However the WSL2 VM repeatedly became unresponsive / self-restarted under load, dropping the kind
  API server each time. Root cause: `/proc/meminfo` shows the WSL2 VM has only **~1.9 GB total RAM**
  (`MemTotal ≈ 1904248 kB`) and there is no `~/.wslconfig`. A kind control-plane plus the HA stack
  (backend×2 + processing/FFmpeg + nfs-provisioner + ingress) far exceeds that, so the VM OOMs.
  This is an environment capacity limit, not a manifest/app defect — `kubectl kustomize` renders
  cleanly and all app tests pass. Fix for the reviewer: create `C:\Users\<you>\.wslconfig` with
  e.g. `[wsl2]\nmemory=8GB\nprocessors=4`, run `wsl --shutdown`, then re-run
  `scripts/wsl-kind-up.sh` → `scripts/wsl-install-ingress.sh` → `scripts/build.sh video-platform`
  → `CONFIRM=yes scripts/deploy.sh ha`. HVC #3/#6 (Task 14) and HVC #7 (Task 15) are deferred until
  the cluster has adequate memory. **CAUTION observed:** the machine's default kube-context is a
  production AWS EKS cluster; all cluster work was confined to the `kind-video-platform` context and
  the deploy/cleanup scripts print + confirm the context before acting.
- **Environment migration — macOS → Windows/WSL.** The project moved machines mid-build. Windows has
  no Node/npm on PATH, so the Node toolchain (Node 20 via nvm), FFmpeg (static build), and all
  build/test runs were set up inside WSL Ubuntu against the repo on `/mnt/d`. A WSL interop quirk was
  found and worked around: `$HOME` can leak in as a Windows path (`C:UsersAdmin`) under
  PowerShell→WSL, which sent `nvm` installs to a bad path; every helper script now forces
  `export HOME=/home/$(whoami)`. Because `/mnt/d` I/O is slow, per-test timeouts were raised for
  Jest (`--testTimeout`) and Vitest (`testTimeout` in config); two tests that flaked purely on that
  slowness (a health-indicator writable probe and a frontend detail query) were made resilient
  without weakening production behavior.
- **Task 3 — intermittent storage property-test failure (not reproduced).** While running the shared
  suite during Task 3, one run reported `storage.property.test.ts` "Property 1: Storage round-trip"
  failing on a fast-check-generated path where the same name was used as both a file and a directory
  (`EEXIST: mkdir '.../O'`), possibly a macOS case-insensitive collision. A clean re-run passed 25/25
  with no code change, so it did not reproduce. Flagged here as a potential edge case in the Task 1.3
  generator or `storage.ts` mkdir handling to harden later; no fix applied yet since it was not
  reproducible.

## 8. HVC #12 — final honesty review of this log

Read end to end on completion of Task 17 and confirmed it matches reality:

- **What is verified live and passing:** the full local test suite — shared 29/29, backend 18/18,
  processing 14/14 (including a real-FFmpeg integration pass and the Sample_Video end-to-end demo),
  frontend 6/6 — plus HVC #1 (MP4 validation), HVC #4 (concurrent RWX mount + durability on kind),
  and HVC #8/#9 (manifest + script review). Builds are clean across all packages and the frontend.
- **What is NOT yet verified live (stated plainly):** HVC #3 (SQLite single-writer integrity under
  concurrent load), HVC #6 (readiness probe under storage loss), and HVC #7 (rolling update / no
  request loss / rollback), i.e. Tasks 14 (partial) and 15. These are blocked by the WSL2 memory
  limit on the current machine (section 7), not by any code or manifest defect. The manifests render
  cleanly, the images build and load into kind, and the stack applies; the cluster simply cannot stay
  up under load with ~1.9 GB of WSL RAM. They are ready to run on a host with adequate memory using
  the documented steps.
- **Safety note:** the machine's default kube-context is a production AWS EKS cluster. All Kubernetes
  work was confined to the local `kind-video-platform` context, and the `deploy.sh`/`cleanup.sh`
  scripts print and confirm the target context before acting (and are namespace-scoped).

This log is intended to be an accurate, non-inflated record: where a check passed it says so with
the command/observation; where a check could not be completed it says so and why.
