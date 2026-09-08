import { execFile } from 'child_process';
import { promisify } from 'util';
import { PlannedRendition } from './rendition-plan';

const execFileAsync = promisify(execFile);

/**
 * Transcoding abstraction (design "Transcode"). Injecting this lets the worker's job loop be
 * property-tested against a fast in-memory stub, while production shells out to real FFmpeg. Only
 * this module knows how to invoke FFmpeg — the worker stays tool-agnostic.
 */
export interface Transcoder {
  /**
   * Scale `inputPath` to the planned rendition and write it to `outputPath` (an `.mp4`), preserving
   * aspect ratio and using the exact planned dimensions. Resolves when the file is fully written.
   */
  transcodeRendition(inputPath: string, outputPath: string, rendition: PlannedRendition): Promise<void>;

  /**
   * Extract a single representative frame from `inputPath` and write it to `outputPath` (a `.jpg`).
   */
  extractThumbnail(inputPath: string, outputPath: string): Promise<void>;

  /** Probe the source's pixel dimensions so the worker can plan downscale-only renditions. */
  probeDimensions(inputPath: string): Promise<{ width: number; height: number }>;
}

/**
 * FFmpeg/ffprobe-backed {@link Transcoder}. Uses the CLI directly (no `fluent-ffmpeg` wrapper) to
 * keep the dependency surface small and the exact arguments auditable.
 */
export class FfmpegTranscoder implements Transcoder {
  constructor(
    private readonly ffmpegPath = 'ffmpeg',
    private readonly ffprobePath = 'ffprobe',
  ) {}

  async transcodeRendition(
    inputPath: string,
    outputPath: string,
    rendition: PlannedRendition,
  ): Promise<void> {
    // Fixed output dimensions (already even and aspect-correct from planRenditions). yuv420p + H.264
    // + AAC gives broad browser/player compatibility for the HTML5 <video> element.
    await execFileAsync(this.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-vf',
      `scale=${rendition.width}:${rendition.height}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }

  async extractThumbnail(inputPath: string, outputPath: string): Promise<void> {
    // Grab a single frame a short way into the clip (avoids all-black opening frames) as the poster.
    await execFileAsync(this.ffmpegPath, [
      '-y',
      '-ss',
      '00:00:01',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outputPath,
    ]);
  }

  async probeDimensions(inputPath: string): Promise<{ width: number; height: number }> {
    const { stdout } = await execFileAsync(this.ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      inputPath,
    ]);
    const parsed = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] };
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) {
      throw new Error(`ffprobe could not determine video dimensions for ${inputPath}`);
    }
    return { width: stream.width, height: stream.height };
  }
}
