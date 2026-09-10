import {
  contentTypeForPath,
  FILES_ROUTE_PREFIX,
  parseRangeHeader,
  toFileUrl,
} from './file-serving';

/*
 * Unit tests for the pure file-serving helpers: URL derivation, content-type mapping, and HTTP
 * Range header parsing (the core of 206 Partial Content support).
 */

describe('toFileUrl', () => {
  it('prefixes a stored relative path with the files route', () => {
    expect(toFileUrl('renditions/abc/1080p.mp4')).toBe(
      `${FILES_ROUTE_PREFIX}/renditions/abc/1080p.mp4`,
    );
    expect(toFileUrl('thumbnails/abc.jpg')).toBe(`${FILES_ROUTE_PREFIX}/thumbnails/abc.jpg`);
  });

  it('normalizes backslashes and strips leading slashes', () => {
    expect(toFileUrl('renditions\\abc\\720p.mp4')).toBe(
      `${FILES_ROUTE_PREFIX}/renditions/abc/720p.mp4`,
    );
    expect(toFileUrl('/thumbnails/abc.jpg')).toBe(`${FILES_ROUTE_PREFIX}/thumbnails/abc.jpg`);
  });
});

describe('contentTypeForPath', () => {
  it('maps known media extensions', () => {
    expect(contentTypeForPath('x/2K.mp4')).toBe('video/mp4');
    expect(contentTypeForPath('x/thumb.jpg')).toBe('image/jpeg');
    expect(contentTypeForPath('x/thumb.jpeg')).toBe('image/jpeg');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeForPath('x/data.bin')).toBe('application/octet-stream');
    expect(contentTypeForPath('x/noext')).toBe('application/octet-stream');
  });
});

describe('parseRangeHeader', () => {
  it('returns none when no header is present', () => {
    expect(parseRangeHeader(undefined, 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader(null, 100)).toEqual({ kind: 'none' });
  });

  it('parses a bounded range', () => {
    const result = parseRangeHeader('bytes=0-99', 500);
    expect(result).toEqual({
      kind: 'satisfiable',
      range: { start: 0, end: 99, contentLength: 100, size: 500 },
    });
  });

  it('clamps an end beyond EOF to the last byte', () => {
    const result = parseRangeHeader('bytes=400-999', 500);
    expect(result).toEqual({
      kind: 'satisfiable',
      range: { start: 400, end: 499, contentLength: 100, size: 500 },
    });
  });

  it('parses an open-ended range as through end of file', () => {
    const result = parseRangeHeader('bytes=200-', 500);
    expect(result).toEqual({
      kind: 'satisfiable',
      range: { start: 200, end: 499, contentLength: 300, size: 500 },
    });
  });

  it('parses a suffix range as the last N bytes', () => {
    const result = parseRangeHeader('bytes=-50', 500);
    expect(result).toEqual({
      kind: 'satisfiable',
      range: { start: 450, end: 499, contentLength: 50, size: 500 },
    });
  });

  it('treats a suffix larger than the file as the whole file', () => {
    const result = parseRangeHeader('bytes=-1000', 500);
    expect(result).toEqual({
      kind: 'satisfiable',
      range: { start: 0, end: 499, contentLength: 500, size: 500 },
    });
  });

  it('marks a start past EOF as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=500-600', 500)).toEqual({ kind: 'unsatisfiable', size: 500 });
  });

  it('marks any range against an empty file as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable', size: 0 });
  });

  it('ignores malformed headers by falling back to none', () => {
    expect(parseRangeHeader('bytes=abc', 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('items=0-10', 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('bytes=-', 100)).toEqual({ kind: 'none' });
  });
});
