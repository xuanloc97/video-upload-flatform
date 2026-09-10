import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
// graphql-upload-minimal is the multipart/Upload-scalar implementation compatible with the Apollo 4
// + NestJS 10 stack used here (graphql-upload v16 is ESM-only and does not interop cleanly).
import { GraphQLUpload, type FileUpload } from 'graphql-upload-minimal';
import { Inject } from '@nestjs/common';
import { MetadataStore, ProcessingStatus, UploadRecord } from '@video-platform/shared';
import { METADATA_STORE } from '../storage.tokens';
import { InvalidMp4Error } from '../mp4-validation';
import { IncomingUpload, UploadService } from './upload.service';
import { VideoQueryService } from './video-query.service';
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
    private readonly videoQuery: VideoQueryService,
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

  @Query(() => [UploadRecordModel], {
    description: 'List every Upload_Record with id, filename, upload time, and status (Req 3.1, 3.2).',
  })
  videos(): UploadRecordModel[] {
    return this.videoQuery.listVideos().map(toModel);
  }

  @Query(() => ProcessingStatus, {
    description: 'Current Processing_Status for an upload id; errors for an unknown id (Req 3.3-3.5).',
  })
  videoStatus(@Args('id', { type: () => ID }) id: string): ProcessingStatus {
    return this.videoQuery.getStatus(id);
  }

  @Query(() => VideoMetadataModel, {
    description:
      'Rendition + thumbnail references when COMPLETED; otherwise just the current status (Req 4.1, 4.2, 4.5).',
  })
  videoMetadata(@Args('id', { type: () => ID }) id: string): VideoMetadataModel {
    const metadata = this.videoQuery.getMetadata(id);
    const renditions: RenditionModel[] = metadata.renditions.map((r) => ({
      label: r.label,
      url: r.url,
      width: r.width,
      height: r.height,
    }));
    return {
      id: metadata.id,
      status: metadata.status,
      renditions,
      thumbnailUrl: metadata.thumbnailUrl,
    };
  }

  @Mutation(() => UploadRecordModel, {
    description: 'Internal: processing component reports a result (fully implemented in Task 6).',
  })
  updateProcessingResult(
    @Args('input') input: ProcessingResultInput,
  ): UploadRecordModel {
    const updated = this.metadata.updateUpload(input.id, {
      status: input.status,
      thumbnailPath: input.thumbnailPath ?? undefined,
      error: input.error ?? undefined,
    });
    return toModel(updated);
  }

  @Mutation(() => UploadRecordModel, {
    description: 'Reset a FAILED record to PENDING (fully implemented in Task 6).',
  })
  retryProcessing(@Args('id', { type: () => ID }) id: string): UploadRecordModel {
    const updated = this.metadata.updateUpload(id, {
      status: ProcessingStatus.PENDING,
      error: null,
    });
    return toModel(updated);
  }
}
