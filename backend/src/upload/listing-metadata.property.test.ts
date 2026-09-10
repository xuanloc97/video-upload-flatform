import * as fc from 'fast-check';
import { GraphQLError } from 'graphql';
import {
  ProcessingStatus,
  Rendition,
  RENDITION_LABELS,
  RenditionLabel,
  TempDirStorage,
  TempSqliteMetadataStore,
  UploadRecord,
} from '@video-platform/shared';
import { fileRouteUrl } from '../files/file-route';
import { makeResolver } from './upload.test-helpers';

/*
 * Property tests for the listing / status / metadata QUERY resolvers (Task 5.1 + 5.2), run directly
 * against the shared temp-dir Storage + temp-SQLite MetadataStore so no cluster or GraphQL/HTTP
 * server is needed. The resolver is constructed with a probe stub that accepts everything; these
 * tests never call `uploadVideo`, they seed records straight through the metadata store so a broad
 * space of statuses/renditions can be generated.
 */

/** All four processing statuses, generated uniformly. */
const statusArb: fc.Arbitrary<ProcessingStatus> = fc.constantFrom(
  ProcessingStatus.PENDING,
  ProcessingStatus.PROCESSING,
  ProcessingStatus.COMPLETED,
  ProcessingStatus.FAILED,
);

/** A well-behaved, non-empty original filename. */
const filenameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && !s.includes('\0'))
  .map((s) => `${s.trim()}.mp4`);

/** A single seed record description: filename + eventual status. */
interface SeedSpec {
  filename: string;
  status: ProcessingStatus;
}

const seedSpecArb: fc.Arbitrary<SeedSpec> = fc.record({
  filename: filenameArb,
  status: statusArb,
});

/** A non-empty subset of the rendition labels, modelling downscale-only "renditions that exist". */
const renditionLabelsArb: fc.Arbitrary<RenditionLabel[]> = fc
  .subarray(RENDITION_LABELS as RenditionLabel[], { minLength: 1 })
  .map((labels) => [...labels]);

/** Seed one Upload_Record at `spec.status` (created PENDING then patched) and return it. */
function seedRecord(metadata: TempSqliteMetadataStore, id: string, spec: SeedSpec): UploadRecord {
  metadata.createUpload({ id, originalFilename: spec.filename, storedPath: `originals/${id}.mp4` });
  if (spec.status === ProcessingStatus.PENDING) {
    return metadata.getUpload(id)!;
  }
  return metadata.updateUpload(id, { status: spec.status });
}

