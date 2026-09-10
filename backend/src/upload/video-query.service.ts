import { Inject, Injectable } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import {
  MetadataStore,
  ProcessingStatus,
  Rendition,
  UploadRecord,
} from '@video-platform/shared';
import { METADATA_STORE } from '../storage.tokens';
import { toFileUrl } from '../files/file-serving';

/** A rendition reference with a resolvable backend file-route URL. */
export interface RenditionRef {
  label: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** Result of a metadata query: current status plus (only when COMPLETED) rendition/thumbnail refs. */
export interface VideoMetadata {
  id: string;
  status: ProcessingStatus;
  renditions: RenditionRef[];
  thumbnailUrl: string | null;
}

/**
 * Read-side service backing the `videos`, `videoStatus`, and `videoMetadata` GraphQL operations
 * (Reqs 3.1–3.5, 4.1–4.5). Kept separate from the resolver so the query logic (including the
 * "withhold metadata until COMPLETED" rule and URL derivation) can be unit-/property-tested
 * directly against the shared temp-SQLite MetadataStore without a GraphQL server.
 */
@Injectable()
export class VideoQueryService {
  constructor(@Inject(METADATA_STORE) private readonly metadata: MetadataStore) {}

  /** Return every Upload_Record (Req 3.1, 3.2). */
  listVideos(): UploadRecord[] {
    return this.metadata.listUploads();
  }

  /**
   * Return the current Processing_Status for `id` (Req 3.3, 3.5), or throw a descriptive GraphQL
   * error if no record exists (Req 3.4).
   */
  getStatus(id: string): ProcessingStatus {
    return this.requireRecord(id).status;
  }

  /**
   * Return metadata for `id`. Only when the record is COMPLETED are rendition references and the
   * thumbnail URL included (Req 4.1, 4.2); otherwise the current status is returned with no
   * rendition refs and a null thumbnail (Req 4.5). Throws a descriptive error for an unknown id.
   */
  getMetadata(id: string): VideoMetadata {
    const record = this.requireRecord(id);

    if (record.status !== ProcessingStatus.COMPLETED) {
      return { id: record.id, status: record.status, renditions: [], thumbnailUrl: null };
    }

    const renditions = this.metadata.getRenditions(record.id).map(toRenditionRef);
    const thumbnailUrl = record.thumbnailPath ? toFileUrl(record.thumbnailPath) : null;

    return { id: record.id, status: record.status, renditions, thumbnailUrl };
  }

  /** Fetch a record or throw a descriptive NOT_FOUND GraphQL error (Req 3.4). */
  private requireRecord(id: string): UploadRecord {
    const record = this.metadata.getUpload(id);
    if (!record) {
      throw new GraphQLError(`No Upload_Record found for id: ${id}`, {
        extensions: { code: 'NOT_FOUND' },
      });
    }
    return record;
  }
}

/** Map a stored Rendition to a GraphQL-facing reference with a backend file-route URL. */
function toRenditionRef(rendition: Rendition): RenditionRef {
  return {
    label: rendition.label,
    url: toFileUrl(rendition.path),
    width: rendition.width,
    height: rendition.height,
  };
}
