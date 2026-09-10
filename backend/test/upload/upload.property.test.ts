import * as fc from 'fast-check';
import {
  ProcessingStatus,
  TempDirStorage,
  TempSqliteMetadataStore,
} from '@video-platform/shared';
import { InvalidMp4Error } from '../../src/mp4-validation';
import { ORIGINALS_DIR, UploadService } from '../../src/upload/upload.service';
import {
  makeFtypBuffer,
  makeUpload,
  StubInvalidProbe,
  StubValidProbe,
} from './upload.test-helpers';

/*
 * Property tests for the upload SERVICE layer (validation + streaming write + record creation),
 * run directly against the shared temp-dir Storage + temp-SQLite MetadataStore so no cluster or
 * GraphQL/HTTP server is needed. The `ffprobe` probe is injected as a deterministic stub; the real
 * ffprobe integration is exercised by the 4K unit test.
 */

/** A non-empty, well-behaved filename fragment for generated uploads. */
const filenameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\0'))
  .map((s) => `${s}.mp4`);

/** Arbitrary trailing payload appended after a valid ftyp box. */
const trailingArb = fc.uint8Array({ minLength: 0, maxLength: 4096 }).map((u) => Buffer.from(u));

describe('upload service properties', () => {
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
   * Feature: video-upload-platform, Property 2: Upload creates a PENDING record and stores the file
   *
   * For any valid MP4 upload, the service writes the bytes to `originals/<id>.mp4` and creates an
   * Upload_Record with status PENDING whose storedPath points at the written file.
   *
   * Validates: Requirements 2.2
   */
  it('Property 2: a valid upload stores the file and creates a PENDING record', async () => {
    const service = new UploadService(storage, metadata, new StubValidProbe());

    await fc.assert(
      fc.asyncProperty(filenameArb, trailingArb, async (filename, trailing) => {
        const content = makeFtypBuffer(trailing);
        const record = await service.handleUpload(makeUpload(filename, content));

        // Record shape and status.
        expect(record.status).toBe(ProcessingStatus.PENDING);
        expect(record.originalFilename).toBe(filename);
        expect(record.storedPath).toBe(`${ORIGINALS_DIR}/${record.id}.mp4`);

        // Persisted in the metadata store as PENDING.
        const stored = metadata.getUpload(record.id);
        expect(stored).not.toBeNull();
        expect(stored?.status).toBe(ProcessingStatus.PENDING);

        // File written to disk with byte-identical content.
        expect(await storage.exists(record.storedPath)).toBe(true);
        const written = await storage.read(record.storedPath);
        expect(written.equals(content)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 3: Upload identifiers are unique
   *
   * Across many uploads, every returned identifier is unique (Req 2.3).
   *
   * Validates: Requirements 2.3
   */
  it('Property 3: upload identifiers are unique', async () => {
    const service = new UploadService(storage, metadata, new StubValidProbe());

    await fc.assert(
      fc.asyncProperty(
        fc.array(filenameArb, { minLength: 2, maxLength: 8 }),
        async (filenames) => {
          const ids: string[] = [];
          for (const filename of filenames) {
            const record = await service.handleUpload(
              makeUpload(filename, makeFtypBuffer()),
            );
            ids.push(record.id);
          }
          // No duplicates within this batch.
          expect(new Set(ids).size).toBe(ids.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 4: Invalid uploads are rejected
   *
   * For any file that fails either the magic-byte check (missing ftyp box) or the container/codec
   * probe, the service throws InvalidMp4Error, creates NO Upload_Record, and leaves NO file behind
   * (Req 2.4).
   *
   * Validates: Requirements 2.4
   */
  it('Property 4: invalid uploads are rejected with no record and no leftover file', async () => {
    await fc.assert(
      fc.asyncProperty(
        filenameArb,
        // Two independent ways to be invalid: (a) bad magic bytes, (b) probe rejects.
        fc.record({
          // When true, bytes lack a ftyp box so the magic-byte check fails first.
          badMagic: fc.boolean(),
          payload: fc.uint8Array({ minLength: 0, maxLength: 512 }).map((u) => Buffer.from(u)),
        }),
        async (filename, { badMagic, payload }) => {
          // Fresh isolated stores per run so the "no leftover" assertion is exact.
          const runStorage = await TempDirStorage.create();
          const runMeta = await TempSqliteMetadataStore.create();
          try {
            // If badMagic, use a buffer that does NOT start with a ftyp box (probe would be valid but
            // is never reached). Otherwise use a valid ftyp buffer but a probe that rejects it.
            const probe = badMagic ? new StubValidProbe() : new StubInvalidProbe();
            const content = badMagic
              ? Buffer.concat([Buffer.from('NOTAFTYPBOX!!'), payload])
              : makeFtypBuffer(payload);
            const service = new UploadService(runStorage, runMeta, probe);

            await expect(service.handleUpload(makeUpload(filename, content))).rejects.toBeInstanceOf(
              InvalidMp4Error,
            );

            // No record created.
            expect(runMeta.listUploads()).toHaveLength(0);

            // No file left behind under originals/.
            const originalsExists = await runStorage.exists(ORIGINALS_DIR);
            if (originalsExists) {
              const { promises: fsp } = await import('fs');
              const path = await import('path');
              const entries = await fsp.readdir(path.join(runStorage.baseDir, ORIGINALS_DIR));
              expect(entries).toHaveLength(0);
            }
          } finally {
            await runMeta.cleanup();
            await runStorage.cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
