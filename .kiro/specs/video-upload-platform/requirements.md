# Requirements Document

## Introduction

This document defines the requirements for a small but fully working video upload and processing
platform deployed on a local Kubernetes environment. The platform lets users upload MP4 videos
(including 4K input) through a ReactJS frontend, stores them on an NFS-backed shared filesystem
via a NestJS GraphQL backend, and transcodes each upload into multiple resolutions plus a thumbnail
through a dedicated processing component.

The requirements are deliberately grouped and ordered so the system can be built incrementally:
storage foundation first, then backend, frontend, processing, deployment, and finally high
availability and documentation. Each requirement is independently verifiable so progress can be
checked at every step. The core solution runs entirely locally with no dependency on paid cloud
services; cloud deployment is an explicitly optional bonus.

## Glossary

- **Platform**: The complete video upload and processing system, including frontend, backend, processing component, storage, and Kubernetes deployment.
- **Frontend**: The ReactJS single-page application through which users select, upload, and view videos.
- **Backend**: The NestJS GraphQL service that handles uploads, listing, status, and metadata, and health checks.
- **Processing_Component**: The workload that transcodes uploaded videos into multiple resolutions and generates a thumbnail.
- **Shared_Storage**: The NFS or NFS-compatible shared filesystem mounted as the `/uploads` directory, accessible by the Backend and the Processing_Component.
- **Cluster**: The local Kubernetes environment (for example kind, k3d, minikube, or Docker Desktop Kubernetes) that hosts the Platform.
- **Access_Endpoint**: The ingress or documented local access mechanism through which a reviewer reaches the Frontend and Backend.
- **Upload_Record**: The persisted metadata entry describing one uploaded video, including identifier, original filename, upload timestamp, and processing status.
- **Processing_Status**: The state of a video's transcoding lifecycle, one of `PENDING`, `PROCESSING`, `COMPLETED`, or `FAILED`.
- **Rendition**: A generated video version at a specific resolution (2K, 1080p, 720p, or 480p).
- **Thumbnail**: A single still image generated from an uploaded video.
- **Reviewer**: A person reproducing the deployment and evaluation from the provided documentation.
- **Sample_Video**: One short MP4 video included to demonstrate the end-to-end flow.

## Requirements

### Requirement 1: NFS-Backed Shared Storage Foundation

**User Story:** As a platform operator, I want uploaded and processed files stored on an NFS-backed shared filesystem, so that files survive pod restarts and are shared across workloads.

#### Acceptance Criteria

1. THE Cluster SHALL provide an NFS or NFS-compatible Shared_Storage volume mounted as the `/uploads` directory.
2. THE Shared_Storage SHALL be mountable concurrently by the Backend and the Processing_Component.
3. WHEN the Backend writes an uploaded file to the `/uploads` directory, THE Processing_Component SHALL be able to read the same file from the `/uploads` directory.
4. WHEN a Backend pod is deleted and recreated, THE Shared_Storage SHALL retain all previously written files.
5. WHEN the Processing_Component writes a Rendition or Thumbnail to the `/uploads` directory, THE Backend SHALL be able to read that Rendition or Thumbnail from the `/uploads` directory.

### Requirement 2: Backend Video Upload API

**User Story:** As a user, I want to upload an MP4 video through the backend, so that the video is stored for processing.

#### Acceptance Criteria

1. THE Backend SHALL expose a GraphQL operation that accepts an MP4 video file upload.
2. WHEN a valid MP4 file is uploaded, THE Backend SHALL write the file to the `/uploads` directory and create an Upload_Record with Processing_Status set to `PENDING`.
3. WHEN a valid MP4 file is uploaded, THE Backend SHALL return an identifier that uniquely identifies the Upload_Record.
4. IF an uploaded file is not a valid MP4 file, THEN THE Backend SHALL reject the upload and return a descriptive error message.
5. WHEN an MP4 file with 4K resolution is uploaded, THE Backend SHALL accept and store the file using the same upload operation.

### Requirement 3: Backend Listing and Status API

**User Story:** As a user, I want to list uploaded videos and check their processing status, so that I can track what has been uploaded and processed.

#### Acceptance Criteria

1. THE Backend SHALL expose a GraphQL operation that returns the list of Upload_Records.
2. WHEN the list operation is requested, THE Backend SHALL return, for each Upload_Record, the identifier, original filename, upload timestamp, and Processing_Status.
3. WHEN a status operation is requested for a valid Upload_Record identifier, THE Backend SHALL return the current Processing_Status for that Upload_Record.
4. IF a status operation is requested for an identifier that has no Upload_Record, THEN THE Backend SHALL return a descriptive error message.
5. WHEN processing for an Upload_Record is complete, THE Backend SHALL report the Processing_Status as `COMPLETED`.

