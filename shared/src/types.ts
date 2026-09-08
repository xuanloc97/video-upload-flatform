/**
 * Shared domain types used by both the backend and the processing component.
 *
 * These mirror the design's Data Models (SQLite tables `upload_records` and `renditions`)
 * and the Processing_Status lifecycle. Keeping them in a shared package lets the backend
 * (single writer) and the processing worker agree on the exact shape of records they exchange.
 */

/** Processing_Status lifecycle (design "Data Models"). */
export enum ProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Rendition resolution labels (downscale-only; small sources produce fewer). */
export type RenditionLabel = '2K' | '1080p' | '720p' | '480p';

export const RENDITION_LABELS: readonly RenditionLabel[] = ['2K', '1080p', '720p', '480p'];

/**
 * Upload_Record — SQLite table `upload_records`.
 * Represents one uploaded video and its processing lifecycle.
 */
export interface UploadRecord {
  /** Unique identifier returned to clients (Req 2.3). */
  id: string;
  /** Original filename as provided by the client (Req 3.2). */
  originalFilename: string;
  /** Relative stored path of the original, e.g. `originals/<id>.mp4`. */
  storedPath: string;
  /** ISO-8601 upload timestamp (Req 3.2). */
  uploadedAt: string;
  /** Current processing status. */
  status: ProcessingStatus;
  /** When processing started; used for stuck-job recovery timeout. Null until claimed. */
  processingStartedAt: string | null;
  /** Relative thumbnail path, e.g. `thumbnails/<id>.jpg`; set when COMPLETED. */
  thumbnailPath: string | null;
  /** Error message; populated when FAILED. */
  error: string | null;
}

/**
 * Rendition — SQLite table `renditions`.
 * A generated video version at a specific resolution for an upload.
 */
export interface Rendition {
  /** Autoincrement primary key. Undefined before the row is inserted. */
  id?: number;
  /** Foreign key to `upload_records.id`. */
  uploadId: string;
  /** Resolution label. */
  label: RenditionLabel;
  /** Relative path, e.g. `renditions/<uploadId>/<label>.mp4`. */
  path: string;
  /** Rendition width in pixels, if known. */
  width: number | null;
  /** Rendition height in pixels, if known. */
  height: number | null;
}

/** Fields required to create a new Upload_Record. */
export interface NewUploadRecord {
  id: string;
  originalFilename: string;
  storedPath: string;
  /** Defaults to now (ISO-8601) if omitted by the implementation. */
  uploadedAt?: string;
}
