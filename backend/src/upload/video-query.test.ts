import {
  ProcessingStatus,
  Rendition,
  RENDITION_LABELS,
  TempSqliteMetadataStore,
} from '@video-platform/shared';
import { GraphQLError } from 'graphql';
import { randomUUID } from 'crypto';
import { VideoQueryService } from './video-query.service';
import { FILES_ROUTE_PREFIX } from '../files/file-serving';

/*
 * Unit tests for the read-side query service backing `videos`/`videoStatus`/`videoMetadata`.
 * These cover concrete examples and edge cases (empty listing, unknown id, COMPLETED completeness,
 * withholding pre-COMPLETED) complementing the property tests.
 */

describe('VideoQueryService (unit)', () => {
  let metadata: TempSqliteMetadataStore;
  let service: VideoQueryService;

  beforeEach(async () => {
    metadata = await TempSqliteMetadataStore.create();
    service = new VideoQueryService(metadata);
  });

  afterEach(async () => {
    await metadata.cleanup();
  });

  function seed(status: ProcessingStatus, filename = 'clip.mp4'): string {
    const id = randomUUID();
    metadata.createUpload({ id, originalFilename: filename, storedPath: `originals/${id}.mp4` });
    if (status !== ProcessingStatus.PENDING) {
      metadata.updateUpload(id, { status });
    }
    return id;
  }

  it('listVideos returns an empty array when there are no records', () => {
    expect(service.listVideos()).toEqual([]);
  });

  it('listVideos returns every record with all required fields', () => {
    const a = seed(ProcessingStatus.PENDING, 'a.mp4');
    const b = seed(ProcessingStatus.COMPLETED, 'b.mp4');

    const listed = service.listVideos();
    expect(listed).toHaveLength(2);
    const ids = listed.map((r) => r.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    for (const r of listed) {
      expect(r.originalFilename).toMatch(/\.mp4$/);
      expect(r.uploadedAt).toBeTruthy();
      expect(Object.values(ProcessingStatus)).toContain(r.status);
    }
  });

  it('getStatus returns the stored status for a valid id', () => {
    const id = seed(ProcessingStatus.PROCESSING);
    expect(service.getStatus(id)).toBe(ProcessingStatus.PROCESSING);
  });

  it('getStatus throws a descriptive NOT_FOUND error for an unknown id', () => {
    expect(() => service.getStatus('does-not-exist')).toThrow(GraphQLError);
    try {
      service.getStatus('does-not-exist');
    } catch (err) {
      const gqlErr = err as GraphQLError;
      expect(gqlErr.message).toContain('does-not-exist');
      expect(gqlErr.extensions?.code).toBe('NOT_FOUND');
    }
  });

  it('getMetadata returns all renditions and the thumbnail for a COMPLETED record', () => {
    const id = seed(ProcessingStatus.PENDING);
    const renditions: Rendition[] = RENDITION_LABELS.map((label) => ({
      uploadId: id,
      label,
      path: `renditions/${id}/${label}.mp4`,
      width: 1920,
      height: 1080,
    }));
    metadata.setRenditions(id, renditions);
    metadata.updateUpload(id, {
      status: ProcessingStatus.COMPLETED,
      thumbnailPath: `thumbnails/${id}.jpg`,
    });

    const meta = service.getMetadata(id);
    expect(meta.status).toBe(ProcessingStatus.COMPLETED);
    expect(meta.renditions).toHaveLength(RENDITION_LABELS.length);
    expect(meta.thumbnailUrl).toBe(`${FILES_ROUTE_PREFIX}/thumbnails/${id}.jpg`);
    for (const r of meta.renditions) {
      expect(r.url).toBe(`${FILES_ROUTE_PREFIX}/renditions/${id}/${r.label}.mp4`);
    }
  });

  it('getMetadata withholds refs and returns null thumbnail when not COMPLETED', () => {
    const id = seed(ProcessingStatus.PROCESSING);
    metadata.setRenditions(id, [
      { uploadId: id, label: '720p', path: `renditions/${id}/720p.mp4`, width: 1280, height: 720 },
    ]);
    metadata.updateUpload(id, { thumbnailPath: `thumbnails/${id}.jpg` });

    const meta = service.getMetadata(id);
    expect(meta.status).toBe(ProcessingStatus.PROCESSING);
    expect(meta.renditions).toEqual([]);
    expect(meta.thumbnailUrl).toBeNull();
  });

  it('getMetadata throws NOT_FOUND for an unknown id', () => {
    expect(() => service.getMetadata('missing')).toThrow(GraphQLError);
  });
});
