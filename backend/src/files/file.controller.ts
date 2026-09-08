import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Storage } from '@video-platform/shared';
import { STORAGE } from '../storage.tokens';
import { FILE_ROUTE_PREFIX } from './file-route';

/** Map of file extension → Content-Type for the media we serve (renditions + thumbnails). */
const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Fallback content type when the extension is unknown. */
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * REST-style file-serving route (design "File serving").
 *
 * Streams rendition and thumbnail bytes from the shared `/uploads` volume with the correct
 * Content-Type and HTTP `Range` support so the frontend's `<video>` player can seek during playback
 * (Reqs 4.3, 4.4). All *API* traffic still goes through GraphQL; only binary file fetches use this
 * route (Req 9.5).
 *
 * The wildcard path is resolved against the {@link Storage} base directory and guarded against path
 * traversal so a request can never escape `/uploads`.
 */
@Controller(FILE_ROUTE_PREFIX.replace(/^\//, ''))
export class FileController {
  constructor(@Inject(STORAGE) private readonly storage: Storage) {}

  @Get('*')
  async serve(
    @Param('0') requestedPath: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const absolutePath = this.resolveWithinBase(requestedPath);
    if (!absolutePath) {
      throw new NotFoundException('File not found');
    }

    const stat = await this.statFile(absolutePath);
    if (!stat) {
      throw new NotFoundException('File not found');
    }

    const contentType = CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
    const total = stat.size;

    res.setHeader('Content-Type', contentType);
    // Advertise range support so players know they can seek (Req 4.3 playback).
    res.setHeader('Accept-Ranges', 'bytes');

    const range = this.parseRange(req.headers.range, total);

    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }

    if (range) {
      // Partial content: stream only the requested byte window.
      const { start, end } = range;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      this.pipeFile(absolutePath, res, start, end);
      return;
    }

    // Full body.
    res.status(200);
    res.setHeader('Content-Length', String(total));
    this.pipeFile(absolutePath, res);
  }

  /**
   * Resolve `requestedPath` against the storage base dir, returning the absolute path only if it
   * stays inside the base directory; otherwise null (path traversal is refused).
   */
  private resolveWithinBase(requestedPath: string): string | null {
    // Decode percent-encoding produced by fileRouteUrl and normalize separators.
    let decoded: string;
    try {
      decoded = decodeURIComponent(requestedPath);
    } catch {
      return null;
    }
    decoded = decoded.replace(/\\/g, '/');

    const base = path.resolve(this.storage.baseDir);
    const target = path.resolve(base, decoded);
    const rel = path.relative(base, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return null;
    }
    return target;
  }

  /** Stat the file; return null (treated as 404) if it does not exist or is not a regular file. */
  private async statFile(absolutePath: string): Promise<{ size: number } | null> {
    try {
      const stat = await fs.stat(absolutePath);
      return stat.isFile() ? { size: stat.size } : null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a single-range `Range` header of the form `bytes=start-end` against `total` bytes.
   * Returns the resolved inclusive `{ start, end }`, `undefined` when there is no range header,
   * or the string `'invalid'` when the range is unsatisfiable (→ 416).
   */
  private parseRange(
    header: string | undefined,
    total: number,
  ): { start: number; end: number } | undefined | 'invalid' {
    if (!header) {
      return undefined;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) {
      return 'invalid';
    }
    const [, startRaw, endRaw] = match;

    let start: number;
    let end: number;
    if (startRaw === '') {
      // Suffix range: last N bytes.
      if (endRaw === '') {
        return 'invalid';
      }
      const suffix = Number(endRaw);
      if (suffix <= 0) {
        return 'invalid';
      }
      start = Math.max(total - suffix, 0);
      end = total - 1;
    } else {
      start = Number(startRaw);
      end = endRaw === '' ? total - 1 : Number(endRaw);
    }

    if (start > end || start < 0 || start >= total) {
      return 'invalid';
    }
    // Clamp end to the last byte.
    end = Math.min(end, total - 1);
    return { start, end };
  }

  /** Pipe a file (optionally a byte window) to the response, cleaning up on error. */
  private pipeFile(absolutePath: string, res: Response, start?: number, end?: number): void {
    const stream =
      start !== undefined && end !== undefined
        ? createReadStream(absolutePath, { start, end })
        : createReadStream(absolutePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });
    stream.pipe(res);
  }
}
