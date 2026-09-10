import * as path from 'path';
import { ProcessingStatus, Storage } from '@video-platform/shared';
import { BackendClient, ClaimedJob, RenditionRef } from './backend-client';
import { Transcoder } from './ffmpeg';
import { planRenditions, PlannedRendition } from './rendition-plan';

/** Relative storage layout under `/uploads` (design "Storage layout"). */
export const ORIGINALS_DIR = 'originals';
export const RENDITIONS_DIR = 'renditions';
export const THUMBNAILS_DIR = 'thumbnails';
export const TMP_DIR = 'tmp';

/** Lowercased filename fragment for a rendition, e.g. `2K` -> `2k.mp4`. */
function renditionFileName(rendition: PlannedRendition): string {
  return `${rendition.label.toLowerCase()}.mp4`;
}

/**
 * The processing worker's per-job pipeline (design "Processing Component").
 *
 * Given a claimed job it: reads `originals/<id>.mp4`, plans downscale-only renditions from the
 * source dimensions, transcodes each rendition plus a thumbnail into a private `tmp/<id>/` staging
 * dir, then atomically moves the completed set into `renditions/<id>/` and `thumbnails/<id>.jpg`.
 * Only after everything is in place does it report COMPLETED; any failure reports FAILED and leaves
 * the original untouched (Reqs 6.2–6.5). Because outputs are staged in tmp and moved atomically, a
 * retried run reproduces a full equivalent output set (Req 7.3).
 *
 * Storage, transcoding, and backend communication are all injected so the loop is unit/property
 * testable without FFmpeg or a live backend.
 */
export class ProcessingWorker {
  constructor(
    private readonly storage: Storage,
    private readonly transcoder: Transcoder,
    private readonly backend: BackendClient,
  ) {}

  /**
   * Claim and process exactly one job if one is available.
   * @returns the claimed job id, or null if nothing was pending.
   */
  async processOne(): Promise<string | null> {
    const job = await this.backend.claimNext();
    if (!job) {
      return null;
    }
    await this.processJob(job);
    return job.id;
  }

  /** Process a specific claimed job end to end, reporting COMPLETED or FAILED to the backend. */
  async processJob(job: ClaimedJob): Promise<void> {
    const abs = (rel: string): string => path.resolve(this.storage.baseDir, rel);
    const originalRel = job.storedPath || path.posix.join(ORIGINALS_DIR, `${job.id}.mp4`);
    const tmpRel = path.posix.join(TMP_DIR, job.id);
    const tmpAbs = abs(tmpRel);

    try {
      // A retried run must start from a clean slate so it reproduces a full set (Req 7.3).
      await this.removeDir(tmpAbs);
      await this.mkdirp(tmpAbs);

      const { width, height } = await this.transcoder.probeDimensions(abs(originalRel));
      const plan = planRenditions(width, height);

      // 1) Transcode every planned rendition into tmp.
      const staged: { rendition: PlannedRendition; tmpAbs: string; fileName: string }[] = [];
      for (const rendition of plan) {
        const fileName = renditionFileName(rendition);
        const outAbs = path.join(tmpAbs, fileName);
        await this.transcoder.transcodeRendition(abs(originalRel), outAbs, rendition);
        staged.push({ rendition, tmpAbs: outAbs, fileName });
      }

      // 2) Extract the thumbnail into tmp.
      const thumbTmpAbs = path.join(tmpAbs, 'thumbnail.jpg');
      await this.transcoder.extractThumbnail(abs(originalRel), thumbTmpAbs);

      // 3) Atomically move the completed set into their final locations. Renditions live under
      //    renditions/<id>/, the thumbnail at thumbnails/<id>.jpg.
      const renditionDirRel = path.posix.join(RENDITIONS_DIR, job.id);
      await this.removeDir(abs(renditionDirRel)); // clear any partial output from a prior attempt
      await this.mkdirp(abs(renditionDirRel));

      const refs: RenditionRef[] = [];
      for (const item of staged) {
        const finalRel = path.posix.join(renditionDirRel, item.fileName);
        await this.storage.move(path.posix.join(tmpRel, item.fileName), finalRel);
        refs.push({
          label: item.rendition.label,
          path: finalRel,
          width: item.rendition.width,
          height: item.rendition.height,
        });
      }

      const thumbRel = path.posix.join(THUMBNAILS_DIR, `${job.id}.jpg`);
      await this.storage.move(path.posix.join(tmpRel, 'thumbnail.jpg'), thumbRel);

      // 4) Clean up the (now-empty) staging dir and report success.
      await this.removeDir(tmpAbs);

      await this.backend.updateProcessingResult({
        id: job.id,
        status: ProcessingStatus.COMPLETED,
        renditions: refs,
        thumbnailPath: thumbRel,
      });
    } catch (err) {
      // Leave the original intact; discard any partial staged output; report FAILED (Req 6.5).
      await this.removeDir(tmpAbs).catch(() => undefined);
      await this.backend.updateProcessingResult({
        id: job.id,
        status: ProcessingStatus.FAILED,
        error: (err as Error).message,
      });
    }
  }

  /** Recursively create a directory (no-op if it exists). */
  private async mkdirp(absDir: string): Promise<void> {
    const { promises: fs } = await import('fs');
    await fs.mkdir(absDir, { recursive: true });
  }

  /** Recursively remove a directory, ignoring "not found". */
  private async removeDir(absDir: string): Promise<void> {
    const { promises: fs } = await import('fs');
    await fs.rm(absDir, { recursive: true, force: true });
  }
}
