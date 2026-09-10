# AI Usage Log

> **Living document.** This log is appended to continuously as the build progresses — not written
> once at the end. Every Human Verification Checkpoint (HVC #1–#12 in the design) feeds its result
> back into this file ("closing the loop"): when a check passes we record the command/observation and
> a human sign-off; when a check catches an AI mistake we record what was wrong, how it was found, and
> how it was fixed. Satisfies Requirement 14 (AI Usage Documentation) and assessment section 8.

## 1. AI tools used

| Tool / model | Where used |
| --- | --- |
| Kiro (agentic AI coding assistant, in-IDE) | All code generation, GraphQL schema, Kubernetes/Kustomize manifests, Dockerfiles, shell scripts, test scaffolding (Jest/Vitest + fast-check), and this documentation. Also drove the local verification runs (Node/FFmpeg/kind) and recorded the HVC results. |

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
  `/health/ready`. The live HA deploy plus HVC #3 (single-writer integrity under concurrent load)
  and HVC #6 (readiness under storage loss) were verified on kind — see section 6; the rolling-update
  / failover checks (Task 15, HVC #7) remain to be run against the same cluster.
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
- **Task 14:** `deployment/kind-cluster.yaml` and the live HA deploy on kind (backend ×2, frontend
  ×2, processing ×1) with HVC #3 and HVC #6 both verified — see sections 6 and 7.
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
- **Task 5 — Listing/status/metadata queries + file-serving route.** Verified `tsc --build` (exit 0)
  and the full backend Jest suite pass under Node 20: 8 suites / 40 tests, no regressions. Task 5
  coverage includes Properties 5, 6, 7, 8, 10 (listing/status/metadata via temp-dir Storage +
  temp-SQLite store) and Property 9 (referenced files retrievable, full + ranged) plus resolver-shape
  and file-route unit tests (full 200, ranged 206 with correct `Content-Range`, suffix/open-ended
  ranges, 416 unsatisfiable, 404 missing, and `../` path-traversal refused). The `/files/*` route
  streams with per-extension Content-Type, `Accept-Ranges: bytes`, and HTTP Range support for
  playback; `videoMetadata` returns rendition/thumbnail URLs only when COMPLETED (Req 4.5).
- **Tasks 5–12 — backend/processing/frontend suites.** After each task the relevant build and test
  suites were run locally. Final full-stack checkpoint (Task 12): `tsc --build` clean for the Node
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
- **Task 14 — live HA deploy on kind (Docker Desktop). DONE.** The HA stack was deployed on kind
  with Docker Desktop (~3.8 GB engine memory, enough for the single-node kind control plane + the
  HA stack). `scripts/build.sh`
  images loaded into the `kind-video-platform` cluster and `CONFIRM=yes scripts/deploy.sh ha`
  applied the HA overlay. Bringing the stack up surfaced three real backend-image defects that only
  manifest at container runtime (all fixed — see section 7): a missing nested `@nestjs/terminus`,
  the code-first schema write under a read-only root FS, and a missing `ffprobe`. After the fixes
  the stack ran clean: backend ×2, frontend ×2, processing ×1 all `Running`/`Ready`;
  `/health/live` → 200 (~18 ms) and `/health/ready` → 200 (~17 ms, `uploads` writable check `up`).
- **Task 14 — HVC #3 (SQLite single-writer safety under concurrent load). PASSED.** With 2 backend
  replicas behind `svc/backend` (per-connection load-balanced), drove 51 concurrent `uploadVideo`
  mutations (1 warm-up + a burst of 50 parallel multipart uploads of the committed Sample_Video) —
  all 51 returned an id, 0 errors — while the single processing worker concurrently `claimNext`ed
  and posted `updateProcessingResult` writes (all writes funnel through the backend, the sole writer
  of `metadata.db` on the shared RWX volume). Verification, opening `metadata.db` read-only with a
  second connection:
  * mid-load: `PRAGMA integrity_check` → `ok`, `PRAGMA foreign_key_check` → empty, `upload_records`
    total = distinct = 51.
  * at rest (after the worker drained the queue): `integrity_check` → `ok`, `foreign_key_check` →
    empty, `upload_records` total = distinct = 51, all 51 `COMPLETED`, 102 `renditions` rows across
    51 distinct uploads, `PRAGMA journal_mode` → `delete` (rollback journal, **not** WAL — the
    deliberate NFS-safety choice). No lost, duplicated, or corrupted records under concurrency.
    Confirms Req 2.2 and 3.2. Human sign-off recorded.
- **Task 14 — HVC #6 (readiness under storage loss). PASSED.** Simulated `/uploads` loss by scaling
  `deploy/nfs-provisioner` to 0 (the in-cluster NFS server). Observed:
  * The backend readiness endpoint returned **`503`** — the designed unhealthy response from the
    Terminus `uploads` indicator's bounded writable check — within kubelet's `timeoutSeconds: 3`
    (well under the 5 s budget, Req 5.3). As the stale mount fully hung, subsequent probes escalated
    to kubelet `context deadline exceeded` (still capped at 3 s), which also counts as a failure.
  * Both backend pods went **`0/1` NotReady** and `kubectl get endpoints backend` emptied — the pods
    were pulled from Service rotation (Req 5.2).
  * `/health/live` (no storage dependency) stayed 200 initially; under sustained NFS I/O stress it
    eventually also timed out, because a hung, uncancellable `fs` write on a stale NFS mount occupies
    a libuv threadpool slot (the app-level 2 s `Promise.race` timeout returns 503 but cannot reclaim
    the stuck native syscall). Noted as a real-world nuance of NFS hangs, not a readiness-logic
    defect; the readiness contract (unhealthy → out of rotation, fast) held.
  * Recovery + emptyDir durability confirmation: restarting the provisioner did **not** by itself
    restore service — the ganesha server is backed by `emptyDir`, so its restart wiped the export
    tree and lost the per-PV export registration (pods failed to mount with `reason given by server:
    No such file or directory`). This is exactly the documented ephemeral-storage limitation. Full
    recovery: scaled backend/processing to 0 to release the claim, deleted the stale `uploads-pvc`
    + PV, re-applied the `ha` overlay (the provisioner dynamically created a fresh PV, `Bound` RWX),
    and the rollouts completed — backend ×2 `Ready`, both back in `endpoints`, `/health/ready` → 200
    (~6 ms). Confirms Req 5.2 and 5.3. Human sign-off recorded. **CAUTION preserved:** all work
    stayed on the `kind-video-platform` context; the deploy script printed and confirmed the target
    context before applying.
- **Task 15 — HA & failover, incl. HVC #7 (rolling update / rollback). PASSED.** Ran against the
  live `ha` deployment (backend ×2, frontend ×2) with the Sample_Video already processed
  (720p + 480p + thumbnail, 29 263-byte thumbnail). An in-cluster load generator drove the backend
  Service (`POST /graphql { videos { id } }`, ~110 req/s) and logged an `ok`/`fail` tally while each
  event ran; full procedure and commands are in `docs/failover-test.md` (Req 13.3). Results:
  * **Backend replica loss:** deleting one backend pod caused **0 failed requests** (~1 800 during
    the window) — the surviving replica served and the pod was recreated (Req 11.3, 12.1).
  * **Frontend replica loss:** deleting one frontend pod — in-cluster `GET frontend:80` returned
    **ok=40 / fail=0** during replacement (Req 11.4).
  * **File durability:** recycling **both** backend pods left `renditions/<id>/{720p,480p}.mp4`,
    `thumbnails/<id>.jpg`, and the `COMPLETED` metadata intact; the thumbnail re-fetched over
    `/files` was byte-identical (29 263 bytes) — data lives on the shared NFS PV (Req 12.2, 12.3).
  * **HVC #7 rolling update:** `kubectl set env deploy/backend ROLLOUT_TEST=v2` triggered a new
    revision; with `maxUnavailable: 0` / `maxSurge: 1` the failure count did **not** increase during
    the rollout — zero request loss (Req 12.4).
  * **HVC #7 rollback:** `kubectl rollout undo deploy/backend` restored the previous revision (env
    reverted), again with **zero** new failures, and the backend kept serving (Req 12.5).
  * Over the whole run: **31 313 OK / 5 failed** requests. All 5 failures were a single sub-second
    `ECONNRESET` burst caused by intentionally deleting **both** backend pods at once (a harsher
    stress than failover); single-replica loss and the managed rollout/rollback had zero loss. This,
    and production hardening (PodDisruptionBudget, graceful drain, multi-node spread, durable shared
    storage), is documented honestly in `docs/failover-test.md`. Human sign-off recorded.
- **Task 18 — HVC #11 (clean-environment reproducibility via the Access_Endpoint). PASSED.** Starting
  from a fully clean state (`kind delete cluster --name video-platform`, no leftover node container),
  the README was followed exactly with no manual fix-ups:
  1. `bash scripts/cluster-up.sh` — created a fresh `video-platform` kind cluster (ingress-ready host
     ports 80/443 from `deployment/kind-cluster.yaml`) and installed the NGINX ingress controller;
     it reached Ready.
  2. `bash scripts/build.sh video-platform` — built and `kind load`ed all three images.
  3. `CONFIRM=yes bash scripts/deploy.sh ha` — rolled out backend ×2, frontend ×2, processing ×1,
     all Ready.
  Verification through the **ingress Access_Endpoint `http://localhost/`** (not a port-forward):
  frontend `GET /` → 200, `GET /health/ready` → 200 (`uploads up`), `POST /graphql { videos }` → 200
  (empty on the clean cluster). Uploaded `samples/sample-video.mp4` via the ingress `/graphql`
  multipart endpoint (id `de48d797-1e4b-4989-81df-3efe3497c71c`) and polled `videoStatus`
  PENDING → PROCESSING → COMPLETED. `videoMetadata` returned 720p (1280×720) + 480p (852×480) and a
  thumbnail; fetched over `/files`: thumbnail HTTP 200, 29 263 bytes, `image/jpeg`; 720p HTTP 200,
  72 195 bytes, `video/mp4`; 480p HTTP 200, 56 724 bytes, `video/mp4`; and a `Range: bytes=0-1023`
  request returned HTTP 206 (playback seek). Confirms Req 10.7, 13.1, 15.1, 15.2. Human sign-off
  recorded. Note: the earlier session's cluster (created before `kind-cluster.yaml` existed) lacked
  the host 80/443 port mappings, which is why the ingress Access_Endpoint only bound host port 80
  after this clean recreate; a fresh `cluster-up.sh` is the documented path and works end to end.
- **Task 8.9 — HVC #2 (FFmpeg rendition correctness). PASSED.** Ran the real `FfmpegTranscoder` +
  `ProcessingWorker` (compiled `dist`) against generated sources on the host (ffmpeg/ffprobe 9.0.1),
  then inspected the outputs with `ffprobe -show_entries stream=width,height`:
  * 4K source (3840×2160) → the full downscale-only ladder, ffprobe-confirmed: **2K 2560×1440,
    1080p 1920×1080, 720p 1280×720, 480p 852×480** — all even dimensions, 16:9 aspect preserved.
  * Small source (640×360) → **exactly one** rendition at the source's own 640×360 (labelled 480p by
    the fallback), i.e. no upscaling to any higher rung (Req 6.2).
  * Thumbnails are real frames: `ffprobe` reports `codec_name=mjpeg` at 3840×2160 and 640×360
    respectively (not blank placeholders). Confirms Req 6.2, 6.3. Human sign-off recorded.
