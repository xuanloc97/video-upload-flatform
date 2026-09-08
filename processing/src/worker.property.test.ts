import { promises as fs } from 'fs';
import * as path from 'path';
import * as fc from 'fast-check';
import { ProcessingStatus, TempDirStorage } from '@video-platform/shared';
import { ClaimedJob } from './backend-client';
import { planRenditions } from './rendition-plan';
import {
  ProcessingWorker,
  ORIGINALS_DIR,
  RENDITIONS_DIR,
  THUMBNAILS_DIR,
  TMP_DIR,
} from './worker';
import { StubBackendClient, StubTranscoder } from './worker.test-helpers';

/*
 * Property tests for the ProcessingWorker job pipeline, run against the shared temp-dir Storage with
 * a stubbed FFmpeg (StubTranscoder) so they are fast and deterministic — the real FFmpeg path is
 * covered by a separate integration pass. These validate the completion/failure/idempotence
 * contracts (Properties 13–15, 18) without a cluster or a live backend.
 */

/** Common 16:9 source dimensions to exercise the full and partial rendition ladders. */
const dimsArb = fc.constantFrom(
  { width: 3840, height: 2160 }, // 4K -> all four
  { width: 1920, height: 1080 }, // -> 1080p/720p/480p
  { width: 1280, height: 720 }, // -> 720p/480p
  { width: 854, height: 480 }, // -> 480p
  { width: 640, height: 360 }, // -> source fallback
);

/** Seed a placeholder original file for `id` in `storage` and return the claimed job. */
async function seedOriginal(storage: TempDirStorage, id: string): Promise<ClaimedJob> {
  const rel = path.posix.join(ORIGINALS_DIR, `${id}.mp4`);
  await storage.write(rel, `fake-mp4-bytes-for-${id}`);
  return { id, storedPath: rel };
}

