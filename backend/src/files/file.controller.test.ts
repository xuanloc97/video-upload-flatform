import { Writable } from 'stream';
import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fc from 'fast-check';
import { TempDirStorage } from '@video-platform/shared';
import { FileController } from './file.controller';
import { fileRouteUrl } from './file-route';

/*
 * Unit + property tests for the REST-style file-serving controller (Task 5.2 / 5.7 / 5.9).
 *
 * The controller streams bytes from the shared Storage with correct Content-Type + HTTP Range
 * support. We drive `serve()` directly with a mock Express req/res (no HTTP server), capturing the
 * status, headers, and streamed body so we can assert full (200), partial (206), unsatisfiable
 * (416), and missing (404) behaviors, plus the round-trip retrievability property.
 */

/** A mock Express Response that is also a Writable sink, so `stream.pipe(res)` captures the body. */
class MockResponse extends Writable {
  statusCode = 200;
  readonly headers: Record<string, string> = {};
  headersSent = false;
  private readonly chunks: Buffer[] = [];
  /** Resolves once the response has been fully written (`end`). */
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor() {
    super();
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string | number): this {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _write(chunk: any, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    cb();
  }

  end(chunk?: unknown): this {
    if (chunk && Buffer.isBuffer(chunk)) {
      this.chunks.push(chunk);
    }
    // Emulate Express: mark sent and finish.
    this.headersSent = true;
    super.end(() => undefined);
    this.resolveDone();
    return this;
  }

  get body(): Buffer {
    return Buffer.concat(this.chunks);
  }

  asResponse(): Response {
    return this as unknown as Response;
  }
}

/** Build a mock Express Request carrying an optional Range header. */
function makeRequest(range?: string): Request {
  return { headers: range ? { range } : {} } as unknown as Request;
}

/** Await either the streamed `done` or a thrown NotFoundException from `serve`. */
async function serve(
  controller: FileController,
  requestedPath: string,
  range?: string,
): Promise<{ res: MockResponse; error?: unknown }> {
  const res = new MockResponse();
  const req = makeRequest(range);
  try {
    await controller.serve(requestedPath, req, res.asResponse());
    await res.done;
    return { res };
  } catch (error) {
    return { res, error };
  }
}

describe('FileController range + content serving (Reqs 4.3, 4.4)', () => {
  let storage: TempDirStorage;
  let controller: FileController;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    controller = new FileController(storage);
  });

  afterEach(async () => {
    await storage.cleanup();
  });

  it('serves a full file with 200, correct Content-Type, Content-Length, and Accept-Ranges', async () => {
    const body = Buffer.from('hello mp4 bytes');
    await storage.write('renditions/vid/720p.mp4', body);

    const { res, error } = await serve(controller, 'renditions/vid/720p.mp4');

    expect(error).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('video/mp4');
    expect(res.getHeader('accept-ranges')).toBe('bytes');
    expect(res.getHeader('content-length')).toBe(String(body.length));
    expect(res.body.equals(body)).toBe(true);
  });