### Requirement 4: Backend Metadata API for Renditions and Thumbnails

**User Story:** As a user, I want to retrieve metadata for generated video versions and thumbnails, so that the frontend can display and provide access to them.

#### Acceptance Criteria

1. WHEN metadata is requested for an Upload_Record with Processing_Status `COMPLETED`, THE Backend SHALL return references to the 2K, 1080p, 720p, and 480p Renditions.
2. WHEN metadata is requested for an Upload_Record with Processing_Status `COMPLETED`, THE Backend SHALL return a reference to the generated Thumbnail.
3. THE Backend SHALL provide access to each Rendition file stored in the `/uploads` directory.
4. THE Backend SHALL provide access to each Thumbnail file stored in the `/uploads` directory.
5. IF metadata is requested for an Upload_Record whose Processing_Status is not `COMPLETED`, THEN THE Backend SHALL return the current Processing_Status without Rendition or Thumbnail references.

### Requirement 5: Backend Health Checking

**User Story:** As a platform operator, I want the backend to expose health checks, so that Kubernetes can manage pod readiness and liveness.

#### Acceptance Criteria

1. THE Backend SHALL expose a health check endpoint that returns a success response when the Backend is able to serve requests.
2. IF the Backend cannot reach the `/uploads` directory, THEN THE Backend SHALL report an unhealthy status through the health check endpoint.
3. WHEN the Cluster queries the Backend liveness probe, THE Backend SHALL respond within 5 seconds.

### Requirement 6: Video Processing and Rendition Generation

**User Story:** As a user, I want each uploaded video transcoded into multiple resolutions and a thumbnail, so that I can access appropriate versions and a preview image.

#### Acceptance Criteria

1. WHEN an Upload_Record with Processing_Status `PENDING` exists, THE Processing_Component SHALL begin processing the associated video and set the Processing_Status to `PROCESSING`.
2. WHEN processing a video, THE Processing_Component SHALL generate 2K, 1080p, 720p, and 480p Renditions and write each Rendition to the `/uploads` directory.
3. WHEN processing a video, THE Processing_Component SHALL generate one Thumbnail image and write the Thumbnail to the `/uploads` directory.
4. WHEN all Renditions and the Thumbnail for an Upload_Record are written, THE Processing_Component SHALL set the Processing_Status to `COMPLETED`.
5. IF processing of a video fails, THEN THE Processing_Component SHALL set the Processing_Status to `FAILED`.
6. THE Platform SHALL include one Sample_Video that demonstrates the end-to-end upload and processing flow.

### Requirement 7: Processing Recovery and Retry

**User Story:** As a platform operator, I want video processing to recover safely after a processing failure, so that in-progress work is not permanently lost.

#### Acceptance Criteria

1. WHEN a Processing_Component pod terminates before completing an Upload_Record, THE Platform SHALL allow that Upload_Record to be processed again.
2. WHILE an Upload_Record has Processing_Status `FAILED`, THE Platform SHALL provide a documented mechanism to retry processing for that Upload_Record.
3. WHEN processing is retried for an Upload_Record, THE Processing_Component SHALL produce a complete set of Renditions and a Thumbnail equivalent to a first successful run.

### Requirement 8: Frontend Upload and Feedback

**User Story:** As a user, I want to select an MP4 video from my machine and upload it through the frontend, so that I can submit videos and know whether the upload succeeded.

#### Acceptance Criteria

1. THE Frontend SHALL provide a control that lets a user select an MP4 video file from the local machine.
2. WHEN a user submits a selected MP4 video, THE Frontend SHALL upload the file to the Backend through GraphQL.
3. WHEN the Backend confirms a successful upload, THE Frontend SHALL display an upload success indication.
4. IF the Backend returns an upload error, THEN THE Frontend SHALL display an upload failure indication with the returned error message.

### Requirement 9: Frontend Listing, Status, and Playback

**User Story:** As a user, I want the frontend to show uploaded videos, their processing status, thumbnails, and available versions, so that I can view and access processed content.

#### Acceptance Criteria

1. THE Frontend SHALL display the list of uploaded videos retrieved from the Backend.
2. WHEN an Upload_Record has a Processing_Status, THE Frontend SHALL display that Processing_Status for the corresponding video.
3. WHEN an Upload_Record has Processing_Status `COMPLETED`, THE Frontend SHALL display the generated Thumbnail for that video.
4. WHEN an Upload_Record has Processing_Status `COMPLETED`, THE Frontend SHALL provide access to each available Rendition for that video.
5. THE Frontend SHALL communicate with the Backend exclusively through GraphQL.

