import * as fc from 'fast-check';
import { FileSystemStorage, TempDirStorage } from '../src/storage';

/*
 * Feature: video-upload-platform, Property 1: Storage round-trip
 *
 * For any file content written to `/uploads` by one component, reading that same path from another
 * component returns byte-identical content.
 *
 * Validates: Requirements 1.3, 1.5
 *
 * The round-trip is modelled across two *independent* FileSystemStorage handles pointed at the same
 * base directory: one handle writes (simulating the Backend / Processing_Component writer) and a
 * separate handle reads (simulating the other component). Exercising both directions confirms
 * 1.3 (backend writes → processing reads) and 1.5 (processing writes → backend reads).
 */

/**
 * Generates a safe path segment: non-empty, no path separators, no traversal, no NUL bytes, and
 * not a reserved relative name so it always stays inside the storage base directory.
 */
const segmentArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter(
    (s) =>
      s.length > 0 &&
      !s.includes('/') &&
      !s.includes('\\') &&
      !s.includes('\0') &&
      s !== '.' &&
      s !== '..' &&
      // avoid leading/trailing whitespace or dots that some filesystems normalize away
      s.trim() === s &&
      !s.endsWith('.'),
  );

/** Generates a safe multi-segment relative path (e.g. `originals/a.mp4`, `renditions/x/720p.mp4`). */
const relativePathArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join('/'));

/**
 * Generates arbitrary binary content, explicitly including the empty buffer and larger buffers so
 * edge cases (empty file, sizeable payload) are covered.
 */
const contentArb = fc.oneof(
  fc.constant(Buffer.alloc(0)),
  fc.uint8Array({ minLength: 0, maxLength: 4096 }).map((u) => Buffer.from(u)),
  fc.uint8Array({ minLength: 1, maxLength: 64 * 1024 }).map((u) => Buffer.from(u)),
);

describe('Property 1: Storage round-trip', () => {
  let storage: TempDirStorage;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
  });

  afterEach(async () => {
    await storage.cleanup();
  });

  it('reads back byte-identical content across independent storage handles (both directions)', async () => {
    const baseDir = storage.baseDir;

    await fc.assert(
      fc.asyncProperty(
        relativePathArb,
        contentArb,
        contentArb,
        fc.boolean(),
        async (relativePath, forwardContent, reverseContent, forwardFirst) => {
          // Two independent handles rooted at the same base dir: one acts as the writer, the other
          // as the reader, so we verify cross-handle (cross-component) round-trip equality.
          const writer = new FileSystemStorage(baseDir);
          const reader = new FileSystemStorage(baseDir);

          // Direction A (Req 1.3): writer (Backend) writes, reader (Processing) reads it back.
          const forwardPath = forwardFirst ? relativePath : `dirA/${relativePath}`;
          await writer.write(forwardPath, forwardContent);
          const forwardRead = await reader.read(forwardPath);
          expect(forwardRead.equals(forwardContent)).toBe(true);

          // Direction B (Req 1.5): the roles swap — the other handle writes and the first reads it
          // back — confirming the reverse Processing → Backend direction on a distinct path.
          const reversePath = forwardFirst ? `dirB/${relativePath}` : relativePath;
          await reader.write(reversePath, reverseContent);
          const reverseRead = await writer.read(reversePath);
          expect(reverseRead.equals(reverseContent)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
