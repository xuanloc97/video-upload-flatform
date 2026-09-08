# Implementation Plan: Video Upload Platform

## Overview

This plan builds the platform incrementally in the order mandated by the design: storage
foundation → backend API → processing component → frontend → Kubernetes deployment → high
availability & failover → documentation. Each stage leaves the system runnable and verifiable at a
meaningful milestone, and every task references the requirements and correctness properties it
implements.

Testing follows the design's dual approach: `fast-check` property-based tests (one per correctness
property, ≥100 iterations, tagged `Feature: video-upload-platform, Property N: ...`, backed by a
temp-dir + temp-SQLite storage/metadata abstraction) plus unit/component tests. Test sub-tasks are
marked optional with `*`. Human Verification Checkpoints (HVC #1–#12) from the design are woven in
as explicit verification sub-steps; each result is recorded in `docs/ai-usage-log.md`.

Language for all components: TypeScript (backend NestJS, processing Node worker, frontend React).

## Tasks

- [x] 1. Scaffold repository structure and shared foundations
  - Create top-level layout: `/frontend`, `/backend`, `/processing`, `/deployment`, `/scripts`, `/docs`, `/samples`, and a root `README.md` stub
  - Add root tooling config (workspace/package layout, shared TypeScript config, `.gitignore`) so backend and processing can share types
  - _Requirements: 15.1, 15.2, 15.3_

  - [x] 1.1 Scaffold the AI usage log early
    - Create `docs/ai-usage-log.md` with sections for tools used, purpose per component, representative prompts, accepted/rejected/modified outputs, how output was verified, and AI mistakes discovered
    - This is a living document; later tasks append to it (see HVC "closing the loop")
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 1.2 Implement the storage/metadata abstraction used by app code and tests
    - Define a storage interface (write/read/exists/move at a base path) and a SQLite-backed metadata store interface, both parameterized by a base directory and DB path
    - Provide a temp-dir + temp-SQLite implementation so property/unit tests run without a cluster
    - _Requirements: 1.3, 1.5, 2.2_

  - [x] 1.3 Write property test for storage round-trip
    - **Property 1: Storage round-trip**
    - **Validates: Requirements 1.3, 1.5**

- [x] 2. Establish NFS-backed shared storage foundation (Kubernetes)
  - [x] 2.1 Author NFS server + shared-volume manifests
    - Create `deployment/base` namespace, an in-cluster NFS server Deployment + ClusterIP Service backed by a node directory, and a `ReadWriteMany` PersistentVolume + `uploads-pvc` PersistentVolumeClaim mounted at `/uploads`
    - _Requirements: 1.1, 1.2, 10.3_

  - [x] 2.2 Verify concurrent RWX mount and durability on kind (HVC #4)
    - Bring up kind, apply the storage manifests, and use two throwaway pods to confirm both mount `/uploads`; write from one and read from the other; delete the writer pod and confirm the file persists after recreate
    - Record the verification result in `docs/ai-usage-log.md`
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [x] 3. Implement backend metadata store and SQLite persistence
  - [x] 3.1 Create Upload_Record and Rendition schema and single-writer data layer
    - Implement the `upload_records` and `renditions` tables and a serialized write path (single write connection, short-held mutex / `BEGIN IMMEDIATE`, rollback journal, retry-on-`SQLITE_BUSY`) so only the backend writes `metadata.db`
    - _Requirements: 2.2, 3.2_

  - [x]* 3.2 Write unit tests for the metadata store
    - Insert/read/update round-trips, status transitions, and retry-on-busy behavior
    - _Requirements: 2.2, 3.2_

- [x] 4. Implement backend upload API and MP4 validation
  - [x] 4.1 Set up NestJS + Apollo Server with the GraphQL schema
    - Wire the `Upload`/`DateTime` scalars, `ProcessingStatus` enum, `UploadRecord`/`Rendition`/`VideoMetadata` types, and the query/mutation stubs from the design schema
    - _Requirements: 2.1_

  - [x] 4.2 Implement `uploadVideo` with streaming write and MP4 validation
    - Stream the incoming file via `graphql-upload` to `originals/<id>.mp4`, validate MP4 via magic bytes (`ftyp`) + `ffprobe`, reject invalid files before any record/file is created, and on success create a `PENDING` Upload_Record and return its id; handle 4K inputs without buffering in memory
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x]* 4.3 Write property test for upload creating a PENDING record
    - **Property 2: Upload creates a PENDING record and stores the file**
    - **Validates: Requirements 2.2**

  - [x]* 4.4 Write property test for unique upload identifiers
    - **Property 3: Upload identifiers are unique**
    - **Validates: Requirements 2.3**

  - [x]* 4.5 Write property test for rejecting invalid uploads
    - **Property 4: Invalid uploads are rejected**
    - **Validates: Requirements 2.4**

  - [x]* 4.6 Write unit test for the 4K acceptance example
    - Upload a 4K sample and confirm it is accepted and stored
    - _Requirements: 2.5_

  - [x] 4.7 Verify MP4 validation logic manually (HVC #1)
    - Upload a real MP4 and a 4K MP4 (both accepted); upload a renamed `.txt`, a truncated MP4, and a non-MP4 with a spoofed extension (all rejected with descriptive errors and no record/file created); record the result in `docs/ai-usage-log.md`
    - _Requirements: 2.4, 2.5_

- [ ] 5. Implement backend listing, status, metadata, and file-serving APIs
  - [ ] 5.1 Implement `videos` and `videoStatus` queries
    - Return every Upload_Record with id, original filename, upload timestamp, and status; return current status for a valid id and a descriptive error for an unknown id
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 5.2 Implement `videoMetadata` query and the file-serving route
    - Return thumbnail + rendition references only when `COMPLETED` (otherwise current status with no refs); add a REST-style `/files/...` route that streams renditions/thumbnails from `/uploads` with correct content types and HTTP range support for playback
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 5.3 Write property test for listing completeness
    - **Property 5: Listing returns every record with all required fields**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 5.4 Write property test for status consistency
    - **Property 6: Status query is consistent with stored state**
    - **Validates: Requirements 3.3, 3.5**

  - [ ]* 5.5 Write property test for status of a missing id
    - **Property 7: Status query for a missing id errors**
    - **Validates: Requirements 3.4**

  - [ ]* 5.6 Write property test for COMPLETED metadata completeness
    - **Property 8: Metadata for COMPLETED records is complete**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 5.7 Write property test for retrievable referenced files
    - **Property 9: Referenced files are retrievable**
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 5.8 Write property test for withholding metadata until COMPLETED
    - **Property 10: Metadata is withheld until COMPLETED**
    - **Validates: Requirements 4.5**

  - [ ]* 5.9 Write unit tests for query/resolver shape and file-route range requests
    - Confirm the existence/shape of `uploadVideo`, `videos`, `videoStatus`, `videoMetadata`; test range requests for playback
    - _Requirements: 2.1, 3.1_

- [ ] 6. Implement backend health checks and processing callbacks
  - [ ] 6.1 Implement `@nestjs/terminus` liveness/readiness with `/uploads` reachability
    - Expose `/health/live` and `/health/ready`; readiness includes a writable-check on `/uploads` and reports unhealthy when unreachable; ensure probes respond well under 5 seconds
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 6.2 Implement `updateProcessingResult`, `retryProcessing`, and `claimNext` operations
    - Add the internal `updateProcessingResult` mutation (backend owns all writes), the atomic `claimNext` claim (`UPDATE ... WHERE status='PENDING'` → `PROCESSING`), and `retryProcessing` (FAILED → PENDING); add stuck-job recovery that resets `PROCESSING` records past a timeout back to `PENDING`
    - _Requirements: 6.1, 7.1, 7.2_

  - [ ]* 6.3 Write property test for unhealthy-when-storage-unreachable
    - **Property 11: Unhealthy when storage is unreachable**
    - **Validates: Requirements 5.2**

  - [ ]* 6.4 Write property test for atomic exclusive job claim
    - **Property 12: Claiming a job is atomic and exclusive**
    - **Validates: Requirements 6.1**

  - [ ]* 6.5 Write property test for stuck-job recovery
    - **Property 16: Stuck jobs recover to PENDING**
    - **Validates: Requirements 7.1**

  - [ ]* 6.6 Write property test for retry reset
    - **Property 17: Retry resets a FAILED record to PENDING**
    - **Validates: Requirements 7.2**

  - [ ]* 6.7 Write unit test for a healthy health-check response
    - Confirm `/health/ready` and `/health/live` succeed under normal conditions
    - _Requirements: 5.1_

- [ ] 7. Checkpoint - backend runnable and tested
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement the processing worker (FFmpeg renditions, thumbnail, recovery)
  - [ ] 8.1 Implement job loop with atomic claim and status transition
    - Node + TypeScript worker that polls the backend's `claimNext` (or DB via backend) to atomically move one `PENDING` record to `PROCESSING`, reads `originals/<id>.mp4` from `/uploads`
    - _Requirements: 6.1_

  - [ ] 8.2 Implement downscale-only rendition + thumbnail transcode with atomic tmp-then-rename
    - Use `fluent-ffmpeg`/FFmpeg to scale to 2K/1080p/720p/480p with aspect ratio preserved and downscale-only (small sources skip higher renditions), extract one thumbnail frame, write all outputs to `tmp/<id>/` and atomically move into `renditions/<id>/` and `thumbnails/<id>.jpg` on success
    - _Requirements: 6.2, 6.3_

  - [ ] 8.3 Wire completion/failure/retry callbacks to the backend
    - On success call `updateProcessingResult(COMPLETED, refs)`; on any error call `updateProcessingResult(FAILED, error)` leaving the original intact; ensure a retried run cleans `tmp/<id>/` and reproduces a full equivalent output set
    - _Requirements: 6.4, 6.5, 7.3_

  - [ ]* 8.4 Write property test for complete output set on success
    - **Property 13: Successful processing produces a complete output set** (validate against a stubbed FFmpeg for speed)
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 8.5 Write property test for output completeness implying COMPLETED
    - **Property 14: Output completeness implies COMPLETED**
    - **Validates: Requirements 6.4**

  - [ ]* 8.6 Write property test for failure implying FAILED
    - **Property 15: Processing failure implies FAILED**
    - **Validates: Requirements 6.5**

  - [ ]* 8.7 Write property test for retry idempotence
    - **Property 18: Retry produces an equivalent output set (idempotence)**
    - **Validates: Requirements 7.3**

  - [ ]* 8.8 Write integration pass with real FFmpeg on the Sample_Video
    - Run the real FFmpeg path once on the sample to confirm the stub matches reality
    - _Requirements: 6.2, 6.3_

  - [ ] 8.9 Verify FFmpeg rendition correctness manually (HVC #2)
    - Inspect outputs with `ffprobe -show_entries stream=width,height`; confirm 2K/1080p/720p/480p dimensions, aspect ratio preserved, small sources gain no higher renditions, and the thumbnail is a real frame; record in `docs/ai-usage-log.md`
    - _Requirements: 6.2, 6.3_

  - [ ] 8.10 Verify atomic tmp-then-rename behavior manually (HVC #5)
    - Kill the worker mid-transcode; confirm only `tmp/<id>/` holds partials and no incomplete file appears under final paths; re-run and confirm a clean complete set; record in `docs/ai-usage-log.md`
    - _Requirements: 6.4, 7.3_

  - [ ] 8.11 Verify property tests are meaningful (HVC #10)
    - Review each `fast-check` generator/assertion; inject a known bug and confirm the relevant property fails, then restore; record in `docs/ai-usage-log.md`
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.3_

- [ ] 9. Add the Sample_Video and demonstrate end-to-end flow locally
  - Add one short MP4 `Sample_Video` under `/samples`; run backend + worker locally against the temp storage to confirm upload → PENDING → PROCESSING → COMPLETED with renditions and thumbnail
  - _Requirements: 6.6_

- [ ] 10. Checkpoint - processing pipeline runnable end to end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement the frontend (React SPA)
  - [ ] 11.1 Scaffold React + TypeScript + Vite app with Apollo Client
    - Set up Apollo Client and `apollo-upload-client`; ensure all API access goes exclusively through GraphQL
    - _Requirements: 9.5_

  - [ ] 11.2 Implement upload view with success/error feedback
    - `<input type="file" accept="video/mp4">` + submit; upload via GraphQL; show a success indication on confirmation and a failure indication with the returned error message
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 11.3 Implement list/status view with polling
    - Display the list of uploads with filename, upload time, and live status badges; poll `videos`/`videoStatus` to reflect transitions
    - _Requirements: 9.1, 9.2_

  - [ ] 11.4 Implement thumbnail display and rendition playback/links
    - For `COMPLETED` records show the thumbnail and provide access to each available rendition via an HTML5 `<video>` player / links using backend file URLs
    - _Requirements: 9.3, 9.4_

  - [ ]* 11.5 Write component tests (React Testing Library)
    - File-select control, upload submission wiring, success/error banners, list rendering with status badges, thumbnail display and rendition links for COMPLETED records
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_

- [ ] 12. Checkpoint - full stack runnable locally
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Containerize and author Kubernetes deployment artifacts
  - [ ] 13.1 Write Dockerfiles for backend, processing (with FFmpeg), and frontend (NGINX static)
    - Multi-stage builds producing small images; frontend served as static assets by NGINX
    - _Requirements: 10.2, 10.7_

  - [ ] 13.2 Author Kustomize base manifests for all workloads
    - Deployments + Services for frontend, backend, processing; mount `uploads-pvc` at `/uploads` in backend and processing; add resource limits, non-root securityContext, and correct image references; backend liveness/readiness probes hit `/health/live` and `/health/ready`
    - _Requirements: 10.1, 10.2, 10.5_

  - [ ] 13.3 Author NGINX Ingress and document port-forward fallback
    - Route `/` → frontend and `/graphql`, `/health`, `/files` → backend; document `kubectl port-forward` as the fallback Access_Endpoint
    - _Requirements: 10.4_

  - [ ] 13.4 Create dev and ha Kustomize overlays
    - `overlays/dev` (single replicas) and `overlays/ha` (backend/frontend ≥2 replicas, processing single replica, tuned probes, `RollingUpdate` with `maxUnavailable: 0` for backend)
    - _Requirements: 10.1, 11.1, 11.2, 12.4_

  - [ ] 13.5 Author build.sh, deploy.sh, and cleanup.sh
    - `build.sh` builds and `kind load`s images; `deploy.sh` applies the chosen overlay; `cleanup.sh` runs namespace-scoped `kubectl delete -k` (+ namespace deletion) to remove all resources
    - _Requirements: 10.6, 15.3_

  - [ ] 13.6 Review generated manifests and shell scripts (HVC #8 and #9)
    - Review `kubectl kustomize overlays/ha` for resource limits, securityContext, image refs, and no hardcoded secrets; read each script line by line for destructive/wrong-context commands and confirm deletes are namespace-scoped and kube-context is checked; record both reviews in `docs/ai-usage-log.md`
    - _Requirements: 10.6, 10.x, 15.3_

- [ ] 14. Deploy to kind and verify runtime health, storage safety, and probes
  - [ ] 14.1 Deploy the stack and verify SQLite single-writer safety (HVC #3)
    - Deploy with ≥2 backend replicas; drive concurrent uploads/status updates, then run `PRAGMA integrity_check;` on `metadata.db` and confirm `ok` with no lost records; record in `docs/ai-usage-log.md`
    - _Requirements: 2.2, 3.2_

  - [ ] 14.2 Verify health/readiness probe correctness (HVC #6)
    - Simulate `/uploads` loss and confirm `/health/ready` reports unhealthy and the pod leaves rotation; confirm probe response well under 5s; record in `docs/ai-usage-log.md`
    - _Requirements: 5.2, 5.3_

- [ ] 15. Verify high availability and failover
  - [ ] 15.1 Verify multi-replica failover and file durability
    - Terminate one backend replica and one frontend replica and confirm each tier keeps serving; delete/recreate a backend pod and confirm previously uploaded files, renditions, and thumbnails remain available (re-run of HVC #4 concurrency/survival during failover)
    - _Requirements: 11.3, 11.4, 12.1, 12.2, 12.3_

  - [ ] 15.2 Verify rolling update with no request loss and rollback (HVC #7)
    - Run a rollout while a request loop hits the backend and confirm zero failed requests; run `kubectl rollout undo` and confirm the previous version serves again; record in `docs/ai-usage-log.md`
    - _Requirements: 12.4, 12.5_

  - [ ] 15.3 Write the failover test document
    - Create `docs/failover-test.md` covering cases tested, commands/steps used, results observed, downtime/issues, and production improvements
    - _Requirements: 13.3_

- [ ] 16. Checkpoint - deployed, highly available, failover demonstrated
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Complete documentation deliverables
  - [ ] 17.1 Write README.md
    - Cover project overview, prerequisites, Kubernetes setup, build steps, deploy steps, frontend access, uploading and processing the Sample_Video, verifying renditions and the thumbnail, running failover tests, and cleanup
    - _Requirements: 13.1_

  - [ ] 17.2 Write architecture.md
    - Cover architecture overview, components, data flow, storage design, video processing design, failure handling, and trade-offs/limitations; explain why the shared-storage approach was chosen, how it works, its failover behavior, and reliability limitations
    - _Requirements: 13.2, 13.6_

  - [ ] 17.3 Write production-notes.md
    - Cover scalability, large uploads, long-running processing, retry/failure handling, storage choice, security, observability, cost, CI/CD, and cloud deployment; explain how the design changes for larger workloads, high concurrency, long videos, and heavy transcoding traffic
    - _Requirements: 13.4, 13.5_

  - [ ] 17.4 Finalize ai-usage-log.md and verify honesty (HVC #12)
    - Ensure the living log records tools used, purposes, representative prompts, accepted/rejected/modified outputs, verification steps, and AI mistakes discovered across all phases; read it end to end and confirm it matches reality
    - _Requirements: 14.1, 14.2, 14.3_

- [ ] 18. Final end-to-end reproducibility verification (HVC #11)
  - On a clean environment, follow the README exactly: bring up the cluster, build, deploy, upload the Sample_Video, and confirm renditions + thumbnail appear via the Access_Endpoint; record the result in `docs/ai-usage-log.md`
  - _Requirements: 10.7, 13.1, 15.1, 15.2_

- [ ] 19. Final checkpoint - all deliverables complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core
  implementation tasks are never optional.
- Each property-based test implements exactly one correctness property (Properties 1–18), tagged
  `Feature: video-upload-platform, Property N: ...`, ≥100 iterations, using the temp-dir + temp-SQLite
  storage/metadata abstraction.
- Human Verification Checkpoints (HVC #1–#12) appear as explicit verification sub-steps at the
  earliest meaningful build point; every result is recorded in `docs/ai-usage-log.md` ("closing the
  loop").
- Checkpoints ensure the system is runnable and verifiable at each major milestone following the
  incremental build order.
