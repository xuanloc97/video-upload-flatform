import * as path from 'path';

/**
 * Pure helpers for the `/files` file-serving route (design "File serving"): deriving public file
 * URLs from stored relative paths, mapping extensions to Content-Type, and parsing/validating HTTP
 * Range headers for 206 Partial Content video seeking. Kept free of NestJS/Express so the logic can
 * be unit-/property-tested directly.
 */

/** Public URL prefix under which renditions/thumbnails are served. */
export const FILES_ROUTE_PREFIX = '/files';

/**
 * Build the public backend file-route URL for a stored relative path, e.g.
 * `renditions/<id>/2k.mp4` → `/files/renditions/<id>/2k.mp4`. Backslashes (Windows-style stored
 * paths) are normalized to forward slashes so the URL is always POSIX-style.
 */
export function toFileUrl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${FILES_ROUTE_PREFIX}/${normalized}`;
}

/** Map a file extension to a Content-Type. Falls back to a generic binary type. */
export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** A resolved byte range (inclusive) plus the total file size. */
export interface ResolvedRange {
  start: number;
  end: number;
  /** Number of bytes in the range: `end - start + 1`. */
  contentLength: number;
  /** Total size of the underlying file. */
  size: number;
}

/**
 * Outcome of parsing a `Range` header against a known file `size`:
 * - `none`: no Range header → caller serves the full body (200).
 * - `satisfiable`: a valid single range → caller serves 206 Partial Content.
 * - `unsatisfiable`: a syntactically valid range that lies outside the file → caller responds 416.
 */
export type RangeParseResult =
  | { kind: 'none' }
  | { kind: 'satisfiable'; range: ResolvedRange }
  | { kind: 'unsatisfiable'; size: number };

/**
 * Parse a single HTTP byte-range spec (RFC 7233) of the form `bytes=start-end`, `bytes=start-`, or
 * `bytes=-suffixLength` against a file of `size` bytes.
 *
 * Only a single range is supported (multi-range/multipart responses are intentionally not
 * implemented — video players issue single ranges for seeking). Anything malformed is treated as
 * "no range" so the caller falls back to a full 200 response, matching lenient server behavior.
 */
export function parseRangeHeader(header: string | undefined | null, size: number): RangeParseResult {
  if (!header) {
    return { kind: 'none' };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    // Malformed or multi-range: ignore and serve the whole file.
    return { kind: 'none' };
  }

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') {
    // `bytes=-` with neither bound is meaningless.
    return { kind: 'none' };
  }

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix range: `bytes=-N` → the last N bytes.
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0) {
      return { kind: 'unsatisfiable', size };
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    // Clamp the end to the last byte of the file.
    if (end > size - 1) {
      end = size - 1;
    }
  }

  // A zero-length file cannot satisfy any range; a start past EOF is unsatisfiable (416).
  if (size === 0 || start > end || start >= size) {
    return { kind: 'unsatisfiable', size };
  }

  return {
    kind: 'satisfiable',
    range: { start, end, contentLength: end - start + 1, size },
  };
}
