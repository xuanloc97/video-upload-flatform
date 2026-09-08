import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
  ProcessingStatus,
  TempDirStorage,
  TempSqliteMetadataStore,
} from '@video-platform/shared';
import { FfmpegTranscoder } from './ffmpeg';
import { MetadataStoreBackendClient } from './metadata-backend-client';
import { planRenditions } from './rendition-plan';
import { ProcessingWorker, ORIGINALS_DIR, RENDITIONS_DIR, THUMBNAILS_DIR } from './worker';

const execFileAsync = promisify(execFile);

/*
 * End-to-end local demo (Task 9, Req 6.6): using the committed Sample_Video, drive the full flow
 * against temp storage + temp SQLite — upload -> PENDING, then run the real worker (real FFmpeg)
 * which claims the job (PENDING -> PROCESSING) and, on success, reports COMPLETED with renditions
 * and a thumbnail. This is the same status machine the backend + worker use in the cluster, wired
 * in-process so it needs no HTTP servers.
 */

const SAMPLE_PATH = path.resolve(__dirname, '../../samples/sample-video.mp4');

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    await execFileAsync('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

describe('Sample_Video end-to-end flow (Task 9, Req 6.6)', () => {
  it('uploads the sample, processes it, and reaches COMPLETED with renditions + thumbnail', async () => {
    if (!(await ffmpegAvailable())) {
      // eslint-disable-next-line no-console
      console.warn('Skipping Sample_Video e2e: ffmpeg/ffprobe not installed.');
      return;
    }
    // Guard: the committed sample must exist.
    await expect(fs.access(SAMPLE_PATH)).resolves.toBeUndefined();

    const storage = await TempDirStorage.create();
    const metadata = await TempSqliteMetadataStore.create();
    try {
      // --- Upload step (what the backend UploadService does after MP4 validation): stream the
      //     original into originals/<id>.mp4 and create a PENDING Upload_Record. ---
      const id = 'sample-1';
      const originalRel = path.posix.join(ORIGINALS_DIR, `${id}.mp4`);
      const bytes = await fs.readFile(SAMPLE_PATH);
      await storage.write(originalRel, bytes);
      metadata.createUpload({
        id,
        originalFilename: 'sample-video.mp4',
        storedPath: originalRel,
      });

      // Just uploaded => PENDING.
      expect(metadata.getUpload(id)!.status).toBe(ProcessingStatus.PENDING);

      // --- Processing step: run the worker exactly as in production, but with the store-backed
      //     BackendClient so we can observe the transitions in-process. ---
      const backend = new MetadataStoreBackendClient(metadata);
      const worker = new ProcessingWorker(storage, new FfmpegTranscoder(), backend);

      const processedId = await worker.processOne();
      expect(processedId).toBe(id);

      // Claiming moved it through PROCESSING; a successful run ends at COMPLETED.
      const finalRecord = metadata.getUpload(id)!;
      expect(finalRecord.status).toBe(ProcessingStatus.COMPLETED);
      expect(finalRecord.thumbnailPath).toBe(path.posix.join(THUMBNAILS_DIR, `${id}.jpg`));

      // The 720p sample yields 720p + 480p renditions (downscale-only).
      const expected = planRenditions(1280, 720);
      expect(expected.map((r) => r.label)).toEqual(['720p', '480p']);

      const storedRenditions = metadata.getRenditions(id);
      expect(storedRenditions.map((r) => r.label).sort()).toEqual(
        expected.map((r) => r.label).sort(),
      );

      // Every rendition + the thumbnail physically exist on the shared storage.
      for (const r of expected) {
        const rel = path.posix.join(RENDITIONS_DIR, id, `${r.label.toLowerCase()}.mp4`);
        expect(await storage.exists(rel)).toBe(true);
      }
      expect(await storage.exists(finalRecord.thumbnailPath!)).toBe(true);

      // Original preserved.
      expect(await storage.exists(originalRel)).toBe(true);
    } finally {
      await metadata.cleanup();
      await storage.cleanup();
    }
  });
});