  it('serves a thumbnail with image/jpeg content type', async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await storage.write('thumbnails/vid.jpg', body);

    const { res } = await serve(controller, 'thumbnails/vid.jpg');

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('image/jpeg');
    expect(res.body.equals(body)).toBe(true);
  });

  it('serves a partial 206 with correct Content-Range and only the requested bytes', async () => {
    const body = Buffer.from('0123456789'); // 10 bytes
    await storage.write('renditions/vid/1080p.mp4', body);

    const { res } = await serve(controller, 'renditions/vid/1080p.mp4', 'bytes=2-5');

    expect(res.statusCode).toBe(206);
    expect(res.getHeader('accept-ranges')).toBe('bytes');
    expect(res.getHeader('content-range')).toBe('bytes 2-5/10');
    expect(res.getHeader('content-length')).toBe('4');
    expect(res.body.toString()).toBe('2345');
  });

  it('treats an open-ended range (bytes=N-) as through end of file', async () => {
    const body = Buffer.from('0123456789');
    await storage.write('renditions/vid/480p.mp4', body);

    const { res } = await serve(controller, 'renditions/vid/480p.mp4', 'bytes=7-');

    expect(res.statusCode).toBe(206);
    expect(res.getHeader('content-range')).toBe('bytes 7-9/10');
    expect(res.body.toString()).toBe('789');
  });

  it('serves a suffix range (bytes=-N) as the last N bytes', async () => {
    const body = Buffer.from('0123456789');
    await storage.write('renditions/vid/2K.mp4', body);

    const { res } = await serve(controller, 'renditions/vid/2K.mp4', 'bytes=-3');

    expect(res.statusCode).toBe(206);
    expect(res.getHeader('content-range')).toBe('bytes 7-9/10');
    expect(res.body.toString()).toBe('789');
  });

  it('responds 416 with Content-Range for an unsatisfiable range', async () => {
    const body = Buffer.from('0123456789');
    await storage.write('renditions/vid/720p.mp4', body);

    const { res } = await serve(controller, 'renditions/vid/720p.mp4', 'bytes=50-60');

    expect(res.statusCode).toBe(416);
    expect(res.getHeader('content-range')).toBe('bytes */10');
  });

  it('throws NotFoundException (→ 404) for a missing file', async () => {
    const { error } = await serve(controller, 'renditions/missing/720p.mp4');
    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException for a path-traversal attempt (never escapes the base dir)', async () => {
    const { error } = await serve(controller, '../../etc/passwd');
    expect(error).toBeInstanceOf(NotFoundException);
  });

  /*
   * Feature: video-upload-platform, Property 9: Referenced files are retrievable
   *
   * For any file written into Storage at a rendition/thumbnail path (the exact paths the metadata
   * resolver hands out as file-route URLs), the file route serves back the byte-identical content
   * for a full request, and serves a byte-exact window for a range request (Reqs 4.3, 4.4).
   *
   * Validates: Requirements 4.3, 4.4
   */
  it('Property 9: files referenced by the metadata route are retrievable (full + range)', async () => {
    const idArb = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((s) => /^[A-Za-z0-9-]+$/.test(s));
    const labelArb = fc.constantFrom('2K', '1080p', '720p', '480p');
    const contentArb = fc.uint8Array({ minLength: 1, maxLength: 2048 }).map((u) => Buffer.from(u));

    await fc.assert(
      fc.asyncProperty(
        idArb,
        labelArb,
        contentArb,
        fc.boolean(),
        async (id, label, content, isThumbnail) => {
          const runStorage = await TempDirStorage.create();
          try {
            const runController = new FileController(runStorage);
            const relPath = isThumbnail
              ? `thumbnails/${id}.jpg`
              : `renditions/${id}/${label}.mp4`;
            await runStorage.write(relPath, content);

            // The resolver would hand the client this URL; derive the wildcard path it maps to.
            const url = fileRouteUrl(relPath);
            const requestedPath = url.replace(/^\/files\//, '');

            // Full retrieval returns byte-identical content (Req 4.3/4.4).
            const full = await serve(runController, requestedPath);
            expect(full.error).toBeUndefined();
            expect(full.res.statusCode).toBe(200);
            expect(full.res.body.equals(content)).toBe(true);

            // Range retrieval returns the exact requested window.
            const end = Math.min(content.length - 1, Math.floor(content.length / 2));
            const start = 0;
            const partial = await serve(runController, requestedPath, `bytes=${start}-${end}`);
            const expectedWindow = content.subarray(start, end + 1);
            if (content.length === 1) {
              // Single byte: bytes=0-0 is a valid full-length window.
              expect(partial.res.statusCode).toBe(206);
            } else {
              expect(partial.res.statusCode).toBe(206);
            }
            expect(partial.res.getHeader('content-range')).toBe(
              `bytes ${start}-${end}/${content.length}`,
            );
            expect(partial.res.body.equals(expectedWindow)).toBe(true);
          } finally {
            await runStorage.cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
