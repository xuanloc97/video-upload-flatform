import { execFile } from 'child_process';
import { promisify } from 'util';
import { Mp4Probe, Mp4ProbeResult } from './mp4-validation';

const execFileAsync = promisify(execFile);

/**
 * `ffprobe`-backed {@link Mp4Probe}. Runs `ffprobe` in JSON mode and confirms the file has an `mov`/
 * `mp4` container with at least one video stream; extracts the video stream's width/height so the
 * upload path can record 4K dimensions.
 *
 * This is the production implementation. It is intentionally the ONLY place that shells out to a
 * real binary, so the rest of the validation logic stays unit-testable with a stub probe. Because
 * `ffprobe` may not be installed in every environment, {@link isFfprobeAvailable} lets callers check
 * before relying on it.
 */
export class FfprobeMp4Probe implements Mp4Probe {
  constructor(private readonly ffprobePath = 'ffprobe') {}

  /** Resolve to true if the configured `ffprobe` binary can be executed. */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.ffprobePath, ['-version']);
      return true;
    } catch {
      return false;
    }
  }

  async probe(absolutePath: string): Promise<Mp4ProbeResult> {
    try {
      const { stdout } = await execFileAsync(this.ffprobePath, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        absolutePath,
      ]);
      return parseFfprobeJson(stdout);
    } catch (err) {
      return { valid: false, reason: `ffprobe failed: ${(err as Error).message}` };
    }
  }
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

interface FfprobeFormat {
  format_name?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** Parse `ffprobe -print_format json` output into an {@link Mp4ProbeResult}. Exported for tests. */
export function parseFfprobeJson(stdout: string): Mp4ProbeResult {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return { valid: false, reason: 'ffprobe returned unparseable output' };
  }

  const formatNames = (parsed.format?.format_name ?? '').split(',');
  const isMp4Container = formatNames.some((name) =>
    ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'isom'].includes(name.trim()),
  );
  if (!isMp4Container) {
    return { valid: false, reason: 'not an MP4/MOV container' };
  }

  const videoStream = (parsed.streams ?? []).find((s) => s.codec_type === 'video');
  if (!videoStream) {
    return { valid: false, reason: 'no video stream found' };
  }

  return {
    valid: true,
    width: videoStream.width,
    height: videoStream.height,
  };
}
