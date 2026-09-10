# Video Upload Platform

A small but fully working video upload and processing platform that runs on a local Kubernetes
cluster. Users upload MP4 videos (including 4K) through a React frontend; a NestJS GraphQL backend
validates and stores them on an NFS-backed shared filesystem; and a dedicated FFmpeg worker
transcodes each upload into multiple resolutions (2K / 1080p / 720p / 480p, downscale-only) plus a
thumbnail. Status flows `PENDING → PROCESSING → COMPLETED` (or `FAILED`) and the frontend polls it
live.

- **Frontend:** React + TypeScript + Vite, Apollo Client (`apollo-upload-client`), served by NGINX.
- **Backend:** NestJS + Apollo Server (GraphQL), streaming uploads, single-writer SQLite metadata,
  `@nestjs/terminus` health checks, an HTTP file route with range support.
- **Processing:** Node + TypeScript worker using FFmpeg; atomic job claim + tmp-then-rename output.
- **Shared storage:** a single `ReadWriteMany` NFS volume mounted at `/uploads` by backend and
  worker; also holds `metadata.db`.
- **Deployment:** Kustomize (`base` + `dev`/`ha` overlays), an in-cluster NFS provisioner, and an
  NGINX Ingress, all on `kind`.

See [`docs/architecture.md`](docs/architecture.md) for the design and trade-offs, and
[`docs/production-notes.md`](docs/production-notes.md) for how this would change at production scale.

## Repository structure

```
/frontend      # React SPA (Vite)            — standalone package
/backend       # NestJS GraphQL service      — npm workspace
/processing    # FFmpeg worker               — npm workspace
/shared        # Shared types + Storage/MetadataStore abstractions — npm workspace
/deployment    # Kustomize base + overlays (dev, ha), NFS, ingress, kind config
/scripts       # cluster-up.sh, build.sh, deploy.sh, test.sh, cleanup.sh, generate-sample.sh
/docs          # architecture.md, production-notes.md, failover-test.md, ai-usage-log.md
/samples       # sample-video.mp4 (the Sample_Video)
```

Each code package keeps implementation and tests separate: source lives under `<package>/src/` and
tests under `<package>/test/`, with the `test/` tree mirroring `src/`. The Node packages
(`shared`, `backend`, `processing`) type-check tests via a `tsconfig.test.json` so the production
`tsc --build` only compiles `src/`; the frontend runs its tests with Vitest from `frontend/test/`.

## Prerequisites

- **Docker** (running)
- **kind** (Kubernetes in Docker) and **kubectl**
- **Node.js >= 18** (Node 20 recommended) and npm — for building/testing locally
- **FFmpeg** (`ffmpeg` + `ffprobe`) — only needed to run the worker/tests outside a container; the
  processing container image bundles its own FFmpeg

> **Memory:** a `kind` control-plane plus this stack needs a host with enough RAM (≈8 GB+ free is
> comfortable; ~5 GB works for the single-replica `dev` overlay). A ~4 GB host is enough for the
> `dev` overlay but tight for the full `ha` stack.

## Build and test the code (no cluster)

The quickest path is the helper, which installs, builds, and tests every package (shared, backend,
processing, and the frontend). It requires Node >= 18 (Node 20 recommended):

```bash
bash scripts/test.sh
```

Or run the steps by hand:

```bash
npm install                     # installs the shared/backend/processing workspaces
npm run build                   # tsc --build across the workspaces
npm test --workspaces --if-present   # shared + backend + processing test suites

# Frontend is a separate package:
cd frontend && npm install && npm run build && npm test
```

## Run on Kubernetes (kind)

All commands assume Docker is running and your shell can reach `kind`/`kubectl`.

### 1. Create the cluster and install the ingress controller

```bash
bash scripts/cluster-up.sh
```

This creates the `video-platform` kind cluster (with ingress-ready port mappings from
`deployment/kind-cluster.yaml`), installs the NGINX ingress controller, and waits for it to be
ready. It is idempotent — if the cluster already exists it is reused. To do it by hand instead:

```bash
kind create cluster --config deployment/kind-cluster.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=Ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s
```

### 2. Build the images and load them into kind

```bash
bash scripts/build.sh video-platform
```

This builds `video-platform/{backend,processing,frontend}:dev` and `kind load`s them into the
cluster named `video-platform`.

### 3. Deploy

```bash
# dev = single replica per tier (lighter); ha = backend/frontend x2 + zero-downtime backend rollout
bash scripts/deploy.sh dev      # or: bash scripts/deploy.sh ha
```

`deploy.sh` prints the target kube-context and asks for confirmation before applying (set
`CONFIRM=yes` to skip the prompt in automation). It waits for the rollouts and prints how to reach
the app.

### 4. Access the frontend (Access_Endpoint)

With the ingress controller installed and the kind port mappings, browse to:

```
http://localhost/
```

**Fallback (no ingress):** port-forward the two Services and use the frontend directly:

```bash
kubectl -n video-platform port-forward svc/frontend 8080:80
kubectl -n video-platform port-forward svc/backend  3000:3000
# then open http://localhost:8080/
```

## Upload and process the Sample_Video

A short real MP4 lives at [`samples/sample-video.mp4`](samples/sample-video.mp4) (1280×720, ~3 s).
You can regenerate it with `bash scripts/generate-sample.sh`.

1. Open the frontend, choose `samples/sample-video.mp4`, and click **Upload**. A success banner
   confirms the upload; the video appears in the list as **Pending**.
2. The worker claims the job (**Processing**) and, when done, the row shows **Completed**.
3. Click **View** on the completed row to see the **thumbnail** and play each **rendition** (720p,
   480p for this source — downscale-only, so a 720p source produces no 2K/1080p).

### Verify renditions and the thumbnail

```bash
# List the produced files on the shared volume (via a backend pod):
POD=$(kubectl -n video-platform get pod -l app.kubernetes.io/name=backend -o name | head -1)
kubectl -n video-platform exec "$POD" -- ls -R /uploads/renditions /uploads/thumbnails

# Or inspect a rendition's dimensions with ffprobe (from the processing pod, which has ffprobe):
PROC=$(kubectl -n video-platform get pod -l app.kubernetes.io/name=processing -o name | head -1)
kubectl -n video-platform exec "$PROC" -- ffprobe -v error \
  -show_entries stream=width,height -of csv=p=0 /uploads/renditions/<id>/720p.mp4
```

The GraphQL `videoMetadata(id)` query returns the thumbnail URL and rendition file URLs once a
record is `COMPLETED`; the frontend uses those `/files/...` URLs for display and playback.

## Failover tests

See [`docs/failover-test.md`](docs/failover-test.md) for the multi-replica failover and
rolling-update procedures (terminate a backend/frontend replica and confirm the tier keeps serving;
delete/recreate a backend pod and confirm previously uploaded files survive; run a rollout with a
request loop and confirm zero failed requests, then `kubectl rollout undo`).

## Cleanup

```bash
bash scripts/cleanup.sh dev     # or: ha — matches the overlay you deployed
```

This deletes the overlay's resources and the `video-platform` namespace (namespace-scoped; it does
not touch the rest of your cluster). It force-deletes any pods whose shared-NFS mount is hung so
namespace termination can't stall, and clears the retained PersistentVolume so the next
`deploy.sh` provisions a fresh, clean volume.

To also tear down the whole local kind cluster in one go:

```bash
DELETE_CLUSTER=yes bash scripts/cleanup.sh ha
# equivalent manual step:
kind delete cluster --name video-platform
```
