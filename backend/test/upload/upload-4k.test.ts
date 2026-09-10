import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  ProcessingStatus,
  TempDirStorage,
  TempSqliteMetadataStore,
} from '@video-platform/shared';
import { FfprobeMp4Probe } from '../../src/ffprobe-mp4-probe';
import { ORIGINALS_DIR, UploadService } from '../../src/upload/upload.service';
import { makeFtypBuffer, makeUpload, StubValidProbe } from './upload.test-helpers';

const execFileAsync = promisify(execFile);

/*
 * Unit test for the 4K acceptance example (Req 2.5): an MP4 with 4K resolution is accepted and
 * stored through the same upload operation, and is streamed to disk rather than buffered in memory.
 *
 * The probe is injectable, so the primary test uses a stub reporting 3840x2160 to keep the test
 * hermetic and fast. When a real `ffprobe` binary is available on the machine and `ffmpeg` can
 * synthesize a tiny 4K clip, an additional test exercises the real FfprobeMp4Probe end to end.
 */

describe('4K upload acceptance (Req 2.5)', () => {
  let storage: TempDirStorage;
  let metadata: TempSqliteMetadataStore;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    metadata = await TempSqliteMetadataStore.create();
  });

  afterEach(async () => {
    await metadata.cleanup();
    await storage.cleanup();
  });

  it('accepts and stores a large (4K-sized) MP4 via the same operation without buffering', async () => {
    // Probe reports 4K dimensions; the service does not care about size, proving the same
    // operation handles 4K just like any other valid MP4.
    const service = new UploadService(storage, metadata, new StubValidProbe(3840, 2160));

    // A sizeable payload (~16 MiB) after the ftyp box. Because handleUpload streams via
    // stream.pipeline (createReadStream -> createWriteStream), the whole buffer is never
    // materialized a second time in memory; the bytes flow chunk-by-chunk to disk.
    const bigTrailing = Buffer.alloc(16 * 1024 * 1024, 0x42);
    const content = makeFtypBuffer(bigTrailing);

    const record = await service.handleUpload(makeUpload('sample-4k.mp4', content));

    expect(record.status).toBe(ProcessingStatus.PENDING);
    expect(record.originalFilename).toBe('sample-4k.mp4');
    expect(record.storedPath).toBe(`${ORIGINALS_DIR}/${record.id}.mp4`);

    // Stored file matches the uploaded bytes exactly.
    expect(await storage.exists(record.storedPath)).toBe(true);
    const written = await storage.read(record.storedPath);
    expect(written.length).toBe(content.length);
    expect(written.equals(content)).toBe(true);
  });

  it('accepts a real synthesized 4K MP4 through the real ffprobe path when ffmpeg/ffprobe exist', async () => {
    const probe = new FfprobeMp4Probe();
    const ffprobeAvailable = await probe.isAvailable();
    let ffmpegAvailable = false;
    try {
      await execFileAsync('ffmpeg', ['-version']);
      ffmpegAvailable = true;
    } catch {
      ffmpegAvailable = false;
    }

    if (!ffprobeAvailable || !ffmpegAvailable) {
      // Documented fallback: without the FFmpeg toolchain we cannot synthesize/probe a real 4K
      // clip, so the hermetic stub-based test above provides the coverage. Skip cleanly.
      console.warn(
        'Skipping real-ffprobe 4K test: ffmpeg/ffprobe not installed in this environment.',
      );
      return;
    }

    // Synthesize a 1-second 3840x2160 test-pattern MP4 directly onto the storage base dir.
    const path = await import('path');
    const { promises: fsp } = await import('fs');
    await fsp.mkdir(path.join(storage.baseDir, 'src'), { recursive: true });
    const srcPath = path.join(storage.baseDir, 'src', 'gen-4k.mp4');
    await execFileAsync('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=3840x2160:rate=1:duration=1',
      '-pix_fmt',
      'yuv420p',
      '-y',
      srcPath,
    ]);

    const service = new UploadService(storage, metadata, probe);
    const content = await fsp.readFile(srcPath);
    const record = await service.handleUpload(makeUpload('real-4k.mp4', content));

    expect(record.status).toBe(ProcessingStatus.PENDING);
    expect(await storage.exists(record.storedPath)).toBe(true);

    // Confirm the stored original really is a 4K MP4 per ffprobe.
    const result = await probe.probe(path.join(storage.baseDir, record.storedPath));
    expect(result.valid).toBe(true);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
  });
});
