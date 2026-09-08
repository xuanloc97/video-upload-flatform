# Video Upload Platform

A small but fully working video upload and processing platform deployed on a local Kubernetes
environment. Users upload MP4 videos (including 4K) through a React frontend; a NestJS GraphQL
backend stores them on an NFS-backed shared filesystem; and a dedicated FFmpeg processing worker
transcodes each upload into multiple resolutions plus a thumbnail.

> **Status:** scaffolding in progress. This README is a stub and will be completed in a later task
> (see `.kiro/specs/video-upload-platform/tasks.md`, Task 17.1).

## Repository structure

```
/frontend      # React SPA
/backend       # NestJS GraphQL service
/processing    # FFmpeg worker
/shared        # Shared TypeScript types + storage/metadata abstractions (used by backend & processing)
/deployment    # Kustomize base + overlays, NFS, ingress
/scripts       # build.sh, deploy.sh, cleanup.sh
/docs          # architecture.md, failover-test.md, production-notes.md, ai-usage-log.md
/samples       # Sample_Video
README.md
```

## Prerequisites

To be documented (Docker, `kubectl`, `kind`, Node.js). See Task 17.1.

## Quick start

To be documented. See Task 17.1.
