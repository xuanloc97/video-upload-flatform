import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Storage } from '@video-platform/shared';
import { STORAGE } from '../storage.tokens';

/** Health indicator key surfaced in the readiness payload. */
export const UPLOADS_HEALTH_KEY = 'uploads';

/**
 * Terminus health indicator for the shared `/uploads` volume.
 *
 * Readiness must fail when the backend cannot reach `/uploads` so Kubernetes takes the pod out of
 * rotation (Req 5.2). A plain existence check is not enough — an NFS mount can be present but
 * read-only or stale — so this performs a real write/delete of a tiny probe file under the storage
 * base dir. The whole check is bounded by a timeout to keep probes responsive (Req 5.3).
 */
/** Default upper bound (ms) on the writable check so a hung NFS mount cannot stall the probe. */
export const DEFAULT_UPLOADS_CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class UploadsHealthIndicator extends HealthIndicator {
  /**
   * Upper bound (ms) on the writable check. Public and mutable so it can be raised in tests running
   * on slow filesystems without affecting the production default; DI only injects {@link STORAGE}.
   */
  checkTimeoutMs: number = DEFAULT_UPLOADS_CHECK_TIMEOUT_MS;

  constructor(@Inject(STORAGE) private readonly storage: Storage) {
    super();
  }

  /** Verify `/uploads` is reachable and writable. Throws HealthCheckError when it is not. */
  async isHealthy(key: string = UPLOADS_HEALTH_KEY): Promise<HealthIndicatorResult> {
    try {
      await this.withTimeout(this.probeWritable(), this.checkTimeoutMs);
      return this.getStatus(key, true, { baseDir: this.storage.baseDir });
    } catch (err) {
      const result = this.getStatus(key, false, {
        baseDir: this.storage.baseDir,
        error: (err as Error).message,
      });
      throw new HealthCheckError('uploads volume is not reachable/writable', result);
    }
  }

  /** Write and delete a unique probe file under the storage base dir to prove write access. */
  private async probeWritable(): Promise<void> {
    const probePath = path.join(this.storage.baseDir, `.health-${randomUUID()}`);
    await fs.mkdir(this.storage.baseDir, { recursive: true });
    await fs.writeFile(probePath, 'ok');
    await fs.unlink(probePath);
  }

  /** Reject with a timeout error if `promise` does not settle within `ms`. */
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`writable check timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
