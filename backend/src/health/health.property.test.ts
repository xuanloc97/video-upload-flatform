import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fc from 'fast-check';
import { HealthCheckError } from '@nestjs/terminus';
import { Storage, TempDirStorage } from '@video-platform/shared';
import { UploadsHealthIndicator } from './uploads.health';

/*
 * Property test for the backend readiness health check against the shared `/uploads` volume.
 *
 * Runs directly against the shared temp-dir Storage abstraction (task 1.2) and a tiny in-file
 * `Storage` stub whose only relevant field is `baseDir`, so no cluster, GraphQL/HTTP server, or
 * live NFS mount is needed. `UploadsHealthIndicator.isHealthy()` only reads `storage.baseDir` and
 * probes it with a real write/delete, which is exactly the behavior under test.
 */

/**
 * Minimal Storage whose `baseDir` points at an arbitrary (possibly unreachable) location. The
 * health indicator never calls the read/write/exists/move methods, so they throw to make any
 * accidental use obvious.
 */
class BaseDirOnlyStorage implements Storage {
  constructor(readonly baseDir: string) {}
  write(): Promise<void> {
    throw new Error('not used by health indicator');
  }
  read(): Promise<Buffer> {
    throw new Error('not used by health indicator');
  }
  exists(): Promise<boolean> {
    throw new Error('not used by health indicator');
  }
  move(): Promise<void> {
    throw new Error('not used by health indicator');
  }
}

/** A filename-safe path segment for building nested/unreachable paths. */
const segmentArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0 && !/[\\/\0:*?"<>|]/.test(s));

describe('uploads health indicator properties', () => {
  /*
   * Feature: video-upload-platform, Property 11: Unhealthy when storage is unreachable
   *
   * For any storage base directory that is unreachable/unwritable, the readiness check MUST report
   * an unhealthy status. We generate three independent, cross-platform ways for `/uploads` to be
   * unreachable/unwritable:
   *   - a path that does not exist and cannot be created because an intermediate parent is a file
   *     (mkdir recursive fails with ENOTDIR),
   *   - a baseDir that is itself an existing regular file (not a directory),
   *   - a deeply nested non-existent path under such a file parent.
   * In every case the indicator must throw HealthCheckError with status 'down' for the `uploads`
   * key. As a focused strengthening, a freshly created writable temp dir must report healthy.
   *
   * Validates: Requirements 5.2
   */
  it('Property 11: readiness reports unhealthy whenever /uploads is unreachable/unwritable', async () => {
    await fc.assert(
      fc.asyncProperty(
        segmentArb,
        segmentArb,
        // 0 = intermediate parent is a file; 1 = baseDir is a file; 2 = nested path under a file.
        fc.constantFrom(0, 1, 2),
        async (segA, segB, mode) => {
          // Sandbox for this run; a real file inside it is what makes the base dir unreachable.
          const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'vup-health-'));
          try {
            const filePath = path.join(sandbox, `${segA}.blocker`);
            await fs.writeFile(filePath, 'i am a file, not a directory');

            let unreachableBaseDir: string;
            if (mode === 0) {
              // baseDir sits *under* a regular file, so mkdir(recursive) fails (ENOTDIR).
              unreachableBaseDir = path.join(filePath, segB);
            } else if (mode === 1) {
              // baseDir *is* a regular file: writing a probe file inside it is impossible.
              unreachableBaseDir = filePath;
            } else {
              // Deeply nested path whose ancestor is a regular file.
              unreachableBaseDir = path.join(filePath, segB, 'originals', 'nested');
            }

            const indicator = new UploadsHealthIndicator(
              new BaseDirOnlyStorage(unreachableBaseDir),
            );

            let thrown: unknown;
            try {
              await indicator.isHealthy();
            } catch (err) {
              thrown = err;
            }

            // Must have failed the readiness check.
            expect(thrown).toBeInstanceOf(HealthCheckError);
            const causes = (thrown as HealthCheckError).causes as Record<
              string,
              { status: string }
            >;
            expect(causes.uploads.status).toBe('down');
          } finally {
            await fs.rm(sandbox, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /*
   * Focused counterpart to Property 11: a reachable, writable base dir reports healthy. Kept small
   * and separate so the failure property above stays the primary assertion.
   */
  it('reports healthy when /uploads is reachable and writable', async () => {
    const storage = await TempDirStorage.create('vup-health-ok-');
    try {
      const indicator = new UploadsHealthIndicator(storage);
      const result = await indicator.isHealthy();
      expect(result.uploads.status).toBe('up');
    } finally {
      await storage.cleanup();
    }
  });
});
