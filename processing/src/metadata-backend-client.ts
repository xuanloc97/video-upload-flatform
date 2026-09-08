import { MetadataStore, ProcessingStatus, Rendition } from '@video-platform/shared';
import { BackendClient, ClaimedJob, ProcessingResult } from './backend-client';

/**
 * A {@link BackendClient} backed directly by the shared {@link MetadataStore}.
 *
 * In production the worker talks to the backend over GraphQL (so SQLite stays single-writer). For
 * local, in-process demos and end-to-end tests it is convenient to drive the same claim/report
 * operations straight against a store instance — this adapter maps the worker's BackendClient
 * contract onto the store's `claimNext` / `updateUpload` / `setRenditions` methods, exercising the
 * exact status transitions the real backend performs.
 */
export class MetadataStoreBackendClient implements BackendClient {
  constructor(private readonly store: MetadataStore) {}

  async claimNext(): Promise<ClaimedJob | null> {
    const record = this.store.claimNext();
    if (!record) {
      return null;
    }
    return { id: record.id, storedPath: record.storedPath };
  }

  async updateProcessingResult(result: ProcessingResult): Promise<void> {
    if (result.status === ProcessingStatus.COMPLETED && result.renditions) {
      const rows: Rendition[] = result.renditions.map((r) => ({
        uploadId: result.id,
        label: r.label,
        path: r.path,
        width: r.width,
        height: r.height,
      }));
      this.store.setRenditions(result.id, rows);
    }
    this.store.updateUpload(result.id, {
      status: result.status,
      thumbnailPath: result.thumbnailPath ?? undefined,
      error: result.error ?? undefined,
      // Terminal states are no longer "in flight" for stuck-job recovery.
      processingStartedAt: null,
    });
  }
}
