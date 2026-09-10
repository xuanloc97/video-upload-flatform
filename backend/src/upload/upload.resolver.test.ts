import {
  ProcessingStatus,
  RENDITION_LABELS,
  TempDirStorage,
  TempSqliteMetadataStore,
} from '@video-platform/shared';
import { GraphQLError } from 'graphql';
import { UploadResolver } from './upload.resolver';
import { UploadService } from './upload.service';
import { VideoQueryService } from './video-query.service';
import { FILES_ROUTE_PREFIX } from '../files/file-serving';
import { makeFtypBuffer, makeUpload, StubValidProbe } from './upload.test-helpers';

/*
 * Unit tests for the GraphQL resolver surface (existence + shape of uploadVideo, videos,
 * videoStatus, videoMetadata) wired against the shared temp-dir Storage + temp-SQLite MetadataStore
 * (Req 2.1, 3.1). Exercises the resolver methods directly rather than over HTTP.
 */

describe('UploadResolver query/mutation shape', () => {
  let storage: TempDirStorage;
  let metadata: TempSqliteMetadataStore;
  let resolver: UploadResolver;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    metadata = await TempSqliteMetadataStore.create();
    const uploadService = new UploadService(storage, metadata, new StubValidProbe());
    const videoQuery = new VideoQueryService(metadata);
    resolver = new UploadResolver(uploadService, videoQuery, metadata);
  });

  afterEach(async () => {
    await metadata.cleanup();
    await storage.cleanup();
  });

  it('uploadVideo returns a PENDING record model and videos lists it', async () => {
    const record = await resolver.uploadVideo(
      Promise.resolve(makeUpload('demo.mp4', makeFtypBuffer())) as never,
    );

    expect(record.id).toBeTruthy();
    expect(record.originalFilename).toBe('demo.mp4');
    expect(record.status).toBe(ProcessingStatus.PENDING);
    expect(record.uploadedAt).toBeInstanceOf(Date);

    const listed = resolver.videos();
    expect(listed.map((r) => r.id)).toContain(record.id);
    const listedRecord = listed.find((r) => r.id === record.id)!;
    expect(listedRecord.originalFilename).toBe('demo.mp4');
    expect(listedRecord.uploadedAt).toBeInstanceOf(Date);
  });

  it('videoStatus returns the current status and errors for an unknown id', async () => {
    const record = await resolver.uploadVideo(
      Promise.resolve(makeUpload('s.mp4', makeFtypBuffer())) as never,
    );
    expect(resolver.videoStatus(record.id)).toBe(ProcessingStatus.PENDING);
    expect(() => resolver.videoStatus('nope')).toThrow(GraphQLError);
  });

  it('videoMetadata returns status only until COMPLETED, then full refs', async () => {
    const record = await resolver.uploadVideo(
      Promise.resolve(makeUpload('m.mp4', makeFtypBuffer())) as never,
    );

    // Pre-COMPLETED: status only, no refs.
    const pending = resolver.videoMetadata(record.id);
    expect(pending.status).toBe(ProcessingStatus.PENDING);
    expect(pending.renditions).toEqual([]);
    expect(pending.thumbnailUrl).toBeNull();

    // Move to COMPLETED with a full output set.
    metadata.setRenditions(
      record.id,
      RENDITION_LABELS.map((label) => ({
        uploadId: record.id,
        label,
        path: `renditions/${record.id}/${label}.mp4`,
        width: 1920,
        height: 1080,
      })),
    );
    metadata.updateUpload(record.id, {
      status: ProcessingStatus.COMPLETED,
      thumbnailPath: `thumbnails/${record.id}.jpg`,
    });

    const completed = resolver.videoMetadata(record.id);
    expect(completed.status).toBe(ProcessingStatus.COMPLETED);
    expect(completed.renditions).toHaveLength(RENDITION_LABELS.length);
    expect(completed.thumbnailUrl).toBe(`${FILES_ROUTE_PREFIX}/thumbnails/${record.id}.jpg`);
    expect(completed.renditions.every((r) => r.url.startsWith(`${FILES_ROUTE_PREFIX}/renditions/`))).toBe(
      true,
    );
  });
});