- **Task 8.10 — HVC #5 (atomic tmp-then-rename). PASSED.** Ran the real worker on a longer 4K source
  as a killable process and `kill -9`'d it mid-transcode. Observed state at the kill:
  * `tmp/<id>/` held a partial `2k.mp4` (an in-progress rendition), while **`renditions/<id>/` and
    `thumbnails/<id>.jpg` did not exist** — no incomplete file ever appears under the final paths
    (the worker only `move`s into place after all transcodes complete). The original was intact.
  * Re-running the worker on the same id cleaned the stale `tmp/<id>/` partial and produced a full,
    correct set (2K/1080p/720p/480p at the right dimensions + a real thumbnail), with `tmp/<id>/`
    cleaned afterward. Confirms the atomic staging + idempotent recovery (Req 6.4, 7.3). Human
    sign-off recorded.
- **Task 8.11 — HVC #10 (property tests are meaningful). PASSED.** Reviewed each `fast-check`
  generator/assertion (planner: downscale-only + even-dims + unique-labels over random dimensions;
  worker Properties 13/14/15/18: complete output set, completeness⇒COMPLETED, failure⇒FAILED with no
  partial final output, retry idempotence). Then injected three known bugs and confirmed the relevant
  property/tests fail (and only those), restoring the source via `git checkout` after each:
  * Removed the success-path `tmp/<id>/` cleanup → **Property 13 and Property 18 failed** (tmp not
    cleaned); 14/15 stayed green.
  * Made the failure path report `COMPLETED` instead of `FAILED` → **Property 15 failed**; 13/14/18
    stayed green.
  * Removed the downscale-only guard in `planRenditions` (allow upscaling) → the planner's
    **"never upscales" property + the three downscale unit tests failed**; unrelated tests stayed
    green.
  After restoring, all suites are green again (12/12) with a clean `git status`. Confirms the
  property tests genuinely catch regressions. Human sign-off recorded.

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
  probe and the real-ffprobe 4K test self-skipped. Resolved by installing FFmpeg locally; after
  install the real-ffprobe 4K test runs for real and HVC #1 was performed. FFmpeg is also baked into
  the processing container image (Task 13.1) and, after Task 14, the backend image too.