describe('listing / status / metadata query resolver properties', () => {
  let storage: TempDirStorage;
  let metadata: TempSqliteMetadataStore;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    metadata = await TempSqliteMetadataStore.create();
  });

  afterEach(async () => {
    await metadata.cleanup();
    await storage.cleanup();
  });

  /*
   * Feature: video-upload-platform, Property 5: Listing returns every record with all required fields
   *
   * For any set of seeded uploads, `videos` returns exactly one entry per record, and every entry
   * carries the id, original filename, upload timestamp, and status matching what is stored — no
   * records dropped, none invented (Reqs 3.1, 3.2).
   *
   * Validates: Requirements 3.1, 3.2
   */
  it('Property 5: videos lists every record with all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(seedSpecArb, { maxLength: 12 }), async (specs) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const resolver = makeResolver(storage, runMeta);

          const expected = new Map<string, SeedSpec>();
          specs.forEach((spec, i) => {
            const id = `id-${i}`;
            seedRecord(runMeta, id, spec);
            expected.set(id, spec);
          });

          const listed = resolver.videos();

          // Same cardinality: exactly one entry per seeded record.
          expect(listed).toHaveLength(expected.size);

          // Every listed entry matches a stored record on all required fields (Req 3.2).
          const listedIds = new Set<string>();
          for (const entry of listed) {
            listedIds.add(entry.id);
            const spec = expected.get(entry.id);
            expect(spec).toBeDefined();
            expect(entry.originalFilename).toBe(spec!.filename);
            expect(entry.status).toBe(spec!.status);
            // Timestamp is a real Date backed by the stored ISO string.
            expect(entry.uploadedAt).toBeInstanceOf(Date);
            const stored = runMeta.getUpload(entry.id)!;
            expect(entry.uploadedAt.toISOString()).toBe(new Date(stored.uploadedAt).toISOString());
          }

          // Every seeded id appears (nothing dropped).
          for (const id of expected.keys()) {
            expect(listedIds.has(id)).toBe(true);
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
   * For any record at any status, `videoStatus(id)` returns exactly the stored status — including
   * COMPLETED, which is simply the stored terminal state (Reqs 3.3, 3.5).
   *
   * Validates: Requirements 3.3, 3.5
   */
  it('Property 6: videoStatus mirrors the stored status', async () => {
    await fc.assert(
      fc.asyncProperty(seedSpecArb, async (spec) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const resolver = makeResolver(storage, runMeta);
          const id = 'the-id';
          const record = seedRecord(runMeta, id, spec);

          expect(resolver.videoStatus(id)).toBe(record.status);
          expect(resolver.videoStatus(id)).toBe(spec.status);
        } finally {
          await runMeta.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 7: Status query for a missing id errors
   *
   * For any id that was never seeded, `videoStatus` throws a descriptive GraphQLError rather than
   * returning a bogus status (Req 3.4).
   *
   * Validates: Requirements 3.4
   */
  it('Property 7: videoStatus for an unknown id throws a descriptive error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        async (missingId) => {
          const runMeta = await TempSqliteMetadataStore.create();
          try {
            const resolver = makeResolver(storage, runMeta);
            // Nothing seeded: any id is unknown.
            let thrown: unknown;
            try {
              resolver.videoStatus(missingId);
            } catch (err) {
              thrown = err;
            }
            expect(thrown).toBeInstanceOf(GraphQLError);
            // Descriptive: mentions the offending id.
            expect((thrown as GraphQLError).message).toContain(missingId);
          } finally {
            await runMeta.cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 8: Metadata for COMPLETED records is complete
   *
   * For a COMPLETED record with a set of produced renditions and a thumbnail, `videoMetadata`
   * returns exactly those renditions (each with a backend file-route URL matching its stored path)
   * plus the thumbnail URL (Reqs 4.1, 4.2). Downscale-only: only renditions that exist are
   * returned.
   *
   * Validates: Requirements 4.1, 4.2
   */
  it('Property 8: metadata for a COMPLETED record returns every produced rendition and the thumbnail', async () => {
    await fc.assert(
      fc.asyncProperty(renditionLabelsArb, async (labels) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const resolver = makeResolver(storage, runMeta);
          const id = 'done';
          runMeta.createUpload({
            id,
            originalFilename: 'clip.mp4',
            storedPath: `originals/${id}.mp4`,
          });

          const renditions: Rendition[] = labels.map((label) => ({
            uploadId: id,
            label,
            path: `renditions/${id}/${label}.mp4`,
            width: 100,
            height: 100,
          }));
          runMeta.setRenditions(id, renditions);
          const thumbnailPath = `thumbnails/${id}.jpg`;
          runMeta.updateUpload(id, {
            status: ProcessingStatus.COMPLETED,
            thumbnailPath,
          });

          const meta = resolver.videoMetadata(id);

          expect(meta.status).toBe(ProcessingStatus.COMPLETED);
          expect(meta.id).toBe(id);

          // Every produced rendition is present with the correct label + file-route URL (Req 4.1).
          expect(meta.renditions).toHaveLength(labels.length);
          const byLabel = new Map(meta.renditions.map((r) => [r.label, r]));
          for (const label of labels) {
            const r = byLabel.get(label);
            expect(r).toBeDefined();
            expect(r!.url).toBe(fileRouteUrl(`renditions/${id}/${label}.mp4`));
          }

          // Thumbnail reference is present with the correct file-route URL (Req 4.2).
          expect(meta.thumbnailUrl).toBe(fileRouteUrl(thumbnailPath));
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
   * For any NON-COMPLETED record — even one that (defensively) has rendition rows and a thumbnail
   * path recorded — `videoMetadata` returns the current status with an EMPTY renditions list and a
   * null thumbnailUrl. References are only exposed once processing is COMPLETED (Req 4.5).
   *
   * Validates: Requirements 4.5
   */
  it('Property 10: metadata is withheld (no refs) until the record is COMPLETED', async () => {
    const nonCompletedArb = fc.constantFrom(
      ProcessingStatus.PENDING,
      ProcessingStatus.PROCESSING,
      ProcessingStatus.FAILED,
    );

    await fc.assert(
      fc.asyncProperty(nonCompletedArb, renditionLabelsArb, async (status, labels) => {
        const runMeta = await TempSqliteMetadataStore.create();
        try {
          const resolver = makeResolver(storage, runMeta);
          const id = 'not-done';
          runMeta.createUpload({
            id,
            originalFilename: 'clip.mp4',
            storedPath: `originals/${id}.mp4`,
          });

          // Defensively seed refs that MUST still be withheld while not COMPLETED.
          runMeta.setRenditions(
            id,
            labels.map((label) => ({
              uploadId: id,
              label,
              path: `renditions/${id}/${label}.mp4`,
              width: 100,
              height: 100,
            })),
          );
          runMeta.updateUpload(id, { status, thumbnailPath: `thumbnails/${id}.jpg` });

          const meta = resolver.videoMetadata(id);

          expect(meta.status).toBe(status);
          expect(meta.renditions).toEqual([]);
          expect(meta.thumbnailUrl).toBeNull();
        } finally {
          await runMeta.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
