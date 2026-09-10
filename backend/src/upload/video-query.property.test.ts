import * as fc from 'fast-check';
import {
  ProcessingStatus,
  Rendition,
  RENDITION_LABELS,
  TempSqliteMetadataStore,
  UploadRecord,
} from '@video-platform/shared';
import { GraphQLError } from 'graphql';
import { randomUUID } from 'crypto';
import { VideoQueryService } from './video-query.service';
import { FILES_ROUTE_PREFIX } from '../files/file-serving';

/*
 * Property tests for the read-side query service (`videos`, `videoStatus`, `videoMetadata`), run
 * directly against the shared temp-SQLite MetadataStore so no GraphQL/HTTP server is needed
 * (Properties 5, 6, 7, 8, 10). URL derivation and the "withhold until COMPLETED" rule are exercised
 * here; the file route itself is tested separately (Property 9 / unit tests).
 */

/** Every ProcessingStatus value, for generating records in any lifecycle state. */
const statusArb = fc.constantFrom(...Object.values(ProcessingStatus));

/** A non-empty, well-behaved original filename. */
const filenameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && !s.includes('\0'))
  .map((s) => `${s.trim()}.mp4`);

/** A generated Upload_Record spec (id + filename + status), independent of storage. */
const recordSpecArb = fc.record({
  originalFilename: filenameArb,
  status: statusArb,
});

/**
 * Insert an Upload_Record with the given status directly into the store. `createUpload` always
 * starts at PENDING, so non-PENDING states are reached via a follow-up `updateUpload`.
 */
function seedRecord(
  store: TempSqliteMetadataStore,
  spec: { originalFilename: string; status: ProcessingStatus },
): UploadRecord {
  const id = randomUUID();
  store.createUpload({
    id,
    originalFilename: spec.originalFilename,
    storedPath: `originals/${id}.mp4`,
  });
  if (spec.status !== ProcessingStatus.PENDING) {
    store.updateUpload(id, { status: spec.status });
  }
  return store.getUpload(id)!;
}

/** Build the full set of renditions + thumbnail path for a COMPLETED record. */
function seedCompletedOutputs(store: TempSqliteMetadataStore, id: string): void {
  const renditions: Rendition[] = RENDITION_LABELS.map((label, i) => ({
    uploadId: id,
    label,
    path: `renditions/${id}/${label}.mp4`,
    width: 3840 >> i,
    height: 2160 >> i,
  }));
  store.setRenditions(id, renditions);
  store.updateUpload(id, {
    status: ProcessingStatus.COMPLETED,
    thumbnailPath: `thumbnails/${id}.jpg`,
  });
}

