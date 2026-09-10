import { FTYP_HEADER_BYTES, hasFtypMagic } from '../src/mp4-validation';
import { parseFfprobeJson } from '../src/ffprobe-mp4-probe';
import { makeFtypBuffer } from './upload/upload.test-helpers';

/**
 * Unit tests for the pure MP4-validation building blocks: the ftyp magic-byte check and the
 * ffprobe JSON parser. These are the two independent checks combined by the upload path (Req 2.4).
 */

describe('hasFtypMagic', () => {
  it('accepts a buffer that begins with a ftyp box', () => {
    expect(hasFtypMagic(makeFtypBuffer())).toBe(true);
  });

  it('rejects a buffer without the ftyp type at offset 4', () => {
    expect(hasFtypMagic(Buffer.from('not-an-mp4-header-at-all'))).toBe(false);
  });

  it('rejects a too-short (truncated) header', () => {
    expect(hasFtypMagic(Buffer.from('ftyp'))).toBe(false);
  });

  it('only inspects the leading header bytes', () => {
    const header = makeFtypBuffer(Buffer.alloc(FTYP_HEADER_BYTES));
    expect(hasFtypMagic(header)).toBe(true);
  });
});

describe('parseFfprobeJson', () => {
  it('accepts an mp4 container with a video stream and extracts dimensions', () => {
    const json = JSON.stringify({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [{ codec_type: 'video', width: 3840, height: 2160 }],
    });
    const result = parseFfprobeJson(json);
    expect(result.valid).toBe(true);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
  });

  it('rejects a non-mp4 container', () => {
    const json = JSON.stringify({
      format: { format_name: 'matroska,webm' },
      streams: [{ codec_type: 'video', width: 1280, height: 720 }],
    });
    expect(parseFfprobeJson(json).valid).toBe(false);
  });

  it('rejects an mp4 container with no video stream', () => {
    const json = JSON.stringify({
      format: { format_name: 'mov,mp4' },
      streams: [{ codec_type: 'audio' }],
    });
    expect(parseFfprobeJson(json).valid).toBe(false);
  });

  it('rejects unparseable ffprobe output', () => {
    expect(parseFfprobeJson('not json').valid).toBe(false);
  });
});
