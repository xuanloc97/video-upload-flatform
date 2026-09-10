# Failover & High-Availability Test Report

This document records the high-availability and failover verification for the video upload platform
(spec Task 15, Requirements 11.x / 12.x, and Human Verification Checkpoint **HVC #7**). It covers the
cases tested, the exact commands used, the results observed, the downtime/issues seen, and the
improvements a production deployment should make.

## Environment under test

- **Cluster:** local single-node `kind` cluster `video-platform`.
- **Overlay:** `ha` (`deployment/overlays/ha`) — backend ×2, frontend ×2, processing ×1,
  nfs-provisioner ×1. Backend uses a zero-downtime rolling strategy:
  `RollingUpdate` with `maxUnavailable: 0`, `maxSurge: 1`, gated by the `/health/ready` readiness
  probe.
- **Shared storage:** `uploads-pvc` (RWX) dynamically provisioned by the in-cluster nfs-ganesha
  provisioner and mounted at `/uploads` by backend and processing.
- **Seed data:** the Sample_Video was uploaded and fully processed before the tests:
  - id `a4e3e57e-3e4b-40f2-a8c2-48e0f1344173`, status `COMPLETED`
  - renditions `720p` (1280×720) and `480p` (852×480), plus a thumbnail (29 263 bytes)

### Load generator

A small in-cluster load generator drove continuous traffic at the backend Service (which
load-balances across the ready replicas) so request loss during each event could be measured. It ran
the already-loaded backend image, issued `POST /graphql {"query":"{ videos { id } }"}` at ~110 req/s
(concurrency 5), and printed a running `ok`/`fail` tally each second:

```bash
kubectl -n video-platform run loadgen --image=video-platform/backend:dev \
  --image-pull-policy=Never --restart=Never --command -- node -e '<request loop>'
kubectl -n video-platform logs -f loadgen        # watch the tally
```

Using the Service (not a pod-pinned port-forward) is what makes the measurement meaningful: a single
replica loss must not interrupt traffic because the Service keeps routing to the ready endpoints.

> Note on access path: on this `kind` setup the ingress-nginx `LoadBalancer` did not bind host
> port 80 (`curl http://localhost/` → connection refused), so all measurements used the in-cluster
> Service path (and `kubectl port-forward` for uploads). This is an environment quirk of the local
> demo, not a platform defect; the ingress object and controller are present and reconcile.

## Cases tested

### 1. Backend replica termination (Req 11.3, 12.1)

**Steps**

```bash
BPOD=$(kubectl -n video-platform get pod -l app.kubernetes.io/name=backend -o jsonpath='{.items[0].metadata.name}')
kubectl -n video-platform delete pod "$BPOD" --wait=false
# watch the loadgen tally across the event
```

**Result** — the surviving replica served every request while Kubernetes recreated the deleted pod.
The load generator recorded **0 failed requests** across the event (~1 800 requests during the
window). The Deployment returned to 2/2 Ready within ~20 s.

### 2. Frontend replica termination (Req 11.4)

**Steps**

```bash
FPOD=$(kubectl -n video-platform get pod -l app.kubernetes.io/name=frontend -o jsonpath='{.items[0].metadata.name}')
kubectl -n video-platform delete pod "$FPOD" --wait=false
# hit the frontend Service (port 80) in-cluster while the pod is replaced
```

**Result** — the surviving frontend replica served all requests: **ok=40, fail=0** during the
replacement. (The frontend Service listens on port 80 → container `http`/8080; hit the Service on
80, not the container port directly.)

### 3. Backend pod delete/recreate — file durability (Req 12.1, 12.2, 12.3)

**Steps**

```bash
ID=a4e3e57e-3e4b-40f2-a8c2-48e0f1344173
kubectl -n video-platform delete pod -l app.kubernetes.io/name=backend   # recycle BOTH replicas
kubectl -n video-platform rollout status deploy/backend --timeout=120s
# then re-list files on /uploads and re-fetch the thumbnail/metadata via the backend Service
```

**Result** — after the backend pods were recreated, the previously produced artifacts were still
present and served:

- `/uploads/renditions/<id>/720p.mp4`, `.../480p.mp4`, and `/uploads/thumbnails/<id>.jpg` all present.
- `videoMetadata(id)` still `COMPLETED` with both renditions and the thumbnail URL.
- Thumbnail re-fetched over `/files/...` returned HTTP 200 with the identical **29 263 bytes**.

The data survives because it lives on the shared NFS PersistentVolume, not on pod-local disk.

### 4. Rolling update — zero request loss (HVC #7, Req 12.4)

**Steps**

```bash
# trigger a new revision while the loadgen keeps running
kubectl -n video-platform set env deploy/backend ROLLOUT_TEST=v2
kubectl -n video-platform rollout status deploy/backend --timeout=180s
```

**Result** — with `maxUnavailable: 0` + `maxSurge: 1`, a new pod was brought up and made Ready
before an old pod was retired, so capacity never dropped. The load generator's failure count did
**not increase during the rollout** (it stayed flat at the pre-existing 5 — see "Downtime / issues"),
i.e. **zero request loss** attributable to the rolling update.

### 5. Rollback (HVC #7, Req 12.5)

**Steps**

```bash
kubectl -n video-platform rollout undo deploy/backend
kubectl -n video-platform rollout status deploy/backend --timeout=180s
```

**Result** — the previous revision was restored (the `ROLLOUT_TEST` env was gone; only `UPLOADS_DIR`
and `PORT` remained), the load generator again saw **no new failures** during the rollback, and the
backend served `POST /graphql` with HTTP 200 and the seed data intact.

## Results summary

| Case | Expectation | Observed | Verdict |
| --- | --- | --- | --- |
| 1. Backend replica killed | Tier keeps serving | 0 failed requests | PASS |
| 2. Frontend replica killed | Tier keeps serving | 0 failed requests | PASS |
| 3. Backend pods recycled | Files/renditions/thumbnail survive | All present; thumbnail byte-identical | PASS |
| 4. Rolling update | No request loss | 0 new failures during rollout | PASS (HVC #7) |
| 5. Rollback | Previous version serves again | Reverted + serving, 0 new failures | PASS (HVC #7) |

Over the whole run the generator recorded **31 313 successful requests and 5 failures**.

## Downtime / issues observed

- **The only 5 failed requests** occurred in a single ~sub-second burst (`ECONNRESET` /
  `socket hang up`) at the moment **both** backend replicas were deleted **simultaneously** in
  case 3. Deleting an entire tier at once is a deliberately harsher stress than a normal failover or
  a rolling update: for a brief instant the Service had no Ready endpoint. Single-replica loss
  (case 1) and the managed rolling update/rollback (cases 4–5) produced **zero** failures.
- **Abrupt termination has no connection draining.** The backend does not yet implement a graceful
  shutdown / `preStop` delay, so in-flight connections on an abruptly deleted pod can reset. A rolling
  update avoids this because the old pod is only removed after the new one is Ready and traffic has
  shifted.
- **Single-node cluster.** kind runs one node, so this exercises pod-level failover only, not node
  failure. Replicas are not spread across nodes here.
- **Cold-start restart.** On first boot each backend pod typically restarts once, because the
  liveness probe's `initialDelaySeconds` can elapse before the NFS mount + app are fully ready. It
  self-heals to Ready and does not affect steady-state failover.
- **Ephemeral storage server.** The nfs-ganesha provisioner is backed by `emptyDir`; data survives
  consumer-pod restarts (which is what these tests validate) but not the loss of the storage-server
  pod itself.

## Recommended production improvements

- **PodDisruptionBudget** (e.g. `minAvailable: 1` for backend/frontend) so voluntary disruptions
  (node drains, upgrades) can never take the whole tier down at once — the exact scenario that
  produced the 5 failures.
- **Graceful shutdown + connection draining:** handle `SIGTERM`, stop accepting new connections,
  finish in-flight requests, and add a small `preStop` sleep so endpoints are removed before the
  process exits. This removes the abrupt-termination resets.
- **Spread across failure domains:** a multi-node cluster with `topologySpreadConstraints` / pod
  anti-affinity so replicas survive a node loss, not just a pod loss.
- **Durable, replicated shared storage:** a managed RWX filesystem (cloud NFS/EFS/Filestore) or
  object storage for renditions/thumbnails, replacing the single-pod `emptyDir`-backed NFS server so
  storage itself is HA.
- **Highly-available processing:** the worker is single-replica by design (single-writer queue). For
  throughput/HA, move to leader election or a real job queue (e.g. Redis/SQS) with multiple workers
  and idempotent, atomically-claimed jobs.
- **Version-gated rollouts:** roll real image tags (not just an env var) behind readiness/canary
  checks, keeping `maxUnavailable: 0` and `rollout undo` as the fast rollback path validated here.
- **Probe tuning:** align the backend liveness `initialDelaySeconds`/`failureThreshold` with startup
  + storage-mount time to remove the one-time cold-start restart.
