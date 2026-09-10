import { Controller, Get, Header, Inject, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Storage } from '@video-platform/shared';
import { STORAGE } from '../storage.tokens';
import { contentTypeForPath, parseRangeHeader } from './file-serving';

/**
 * REST-style file-serving route (design "File serving", Req 4.3, 4.4).
 *
 * Streams rendition/thumbnail files from the shared `/uploads` volume with the correct Content-Type
 * and full HTTP Range support (206 Partial Content) so the frontend `<video>` player can seek. This
 * is deliberately NOT GraphQL: the frontend performs all *API* calls over GraphQL (Req 9.5) but
 * fetches binary media through these `/files/...` URLs.
 *
 * Security: the requested path is resolved through the Storage abstraction's path-traversal guard
 * ({@link Storage.resolvePath}); anything that would escape `/uploads`, or a missing file, yields a
 * 404 rather than leaking filesystem contents.
 */
@Controller('files')
export class FilesController {
  constructor(@Inject(STORAGE) private readonly storage: Storage) {}

  @Get('*')
  @Header('Cache-Control', 'public, max-age=3600')
  async serve(
    @Param('0') relativePath: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Guard against path traversal and confirm the file exists; both failure modes are a 404 so we
    // never disclose whether a path is outside the base dir vs. simply missing.
    let size: number;
    try {
      const stats = await this.storage.stat(relativePath);
      if (!stats.isFile()) {
        res.status(404).send('Not found');
        return;
      }
      size = stats.size;
    } catch {
      res.status(404).send('Not found');
      return;
    }

    const contentType = contentTypeForPath(relativePath);
    res.setHeader('Content-Type', contentType);
    // Advertise range support so players know they can seek.
    res.setHeader('Accept-Ranges', 'bytes');

    const parsed = parseRangeHeader(req.headers.range, size);

    if (parsed.kind === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${parsed.size}`);
      res.status(416).send('Requested Range Not Satisfiable');
      return;
    }

    if (parsed.kind === 'satisfiable') {
      const { start, end, contentLength } = parsed.range;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(contentLength));
      const stream = this.storage.createReadStream(relativePath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    // No Range header: full 200 response.
    res.status(200);
    res.setHeader('Content-Length', String(size));
    const stream = this.storage.createReadStream(relativePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }
}