describe('ProcessingWorker properties', () => {
  /*
   * Feature: video-upload-platform, Property 13: Successful processing produces a complete output set
   *
   * For any source, a successful run writes exactly the planned renditions into renditions/<id>/ and
   * a thumbnail at thumbnails/<id>.jpg, leaves no tmp/<id>/ behind, and preserves the original.
   *
   * Validates: Requirements 6.2, 6.3
   */
  it('Property 13: a successful run writes the full planned rendition set + thumbnail', async () => {
    await fc.assert(
      fc.asyncProperty(dimsArb, async (dims) => {
        const storage = await TempDirStorage.create();
        try {
          const id = 'job-13';
          const job = await seedOriginal(storage, id);
          const backend = new StubBackendClient();
          const worker = new ProcessingWorker(storage, new StubTranscoder(dims), backend);

          await worker.processJob(job);

          const expected = planRenditions(dims.width, dims.height);

          // Each planned rendition file exists under renditions/<id>/.
          for (const r of expected) {
            const rel = path.posix.join(RENDITIONS_DIR, id, `${r.label.toLowerCase()}.mp4`);
            expect(await storage.exists(rel)).toBe(true);
          }
          // Exactly the planned count, no extras.
          const dir = path.join(storage.baseDir, RENDITIONS_DIR, id);
          const entries = await fs.readdir(dir);
          expect(entries).toHaveLength(expected.length);

          // Thumbnail present, tmp cleaned, original preserved.
          expect(await storage.exists(path.posix.join(THUMBNAILS_DIR, `${id}.jpg`))).toBe(true);
          expect(await storage.exists(path.posix.join(TMP_DIR, id))).toBe(false);
          expect(await storage.exists(job.storedPath)).toBe(true);
        } finally {
          await storage.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 14: Output completeness implies COMPLETED
   *
   * Whenever the full output set is written, the worker reports COMPLETED with rendition refs that
   * match the files on disk and a thumbnail reference.
   *
   * Validates: Requirements 6.4
   */
  it('Property 14: a complete output set is reported as COMPLETED with matching refs', async () => {
    await fc.assert(
      fc.asyncProperty(dimsArb, async (dims) => {
        const storage = await TempDirStorage.create();
        try {
          const id = 'job-14';
          const job = await seedOriginal(storage, id);
          const backend = new StubBackendClient();
          const worker = new ProcessingWorker(storage, new StubTranscoder(dims), backend);

          await worker.processJob(job);

          const result = backend.resultFor(id);
          expect(result).toBeDefined();
          expect(result!.status).toBe(ProcessingStatus.COMPLETED);
          expect(result!.thumbnailPath).toBe(path.posix.join(THUMBNAILS_DIR, `${id}.jpg`));

          const expected = planRenditions(dims.width, dims.height);
          expect(result!.renditions).toHaveLength(expected.length);
          // Every reported ref points at a file that actually exists.
          for (const ref of result!.renditions ?? []) {
            expect(await storage.exists(ref.path)).toBe(true);
          }
          expect(result!.error).toBeUndefined();
        } finally {
          await storage.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 15: Processing failure implies FAILED
   *
   * If any step (probe, a rendition, or the thumbnail) fails, the worker reports FAILED with an
   * error, leaves no partial output under the final rendition/thumbnail paths, and preserves the
   * original.
   *
   * Validates: Requirements 6.5
   */
  it('Property 15: any transcode failure is reported as FAILED with no partial final output', async () => {
    const failStepArb = fc.constantFrom<'probe' | 'rendition' | 'thumbnail'>(
      'probe',
      'rendition',
      'thumbnail',
    );

    await fc.assert(
      fc.asyncProperty(dimsArb, failStepArb, async (dims, failOn) => {
        const storage = await TempDirStorage.create();
        try {
          const id = 'job-15';
          const job = await seedOriginal(storage, id);
          const backend = new StubBackendClient();
          const worker = new ProcessingWorker(
            storage,
            new StubTranscoder(dims, failOn),
            backend,
          );

          await worker.processJob(job);

          const result = backend.resultFor(id);
          expect(result).toBeDefined();
          expect(result!.status).toBe(ProcessingStatus.FAILED);
          expect(result!.error).toBeTruthy();

          // No completed rendition dir, no thumbnail, no leftover tmp; original intact.
          expect(await storage.exists(path.posix.join(RENDITIONS_DIR, id))).toBe(false);
          expect(await storage.exists(path.posix.join(THUMBNAILS_DIR, `${id}.jpg`))).toBe(false);
          expect(await storage.exists(path.posix.join(TMP_DIR, id))).toBe(false);
          expect(await storage.exists(job.storedPath)).toBe(true);
        } finally {
          await storage.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 18: Retry produces an equivalent output set (idempotence)
   *
   * Running the pipeline twice for the same job (e.g. after a stuck-job re-queue or manual retry)
   * yields the same set of rendition files and a thumbnail, with no stale files from the first run.
   *
   * Validates: Requirements 7.3
   */
  it('Property 18: reprocessing the same job reproduces an equivalent output set', async () => {
    await fc.assert(
      fc.asyncProperty(dimsArb, async (dims) => {
        const storage = await TempDirStorage.create();
        try {
          const id = 'job-18';
          const job = await seedOriginal(storage, id);
          const backend = new StubBackendClient();
          const worker = new ProcessingWorker(storage, new StubTranscoder(dims), backend);

          await worker.processJob(job);
          const firstDir = path.join(storage.baseDir, RENDITIONS_DIR, id);
          const first = (await fs.readdir(firstDir)).sort();

          // Second run (retry) over the same id.
          await worker.processJob(job);
          const second = (await fs.readdir(firstDir)).sort();

          // Same file set, no accumulation of stale files.
          expect(second).toEqual(first);
          expect(await storage.exists(path.posix.join(THUMBNAILS_DIR, `${id}.jpg`))).toBe(true);
          expect(await storage.exists(path.posix.join(TMP_DIR, id))).toBe(false);

          // Both runs reported COMPLETED.
          const completed = backend.results.filter(
            (r) => r.id === id && r.status === ProcessingStatus.COMPLETED,
          );
          expect(completed).toHaveLength(2);
        } finally {
          await storage.cleanup();
        }
      }),
      { numRuns: 50 },
    );
  });
});