describe('video query service properties', () => {
  let metadata: TempSqliteMetadataStore;
  let service: VideoQueryService;

  beforeEach(async () => {
    metadata = await TempSqliteMetadataStore.create();
    service = new VideoQueryService(metadata);
  });

  afterEach(async () => {
    await metadata.cleanup();
  });

  /*
   * Feature: video-upload-platform, Property 5: Listing returns every record with all required fields
   *
   * For any set of uploaded records, `videos` returns exactly those records, each carrying id,
   * originalFilename, uploadedAt, and status (Req 3.1, 3.2).
   *
   * Validates: Requirements 3.1, 3.2
   */
  it('Property 5: listing returns every record with all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(recordSpecArb, { minLength: 0, maxLength: 12 }), async (specs) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const runService = new VideoQueryService(runMeta);
          const seeded = specs.map((spec) => seedRecord(runMeta, spec));

          const listed = runService.listVideos();

          // Same set of ids, no more, no less.
          expect(new Set(listed.map((r) => r.id))).toEqual(new Set(seeded.map((r) => r.id)));
          expect(listed).toHaveLength(seeded.length);

          // Every listed record carries all four required fields with the stored values.
          const byId = new Map(seeded.map((r) => [r.id, r]));
          for (const record of listed) {
            const expected = byId.get(record.id)!;
            expect(record.originalFilename).toBe(expected.originalFilename);
            expect(record.status).toBe(expected.status);
            expect(typeof record.uploadedAt).toBe('string');
            expect(record.uploadedAt.length).toBeGreaterThan(0);
            // uploadedAt must be a valid timestamp.
            expect(Number.isNaN(Date.parse(record.uploadedAt))).toBe(false);
          }
        } finally {
          await runMeta.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 6: Status query is consistent with stored state
   *
   * For any record in any lifecycle state, `videoStatus(id)` returns exactly the stored status
   * (Req 3.3, 3.5).
   *
   * Validates: Requirements 3.3, 3.5
   */
  it('Property 6: status query returns the stored status', async () => {
    await fc.assert(
      fc.asyncProperty(recordSpecArb, async (spec) => {
        const record = seedRecord(metadata, spec);
        expect(service.getStatus(record.id)).toBe(spec.status);
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 7: Status query for a missing id errors
   *
   * For any id that has no Upload_Record, `videoStatus(id)` throws a descriptive GraphQL error
   * (Req 3.4).
   *
   * Validates: Requirements 3.4
   */
  it('Property 7: status query for a missing id errors', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (missingId) => {
        // Nothing is seeded, so any id is missing.
        expect(() => service.getStatus(missingId)).toThrow(GraphQLError);
        try {
          service.getStatus(missingId);
        } catch (err) {
          expect(err).toBeInstanceOf(GraphQLError);
          const gqlErr = err as GraphQLError;
          // Error is descriptive: names the missing id and carries a NOT_FOUND code.
          expect(gqlErr.message).toContain(missingId);
          expect(gqlErr.extensions?.code).toBe('NOT_FOUND');
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 8: Metadata for COMPLETED records is complete
   *
   * For any COMPLETED record with a full output set, `videoMetadata(id)` returns references to all
   * four renditions and the thumbnail, each as a backend file-route URL (Req 4.1, 4.2).
   *
   * Validates: Requirements 4.1, 4.2
   */
  it('Property 8: metadata for COMPLETED records includes all renditions and the thumbnail', async () => {
    await fc.assert(
      fc.asyncProperty(filenameArb, async (filename) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const runService = new VideoQueryService(runMeta);
          const record = seedRecord(runMeta, {
            originalFilename: filename,
            status: ProcessingStatus.PENDING,
          });
          seedCompletedOutputs(runMeta, record.id);

          const metadata = runService.getMetadata(record.id);

          expect(metadata.status).toBe(ProcessingStatus.COMPLETED);

          // All four rendition labels are present.
          expect(new Set(metadata.renditions.map((r) => r.label))).toEqual(
            new Set(RENDITION_LABELS),
          );
          // Each rendition URL is a backend file route pointing at this upload's rendition path.
          for (const r of metadata.renditions) {
            expect(r.url).toBe(`${FILES_ROUTE_PREFIX}/renditions/${record.id}/${r.label}.mp4`);
          }
          // Thumbnail reference present as a file-route URL.
          expect(metadata.thumbnailUrl).toBe(`${FILES_ROUTE_PREFIX}/thumbnails/${record.id}.jpg`);
        } finally {
          await runMeta.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 10: Metadata is withheld until COMPLETED
   *
   * For any record whose status is NOT COMPLETED, `videoMetadata(id)` returns the current status
   * with no rendition references and a null thumbnail, even if output rows happen to exist
   * (Req 4.5).
   *
   * Validates: Requirements 4.5
   */
  it('Property 10: metadata is withheld until COMPLETED', async () => {
    const nonCompleted = fc.constantFrom(
      ProcessingStatus.PENDING,
      ProcessingStatus.PROCESSING,
      ProcessingStatus.FAILED,
    );

    await fc.assert(
      fc.asyncProperty(filenameArb, nonCompleted, async (filename, status) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const runService = new VideoQueryService(runMeta);
          const record = seedRecord(runMeta, { originalFilename: filename, status });
          // Even if renditions/thumbnail rows exist, they must NOT be exposed pre-COMPLETED.
          runMeta.setRenditions(record.id, [
            {
              uploadId: record.id,
              label: '1080p',
              path: `renditions/${record.id}/1080p.mp4`,
              width: 1920,
              height: 1080,
            },
          ]);
          runMeta.updateUpload(record.id, { thumbnailPath: `thumbnails/${record.id}.jpg` });

          const metadata = runService.getMetadata(record.id);

          expect(metadata.status).toBe(status);
          expect(metadata.renditions).toHaveLength(0);
          expect(metadata.thumbnailUrl).toBeNull();
        } finally {
          await runMeta.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
