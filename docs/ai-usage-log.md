# AI Usage Log

> **Living document.** This log is appended to continuously as the build progresses — not written
> once at the end. Every Human Verification Checkpoint (HVC #1–#12 in the design) feeds its result
> back into this file ("closing the loop"): when a check passes we record the command/observation and
> a human sign-off; when a check catches an AI mistake we record what was wrong, how it was found, and
> how it was fixed. Satisfies Requirement 14 (AI Usage Documentation) and assessment section 8.

## 1. AI tools used

| Tool / model | Where used |
| --- | --- |
| _TBD_ | Code generation, manifest authoring, test scaffolding, documentation |

_List each AI assistant/model and the surfaces it was used on. Update as tools are added._

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
- **Processing (FFmpeg worker: renditions, thumbnail, recovery/retry):** _TBD_
- **Frontend (React SPA: upload, listing, status, playback):** _TBD_
- **Kubernetes (Kustomize base/overlays, NFS, ingress, scripts):** _TBD_
- **High availability (replicas, probes, rolling updates, failover):** _TBD_
- **Documentation (README, architecture, failover-test, production-notes):** _TBD_

## 3. Representative prompts / prompt summaries

Important prompts, or concise summaries of them, enough for a reviewer to understand intent
(Req 14.2). Add entries as work is done.

- **Task 1 — Scaffold repository structure and shared foundations:** requested the top-level layout
  (`/frontend`, `/backend`, `/processing`, `/deployment`, `/scripts`, `/docs`, `/samples`, root
  `README.md`), root tooling (workspaces, shared `tsconfig`, `.gitignore`), this AI usage log, and a
  shared storage/metadata abstraction with temp-dir + temp-SQLite implementations for tests.

## 4. What AI generated

The artifacts produced (code, YAML, scripts, prose). Add entries as work is done.

- **Task 1:** root `package.json` (npm workspaces), `tsconfig.base.json` + project-reference
  `tsconfig.json`, `.gitignore`, `README.md` stub, directory scaffold, this log, and the `shared`
  package (`Storage` interface + filesystem/temp-dir implementations, `MetadataStore` interface +
  temp-SQLite implementation, shared domain types).

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
  ffprobe` initially returned nothing on this machine, so the MP4-validation property tests used an
  injectable stub probe and the real-ffprobe 4K test self-skipped. Resolved by installing FFmpeg
  9.0.1 via Homebrew (`brew install ffmpeg`); after install the real-ffprobe 4K test runs for real
  (synthesizes a 3840x2160 clip and validates it) and HVC #1 was performed. FFmpeg still needs to be
  baked into the processing container image for Task 8.
- **Task 3 — intermittent storage property-test failure (not reproduced).** While running the shared
  suite during Task 3, one run reported `storage.property.test.ts` "Property 1: Storage round-trip"
  failing on a fast-check-generated path where the same name was used as both a file and a directory
  (`EEXIST: mkdir '.../O'`), possibly a macOS case-insensitive collision. A clean re-run passed 25/25
  with no code change, so it did not reproduce. Flagged here as a potential edge case in the Task 1.3
  generator or `storage.ts` mkdir handling to harden later; no fix applied yet since it was not
  reproducible.
