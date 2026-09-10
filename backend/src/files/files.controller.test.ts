import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as fc from 'fast-check';
import { Storage, TempDirStorage } from '@video-platform/shared';
import { STORAGE } from '../storage.tokens';
import { FilesController } from './files.controller';

/*
 * Tests for the `/files` file-serving route:
 *  - Property 9 (referenced files are retrievable): write rendition/thumbnail files into a temp-dir
 *    Storage, then confirm the route serves back byte-identical content (Req 4.3, 4.4).
 *  - Unit tests: full 200 without Range, 206 + correct Content-Range with Range, content types,
 *    404 for missing files, path-traversal rejection, and 416 for unsatisfiable ranges.
 *
 * The controller is mounted in a real (in-memory) Nest app over a temp-dir Storage, so the actual
 * Express streaming/range wiring is exercised — not a mock.
 */
async function bootApp(storage: Storage): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [FilesController],
    providers: [{ provide: STORAGE, useValue: storage }],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('FilesController (/files route)', () => {
  let storage: TempDirStorage;
  let app: INestApplication;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
    app = await bootApp(storage);
  });

  afterEach(async () => {
    await app.close();
    await storage.cleanup();
  });

  /*
   * Feature: video-upload-platform, Property 9: Referenced files are retrievable
   *
   * For any rendition/thumbnail file written to storage, fetching its `/files/...` URL returns the
   * byte-identical content with a status of 200 (Req 4.3, 4.4).
   *
   * Validates: Requirements 4.3, 4.4
   */
  it('Property 9: referenced rendition/thumbnail files are retrievable via the route', async () => {
    const idArb = fc.uuid();
    const kindArb = fc.constantFrom<{ dir: string; ext: string; label?: string }>(
      { dir: 'renditions', ext: '.mp4', label: '1080p' },
      { dir: 'renditions', ext: '.mp4', label: '720p' },
      { dir: 'thumbnails', ext: '.jpg' },
    );
    const contentArb = fc.uint8Array({ minLength: 0, maxLength: 8192 }).map((u) => Buffer.from(u));

    await fc.assert(
      fc.asyncProperty(idArb, kindArb, contentArb, async (id, kind, content) => {
        const relPath =
          kind.dir === 'renditions'
            ? `renditions/${id}/${kind.label}${kind.ext}`
            : `thumbnails/${id}${kind.ext}`;
        await storage.write(relPath, content);

        const res = await request(app.getHttpServer()).get(`/files/${relPath}`);

        expect(res.status).toBe(200);
        expect(Buffer.from(res.body).equals(content)).toBe(true);
        expect(res.headers['accept-ranges']).toBe('bytes');
      }),
      { numRuns: 100 },
    );
  });

  it('serves a full 200 with correct content type and length when no Range header is sent', async () => {
    const content = Buffer.from('a full mp4 body '.repeat(64));
    await storage.write('renditions/vid/480p.mp4', content);

    const res = await request(app.getHttpServer()).get('/files/renditions/vid/480p.mp4');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(content.length);
    expect(Buffer.from(res.body).equals(content)).toBe(true);
  });

  it('serves image/jpeg for thumbnails', async () => {
    const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await storage.write('thumbnails/vid.jpg', content);

    const res = await request(app.getHttpServer()).get('/files/thumbnails/vid.jpg');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
  });

  it('serves a 206 Partial Content with correct Content-Range for a bounded range', async () => {
    const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    await storage.write('renditions/vid/720p.mp4', content);

    const res = await request(app.getHttpServer())
      .get('/files/renditions/vid/720p.mp4')
      .set('Range', 'bytes=5-14');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 5-14/${content.length}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(10);
    expect(Buffer.from(res.body).equals(content.subarray(5, 15))).toBe(true);
  });

  it('serves a 206 for an open-ended range (bytes=N-) through end of file', async () => {
    const content = Buffer.from('the quick brown fox jumps over the lazy dog');
    await storage.write('renditions/vid/1080p.mp4', content);

    const res = await request(app.getHttpServer())
      .get('/files/renditions/vid/1080p.mp4')
      .set('Range', 'bytes=10-');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 10-${content.length - 1}/${content.length}`);
    expect(Buffer.from(res.body).equals(content.subarray(10))).toBe(true);
  });

  it('serves a 206 for a suffix range (bytes=-N) of the last N bytes', async () => {
    const content = Buffer.from('abcdefghij');
    await storage.write('renditions/vid/480p.mp4', content);

    const res = await request(app.getHttpServer())
      .get('/files/renditions/vid/480p.mp4')
      .set('Range', 'bytes=-3');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 7-9/${content.length}`);
    expect(Buffer.from(res.body).equals(content.subarray(7))).toBe(true);
  });

  it('returns 416 for an unsatisfiable range past the end of the file', async () => {
    const content = Buffer.from('short');
    await storage.write('renditions/vid/480p.mp4', content);

    const res = await request(app.getHttpServer())
      .get('/files/renditions/vid/480p.mp4')
      .set('Range', 'bytes=100-200');

    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${content.length}`);
  });

  it('returns 404 for a missing file', async () => {
    const res = await request(app.getHttpServer()).get('/files/renditions/missing/2K.mp4');
    expect(res.status).toBe(404);
  });

  it('returns 404 (never serves) for a path-traversal attempt outside the base dir', async () => {
    const res = await request(app.getHttpServer()).get('/files/../../etc/passwd');
    // Express may normalize some traversal; either way we must not return file contents.
    expect(res.status).toBe(404);
  });
});
