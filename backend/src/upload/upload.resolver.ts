import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
// graphql-upload-minimal is the multipart/Upload-scalar implementation compatible with the Apollo 4
// + NestJS 10 stack used here (graphql-upload v16 is ESM-only and does not interop cleanly).
import { GraphQLUpload, type FileUpload } from 'graphql-upload-minimal';
import { Inject } from '@nestjs/common';
import {
  MetadataStore,
  ProcessingStatus,
  Rendition,
  RenditionLabel,
  UploadRecord,
} from '@video-platform/shared';
import { METADATA_STORE } from '../storage.tokens';
import { fileRouteUrl } from '../files/file-route';
import { InvalidMp4Error } from '../mp4-validation';
import { IncomingUpload, UploadService } from './upload.service';
import {
  ProcessingResultInput,
  RenditionModel,
  UploadRecordModel,
  VideoMetadataModel,
} from '../graphql/models';

/** Map a shared UploadRecord to the GraphQL UploadRecordModel shape. */
function toModel(record: UploadRecord): UploadRecordModel {
  return {
    id: record.id,
    originalFilename: record.originalFilename,
    uploadedAt: new Date(record.uploadedAt),
    status: record.status,
  };
}

/** Map a stored Rendition (relative path) to the GraphQL RenditionModel with a file-route URL. */
function toRenditionModel(rendition: Rendition): RenditionModel {
  return {
    label: rendition.label,
    url: fileRouteUrl(rendition.path),
    width: rendition.width,
    height: rendition.height,
  };
}

/**
 * Build a mapper from a GraphQL RenditionInput to a stored Rendition row for `uploadId`. Returns a
 * curried function so it can be used directly with `Array.prototype.map`.
 */
function toRenditionRow(uploadId: string) {
  return (input: {
    label: string;
    path: string;
    width?: number | null;
    height?: number | null;
  }): Rendition => ({
    uploadId,
    label: input.label as RenditionLabel,
    path: input.path,
    width: input.width ?? null,
    height: input.height ?? null,
  });
}

/**
 * GraphQL resolver for upload plus the query/mutation surface of the schema.
 *
 * `uploadVideo` is fully implemented in this task (Task 4). The remaining queries/mutations are
 * minimal, compiling stubs that return sensible shapes; they are completed in Tasks 5–6.
 */
@Resolver(() => UploadRecordModel)
export class UploadResolver {
  constructor(
    private readonly uploadService: UploadService,
    @Inject(METADATA_STORE) private readonly metadata: MetadataStore,
  ) {}

  @Mutation(() => UploadRecordModel, {
    description: 'Upload an MP4 video. Streams to storage, validates, and creates a PENDING record.',
  })
  async uploadVideo(
    @Args('file', { type: () => GraphQLUpload })
    file: Promise<FileUpload>,
  ): Promise<UploadRecordModel> {
    const resolved = (await file) as unknown as IncomingUpload;
    try {
      const record = await this.uploadService.handleUpload(resolved);
      return toModel(record);
    } catch (err) {
      if (err instanceof InvalidMp4Error) {
        // Surface a descriptive, client-facing GraphQL error (Req 2.4).
        throw new GraphQLError(err.message, {
          extensions: { code: 'INVALID_MP4' },
        });
      }
      throw err;
    }
  }

  @Query(() => [UploadRecordModel], { description: 'List every Upload_Record (Task 5).' })
  videos(): UploadRecordModel[] {
    return this.metadata.listUploads().map(toModel);
  }

  @Query(() => ProcessingStatus, {
    description: 'Current status for an upload id (fully implemented in Task 5).',
  })
  videoStatus(@Args('id', { type: () => ID }) id: string): ProcessingStatus {
    const record = this.metadata.getUpload(id);
    if (!record) {
      throw new GraphQLError(`No Upload_Record found for id: ${id}`, {
        extensions: { code: 'NOT_FOUND' },
      });
    }
    return record.status;
  }

  @Query(() => VideoMetadataModel, {
    description:
      'Rendition/thumbnail metadata for an upload. References are only returned once the record ' +
      'is COMPLETED; otherwise only the current status is returned (Reqs 4.1, 4.2, 4.5).',
  })
  videoMetadata(@Args('id', { type: () => ID }) id: string): VideoMetadataModel {
    const record = this.metadata.getUpload(id);
    if (!record) {
      throw new GraphQLError(`No Upload_Record found for id: ${id}`, {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // Withhold rendition/thumbnail references until processing has COMPLETED (Req 4.5).
    if (record.status !== ProcessingStatus.COMPLETED) {
      return { id: record.id, status: record.status, renditions: [], thumbnailUrl: null };
    }

    // COMPLETED: expose every produced rendition and the thumbnail as file-route URLs (Reqs 4.1–4.4).
    const renditions = this.metadata.getRenditions(record.id).map(toRenditionModel);
    const thumbnailUrl = record.thumbnailPath ? fileRouteUrl(record.thumbnailPath) : null;
    return { id: record.id, status: record.status, renditions, thumbnailUrl };
  }

  @Mutation(() => UploadRecordModel, {
    nullable: true,
    description:
      'Internal: atomically claim the next PENDING record for processing, moving it to PROCESSING ' +
      'and returning it (or null when nothing is pending). Exclusive across workers (Req 6.1).',
  })
  claimNext(): UploadRecordModel | null {
    const claimed = this.metadata.claimNext();
    return claimed ? toModel(claimed) : null;
  }

  @Mutation(() => UploadRecordModel, {
    description:
      'Internal: the processing component reports a result. The backend is the sole writer of ' +
      'metadata.db, so all status/rendition/thumbnail updates flow through here (Reqs 6.4, 6.5).',
  })
  updateProcessingResult(
    @Args('input') input: ProcessingResultInput,
  ): UploadRecordModel {
    // Persist status plus any thumbnail/error the worker reported. On a terminal transition we also
    // clear processing_started_at so the record is no longer considered "in flight" by stuck-job
    // recovery. On COMPLETED/FAILED there is no in-flight processing to track.
    const clearProcessingStart =
      input.status === ProcessingStatus.COMPLETED ||
      input.status === ProcessingStatus.FAILED;

    const updated = this.metadata.updateUpload(input.id, {
      status: input.status,
      thumbnailPath: input.thumbnailPath ?? undefined,
      error: input.error ?? undefined,
      processingStartedAt: clearProcessingStart ? null : undefined,
    });

    // Record the produced renditions when supplied (Req 4.1 metadata later reads these back).
    if (input.renditions) {
      this.metadata.setRenditions(input.id, input.renditions.map(toRenditionRow(input.id)));
    }

    return toModel(updated);
  }

  @Mutation(() => UploadRecordModel, {
    description: 'Documented manual retry: reset a FAILED record to PENDING for reprocessing (Req 7.2).',
  })
  retryProcessing(@Args('id', { type: () => ID }) id: string): UploadRecordModel {
    try {
      return toModel(this.metadata.retryProcessing(id));
    } catch (err) {
      // Surface a descriptive, client-facing error for unknown ids or non-FAILED records.
      throw new GraphQLError((err as Error).message, {
        extensions: { code: 'RETRY_NOT_ALLOWED' },
      });
    }
  }
}
