import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { promises as fs } from 'fs';
import { ProcessingStatus, TempDirStorage } from '@video-platform/shared';
import { FfmpegTranscoder } from './ffmpeg';
import { planRenditions } from './rendition-plan';
import { ProcessingWorker, ORIGINALS_DIR, RENDITIONS_DIR, THUMBNAILS_DIR } from './worker';
import { StubBackendClient } from './worker.test-helpers';

const execFileAsync = promisify(execFile);

/*
 * Real-FFmpeg integration pass (Task 8.8): run the worker end to end with the actual
 * FfmpegTranscoder on a synthesized clip, confirming the stub-based property tests match reality —
 * renditions are produced at the planned dimensions and the thumbnail is a real image. Skips
 * cleanly when ffmpeg/ffprobe are not installed.
 */

async function toolingAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    await execFileAsync('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function probe(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] };
  const s = parsed.streams?.[0]!;
  return { width: s.width!, height: s.height! };
}

describe('ProcessingWorker real-FFmpeg integration (Task 8.8)', () => {
  it('produces correctly-sized renditions and a real thumbnail for a synthesized 1080p clip', async () => {
    if (!(await toolingAvailable())) {
      // eslint-disable-next-line no-console
      console.warn('Skipping real-FFmpeg integration: ffmpeg/ffprobe not installed.');
      return;
    }

    const storage = await TempDirStorage.create();
    try {
      const id = 'integ-1080';
      const originalRel = path.posix.join(ORIGINALS_DIR, `${id}.mp4`);
      const originalAbs = path.join(storage.baseDir, originalRel);
      await fs.mkdir(path.dirname(originalAbs), { recursive: true });

      // Synthesize a 2-second 1920x1080 test-pattern clip with audio so the AAC path exercises too.
      await execFileAsync('ffmpeg', [
        '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=15:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-pix_fmt', 'yuv420p', '-shortest', '-y', originalAbs,
      ]);

      const backend = new StubBackendClient();
      const worker = new ProcessingWorker(storage, new FfmpegTranscoder(), backend);
      await worker.processJob({ id, storedPath: originalRel });

      const result = backend.resultFor(id);
      expect(result?.status).toBe(ProcessingStatus.COMPLETED);

      const expected = planRenditions(1920, 1080); // 1080p, 720p, 480p
      expect(result!.renditions).toHaveLength(expected.length);

      // Each rendition file exists and has the planned dimensions per ffprobe.
      for (const r of expected) {
        const rel = path.posix.join(RENDITIONS_DIR, id, `${r.label.toLowerCase()}.mp4`);
        const abs = path.join(storage.baseDir, rel);
        expect(await storage.exists(rel)).toBe(true);
        const dims = await probe(abs);
        expect(dims.width).toBe(r.width);
        expect(dims.height).toBe(r.height);
      }

      // Thumbnail is a real, non-empty JPEG.
      const thumbRel = path.posix.join(THUMBNAILS_DIR, `${id}.jpg`);
      expect(await storage.exists(thumbRel)).toBe(true);
      const thumbBytes = await storage.read(thumbRel);
      expect(thumbBytes.length).toBeGreaterThan(0);
      // JPEG magic bytes: FF D8.
      expect(thumbBytes[0]).toBe(0xff);
      expect(thumbBytes[1]).toBe(0xd8);
    } finally {
      await storage.cleanup();
    }
  });
});