- **Task 14 — cluster resource headroom.** A `kind` control plane plus the HA stack (backend ×2 +
  processing/FFmpeg + nfs-provisioner + ingress) needs a few GB of engine memory; it ran stably on
  Docker Desktop with ~3.8 GB. **CAUTION observed throughout:** all cluster work was confined to the
  local `kind-video-platform` context and the deploy/cleanup scripts print + confirm the target
  context before acting.
- **Task 14 — three backend-image defects that only surfaced at container runtime (caught by the
  live deploy, all fixed).** The unit/property tests and `kubectl kustomize` all passed, but the
  first `deploy.sh ha` exposed three issues that only appear when the compiled app runs inside the
  hardened container. Each was a genuine packaging/runtime gap, not a test artifact:
  1. **Missing `@nestjs/terminus` in the runtime image → `Cannot find module` crash-loop.** npm
     workspaces hoisted most deps to the root `node_modules`, but `@nestjs/terminus` was nested at
     `backend/node_modules/@nestjs/terminus` (npm placed it there to satisfy its dependency tree).
     The Dockerfile runtime stage only copied `/app/node_modules`, so the nested package was
     dropped. Fixed by also copying the workspace's own `node_modules`
     (`COPY --from=builder /app/backend/node_modules ./backend/node_modules`).
  2. **Code-first GraphQL schema write failed under `readOnlyRootFilesystem: true` → `EROFS:
     read-only file system, open '/app/schema.gql'`.** `GraphQLModule` was configured with
     `autoSchemaFile: join(process.cwd(), 'schema.gql')`, which writes into the (read-only) working
     dir on boot. Fixed by writing to a per-pod writable temp path
     (`join(os.tmpdir(), 'video-platform-schema.gql')`) and mounting an `emptyDir` at `/tmp` in the
     backend Deployment — preserving the read-only-root security posture (Req 10.5).
  3. **Missing `ffprobe` in the backend image → every upload rejected with `spawn ffprobe
     ENOENT`.** The upload path validates MP4s with magic-bytes + `ffprobe`, but only the processing
     image installed the FFmpeg toolchain. Fixed by adding `apt-get install -y --no-install-recommends
     ffmpeg` (which ships `ffprobe`) to the backend runtime stage, mirroring the processing image.
  These are exactly the kind of gaps HVC #3 is meant to catch by exercising the real deployed
  artifacts rather than only the source tree.
