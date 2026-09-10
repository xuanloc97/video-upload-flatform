import { GraphQLError } from 'graphql';
import {
  ProcessingStatus,
  TempDirStorage,
  TempSqliteMetadataStore,
} from '@video-platform/shared';
import { fileRouteUrl } from '../../src/files/file-route';
import { makeResolver } from './upload.test-helpers';
import { UploadResolver } from '../../src/upload/upload.resolver';

/*
 * Unit tests confirming the existence and shape of the query/mutation resolvers wired in Tasks 4–5
 * (`uploadVideo`, `videos`, `videoStatus`, `videoMetadata`). These drive the resolver directly over
 * temp-dir Storage + temp-SQLite MetadataStore — no HTTP/GraphQL server needed (Reqs 2.1, 3.1).
 */

describe('UploadResolver query/mutation shape (Reqs 2.1, 3.1)', () => {
  let storage: TempDirStorage;
  let metadata: TempSqliteMetadataStore;
  let resolver: UploadResolver;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    metadata = await TempSqliteMetadataStore.create();
    resolver = makeResolver(storage, metadata);
  });

  afterEach(async () => {
    await metadata.cleanup();
    await storage.cleanup();
  });

  it('exposes uploadVideo, videos, videoStatus, and videoMetadata as functions', () => {
    expect(typeof resolver.uploadVideo).toBe('function');
    expect(typeof resolver.videos).toBe('function');
    expect(typeof resolver.videoStatus).toBe('function');
    expect(typeof resolver.videoMetadata).toBe('function');
  });

  it('videos returns [] when nothing has been uploaded', () => {
    expect(resolver.videos()).toEqual([]);
  });

  it('videos returns each record with id, originalFilename, uploadedAt (Date), and status', () => {
    metadata.createUpload({ id: 'a', originalFilename: 'a.mp4', storedPath: 'originals/a.mp4' });
    metadata.createUpload({ id: 'b', originalFilename: 'b.mp4', storedPath: 'originals/b.mp4' });

    const listed = resolver.videos();
    expect(listed).toHaveLength(2);
    const a = listed.find((r) => r.id === 'a')!;
    expect(a.originalFilename).toBe('a.mp4');
    expect(a.uploadedAt).toBeInstanceOf(Date);
    expect(a.status).toBe(ProcessingStatus.PENDING);
  });

  it('videoStatus returns the stored status for a known id', () => {
    metadata.createUpload({ id: 'x', originalFilename: 'x.mp4', storedPath: 'originals/x.mp4' });
    expect(resolver.videoStatus('x')).toBe(ProcessingStatus.PENDING);
    metadata.updateUpload('x', { status: ProcessingStatus.COMPLETED });
    expect(resolver.videoStatus('x')).toBe(ProcessingStatus.COMPLETED);
  });

  it('videoStatus throws a descriptive GraphQLError for an unknown id', () => {
    expect(() => resolver.videoStatus('nope')).toThrow(GraphQLError);
    expect(() => resolver.videoStatus('nope')).toThrow(/nope/);
  });

  it('videoMetadata withholds refs (empty renditions, null thumbnail) while not COMPLETED', () => {
    metadata.createUpload({ id: 'p', originalFilename: 'p.mp4', storedPath: 'originals/p.mp4' });
    metadata.setRenditions('p', [
      { uploadId: 'p', label: '720p', path: 'renditions/p/720p.mp4', width: 1280, height: 720 },
    ]);
    metadata.updateUpload('p', {
      status: ProcessingStatus.PROCESSING,
      thumbnailPath: 'thumbnails/p.jpg',
    });

    const meta = resolver.videoMetadata('p');
    expect(meta.status).toBe(ProcessingStatus.PROCESSING);
    expect(meta.renditions).toEqual([]);
    expect(meta.thumbnailUrl).toBeNull();
  });

  it('videoMetadata returns produced renditions + thumbnail URLs once COMPLETED', () => {
    metadata.createUpload({ id: 'c', originalFilename: 'c.mp4', storedPath: 'originals/c.mp4' });
    metadata.setRenditions('c', [
      { uploadId: 'c', label: '1080p', path: 'renditions/c/1080p.mp4', width: 1920, height: 1080 },
      { uploadId: 'c', label: '480p', path: 'renditions/c/480p.mp4', width: 854, height: 480 },
    ]);
    metadata.updateUpload('c', {
      status: ProcessingStatus.COMPLETED,
      thumbnailPath: 'thumbnails/c.jpg',
    });

    const meta = resolver.videoMetadata('c');
    expect(meta.status).toBe(ProcessingStatus.COMPLETED);
    expect(meta.renditions.map((r) => r.label).sort()).toEqual(['1080p', '480p']);
    const r1080 = meta.renditions.find((r) => r.label === '1080p')!;
    expect(r1080.url).toBe(fileRouteUrl('renditions/c/1080p.mp4'));
    expect(r1080.width).toBe(1920);
    expect(r1080.height).toBe(1080);
    expect(meta.thumbnailUrl).toBe(fileRouteUrl('thumbnails/c.jpg'));
  });

  it('videoMetadata throws a descriptive GraphQLError for an unknown id', () => {
    expect(() => resolver.videoMetadata('ghost')).toThrow(GraphQLError);
    expect(() => resolver.videoMetadata('ghost')).toThrow(/ghost/);
  });
});
