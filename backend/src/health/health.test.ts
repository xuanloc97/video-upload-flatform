import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { Test } from '@nestjs/testing';
import * as fc from 'fast-check';
import { TerminusModule } from '@nestjs/terminus';
import { Storage, TempDirStorage } from '@video-platform/shared';
import { STORAGE } from '../storage.tokens';
import { HealthController } from './health.controller';
import { UPLOADS_HEALTH_KEY, UploadsHealthIndicator } from './uploads.health';

/*
 * Tests for the backend health checks (design "Health").
 *
 * These exercise the readiness `/uploads` writable indicator and the liveness endpoint without a
 * running HTTP server: the Terminus HealthCheckService is a small orchestrator, so we drive it and
 * the indicator directly. Property 11 (Req 5.2) checks the "storage unreachable => unhealthy"
 * contract; the unit test (Req 5.1) checks a healthy response under normal conditions.
 */

/**
 * A Storage whose base directory cannot be written to, modelling an unreachable/lost `/uploads`
 * mount. `baseDir` points *through* a regular file, so any mkdir/write beneath it fails with ENOTDIR
 * — a reliable, cross-platform way to make the writable probe fail without needing real NFS.
 */
async function makeUnreachableStorage(): Promise<{ storage: Storage; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vup-unreachable-'));
  // A plain file; using it as a parent directory is guaranteed to fail.
  const blocker = path.join(dir, 'not-a-dir');
  await fs.writeFile(blocker, 'x');
  const storage: Storage = {
    baseDir: path.join(blocker, 'uploads'),
    write: async () => undefined,
    read: async () => Buffer.alloc(0),
    exists: async () => false,
    move: async () => undefined,
  };
  return {
    storage,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe('UploadsHealthIndicator (Req 5.2)', () => {
  /*
   * Feature: video-upload-platform, Property 11: Unhealthy when storage is unreachable
   *
   * For any storage whose base directory cannot be written, the readiness indicator reports
   * unhealthy (throws) rather than reporting up. Conversely, a reachable/writable temp dir is
   * always reported healthy. This is the exact contract Kubernetes relies on to pull a pod that has
   * lost `/uploads` out of rotation.
   *
   * Validates: Requirements 5.2
   */
  it('Property 11: reports unhealthy exactly when the uploads volume is not writable', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (reachable) => {
        let cleanup: () => Promise<void>;
        let indicator: UploadsHealthIndicator;

        // Use a generous writable-check timeout so a merely-slow (but working) temp dir under load
        // is never a false negative; the unreachable case fails structurally (ENOTDIR), not by
        // timeout, so it stays fast regardless of this value.
        const generousTimeoutMs = 60_000;
        if (reachable) {
          const storage = await TempDirStorage.create();
          cleanup = () => storage.cleanup();
          indicator = new UploadsHealthIndicator(storage);
        } else {
          const made = await makeUnreachableStorage();
          cleanup = made.cleanup;
          indicator = new UploadsHealthIndicator(made.storage);
        }
        indicator.checkTimeoutMs = generousTimeoutMs;

        try {
          if (reachable) {
            const result = await indicator.isHealthy();
            expect(result[UPLOADS_HEALTH_KEY].status).toBe('up');
          } else {
            // Unreachable storage must make the indicator throw (HealthCheckError).
            await expect(indicator.isHealthy()).rejects.toBeDefined();
          }
        } finally {
          await cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('HealthController (Req 5.1)', () => {
  /*
   * Confirm a healthy response under normal conditions: with a reachable/writable temp `/uploads`,
   * both /health/ready and /health/live report status "ok".
   *
   * Validates: Requirements 5.1
   */
  let storage: TempDirStorage;
  let controller: HealthController;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    // Build a real Nest module so Terminus (HealthCheckService + executor + logger) is wired exactly
    // as in production, with the STORAGE token overridden by a reachable temp-dir Storage.
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        UploadsHealthIndicator,
        { provide: STORAGE, useValue: storage as Storage },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
    // Raise the writable-check timeout so a merely-slow temp dir under load is not a false negative
    // (the production default stays 2s; this only affects the test instance).
    moduleRef.get(UploadsHealthIndicator).checkTimeoutMs = 60_000;
  });

  afterEach(async () => {
    await storage.cleanup();
  });

  it('reports ready (uploads up) under normal conditions', async () => {
    const result = await controller.ready();
    expect(result.status).toBe('ok');
    expect(result.info?.[UPLOADS_HEALTH_KEY]?.status).toBe('up');
    expect(result.details[UPLOADS_HEALTH_KEY].status).toBe('up');
  });

  it('reports live quickly with no dependency checks', async () => {
    const start = Date.now();
    const result = await controller.live();
    // Liveness must be lightweight (no external probing) and well under the 5s budget (Req 5.3).
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.status).toBe('ok');
  });
});