- **Test resilience on slow filesystems.** On slower disks the default 5 s per-test timeout was too
  tight, so per-test timeouts were raised for Jest (`--testTimeout`) and Vitest (`testTimeout` in
  config); two tests that flaked purely on that slowness (a health-indicator writable probe and a
  frontend detail query) were made resilient without weakening production behavior.
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
  HVC #8/#9 (manifest + script review), and — now completed on macOS/Docker Desktop — the live HA
  deploy on kind with **HVC #3** (SQLite single-writer integrity under 51 concurrent uploads:
  `integrity_check ok`, 51/51 distinct records, all COMPLETED) and **HVC #6** (readiness reports
  unhealthy and the pods leave Service rotation when `/uploads` is lost, within the <5 s budget).
  Builds are clean across all packages and the frontend. The live deploy also caught and fixed three
  real backend container-image defects (section 7).
- **Also verified live (Task 15):** multi-replica failover (backend and frontend replica loss with
  zero request loss), file durability across backend pod recycling, and HVC #7 (zero-downtime
  rolling update + rollback) — see the Task 15 entry in section 6 and `docs/failover-test.md`.
- **Also verified live (Task 18 — HVC #11):** from a fully clean environment, following the README
  exactly (`cluster-up.sh` → `build.sh` → `deploy.sh ha`) reproduced the platform, and the
  Sample_Video uploaded through the ingress Access_Endpoint (`http://localhost/`) processed to
  COMPLETED with both renditions and the thumbnail served over `/files` (incl. HTTP 206 range
  requests). See the Task 18 entry in section 6.
- **All Human Verification Checkpoints are complete:** HVC #1–#12 have been performed and recorded
  in section 6 (including the processing-worker checkpoints HVC #2/#5/#10 from spec tasks 8.9–8.11).
- **Safety note:** the machine's default kube-context is a production AWS EKS cluster. All Kubernetes
  work was confined to the local `kind-video-platform` context, and the `deploy.sh`/`cleanup.sh`
  scripts print and confirm the target context before acting (and are namespace-scoped).

This log is intended to be an accurate, non-inflated record: where a check passed it says so with
the command/observation; where a check could not be completed it says so and why.

## 9. Post-spec maintenance

- **Test layout refactor — tests moved from `src/` to a per-package `test/` tree.** At the reviewer's
  request the co-located `*.test.ts(x)` files (and the test-only `*.test-helpers.ts`) were relocated
  out of each package's `src/` into a dedicated `test/` directory mirroring `src/`
  (`shared/test`, `backend/test/{files,health,upload}`, `processing/test`, `frontend/test`). Config
  changes: each Node package gained a `tsconfig.test.json` (extends the package tsconfig, `rootDir: "."`,
  `noEmit`, includes `src` + `test`) that `ts-jest` uses, and its `jest.config.js` now sets
  `roots: ['<rootDir>/test']`; the production `tsconfig.json` `include` was reverted to `src/**/*.ts`
  so `tsc --build` still emits only application code. The frontend's `vite.config.ts` points
  `test.include`/`setupFiles` at `test/`, and its `tsconfig.json` includes both `src` and `test`.
  Fixes the automated file-move missed (recorded honestly): dynamic `require('./upload.service')`
  strings in the backend upload helper, the processing helper's own source imports and two tests'
  helper import, and the frontend `.tsx` relative imports — all corrected by hand. Stray compiled
  `.js/.d.ts` artifacts that briefly landed in `shared/test` during a first build (when the move tool
  had auto-added test files to the production `tsconfig` `include`) were deleted, and the `include`
  was corrected so they do not regenerate. Verified via `scripts/test.sh`: shared 29, backend 40,
  processing 14, frontend 6 — all green, builds clean, no test files remain under any `src/`.