### Requirement 10: Local Kubernetes Deployment

**User Story:** As a reviewer, I want to deploy the entire platform on a local Kubernetes environment, so that I can reproduce and evaluate the system.

#### Acceptance Criteria

1. THE Platform SHALL provide Kubernetes deployment artifacts as manifests, Helm charts, or Kustomize configurations.
2. THE deployment artifacts SHALL define workloads for the Frontend, the Backend, and the Processing_Component.
3. THE deployment artifacts SHALL define the NFS-backed Shared_Storage used by the Backend and Processing_Component.
4. THE deployment artifacts SHALL define an Access_Endpoint through which the Reviewer reaches the Frontend, or SHALL document the local access method.
5. THE deployment artifacts SHALL define liveness and readiness health checks for the Backend.
6. THE Platform SHALL provide a documented command that removes all deployed Platform resources from the Cluster.
7. THE Platform SHALL deploy and run using only local resources without dependency on paid cloud services.

### Requirement 11: High Availability Through Multiple Replicas

**User Story:** As a platform operator, I want stateless workloads to run with multiple replicas, so that the platform tolerates individual pod failures.

#### Acceptance Criteria

1. THE deployment artifacts SHALL configure the Backend to run with more than one replica.
2. THE deployment artifacts SHALL configure the Frontend to run with more than one replica.
3. WHILE more than one Backend replica is running, THE Backend SHALL continue to serve GraphQL requests when one Backend replica is terminated.
4. WHILE more than one Frontend replica is running, THE Frontend SHALL continue to be served through the Access_Endpoint when one Frontend replica is terminated.

### Requirement 12: Failover and File Durability

**User Story:** As a reviewer, I want uploaded files and processed outputs to remain available after pod restarts, so that I can confirm the storage design survives failover.

#### Acceptance Criteria

1. WHEN a Backend pod is restarted or fails over, THE Platform SHALL keep previously uploaded files available through the Backend.
2. WHEN a Backend pod is restarted or fails over, THE Platform SHALL keep previously generated Renditions and Thumbnails available through the Backend.
3. WHEN a Frontend pod is restarted or fails over, THE Frontend SHALL remain reachable through the Access_Endpoint.
4. WHEN a rolling update is applied to the Backend, THE Backend SHALL continue to serve GraphQL requests during the update.
5. WHERE a rollback is required, THE deployment artifacts SHALL support reverting the Backend to the previous version.

### Requirement 13: Reproducibility Documentation

**User Story:** As a reviewer, I want clear build, deploy, test, and cleanup documentation, so that I can reproduce the working system without additional guidance.

#### Acceptance Criteria

1. THE Platform SHALL include a README document covering project overview, prerequisites, Kubernetes setup, build steps, deploy steps, Frontend access, uploading and processing the Sample_Video, verifying Renditions and the Thumbnail, running failover tests, and cleanup.
2. THE Platform SHALL include an architecture document covering the architecture overview, components, data flow, storage design, video processing design, failure handling, and trade-offs and limitations.
3. THE Platform SHALL include a failover test document covering the cases tested, the commands and steps used, the results observed, downtime or issues observed, and production improvements.
4. THE Platform SHALL include a production notes document covering scalability, large uploads, long-running processing, retry and failure handling, storage choice, security, observability, cost, CI/CD, and cloud deployment considerations.
5. THE production notes document SHALL explain how the design changes for larger production workloads, high concurrency, long videos, and heavy transcoding traffic.
6. THE architecture document SHALL explain why the Shared_Storage approach was chosen, how it works, its failover behavior, and its reliability limitations.

### Requirement 14: AI Usage Documentation

**User Story:** As a reviewer, I want a record of how AI tools were used, so that I can confirm AI was used responsibly and verified.

#### Acceptance Criteria

1. THE Platform SHALL include an AI usage log document identifying the AI tools used and their purposes.
2. THE AI usage log document SHALL record representative prompts and what output was generated, accepted, rejected, or modified.
3. THE AI usage log document SHALL record how AI-generated output was verified and any mistakes that were discovered.

### Requirement 15: Repository Structure and Deliverables

**User Story:** As a reviewer, I want a well-organized repository, so that I can navigate the frontend, backend, deployment, and scripts easily.

#### Acceptance Criteria

1. THE Platform SHALL organize source and deployment artifacts into a repository containing a frontend directory, a backend directory, a deployment directory for Kubernetes artifacts, and a scripts directory.
2. THE repository SHALL contain the README, architecture, failover test, production notes, and AI usage log documents at documented locations.
3. THE scripts directory SHALL contain scripts that support building, deploying, and cleaning up the Platform.
