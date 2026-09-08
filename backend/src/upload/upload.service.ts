import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  MetadataStore,
  ProcessingStatus,
  Storage,
  UploadRecord,
} from '@video-platform/shared';
import { METADATA_STORE, MP4_PROBE, STORAGE } from '../storage.tokens';
import {
  FTYP_HEADER_BYTES,
  hasFtypMagic,
  InvalidMp4Error,
  Mp4Probe,
} from '../mp4-validation';

/** Relative directory (under the storage base) where original uploads are stored. */
export const ORIGINALS_DIR = 'originals';

/** Minimal shape of an incoming file, matching `graphql-upload`'s resolved upload. */
export interface IncomingUpload {
  /** Original client-provided filename (Req 3.2). */
  filename: string;
  /** MIME type reported by the client (advisory only; not trusted for validation). */
  mimetype?: string;
  /** Returns a fresh readable stream of the file bytes. */
  createReadStream(): Readable;
}

/**
 * Upload service: streams an incoming file to `originals/<id>.mp4` without buffering it in memory,
 * validates it as an MP4 (magic bytes + injected probe), and — only on success — creates a PENDING
 * Upload_Record via the shared metadata store (Reqs 2.2–2.5).
 *
 * Ordering is deliberate: the file is streamed to disk first (so 4K inputs never sit in memory),
 * then validated, and if validation fails the streamed original is deleted and no record is
 * created (Req 2.4 — reject before any record/file persists).
 */
@Injectable()
export class UploadService {
  constructor(
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(METADATA_STORE) private readonly metadata: MetadataStore,
    @Inject(MP4_PROBE) private readonly probe: Mp4Probe,
  ) {}

  /**
   * Handle one uploaded file end to end.
   * @throws InvalidMp4Error if the file is not a valid MP4 (after cleaning up the partial file).
   */
  async handleUpload(file: IncomingUpload): Promise<UploadRecord> {
    const id = randomUUID();
    const relativePath = path.posix.join(ORIGINALS_DIR, `${id}.mp4`);
    const absolutePath = path.resolve(this.storage.baseDir, ORIGINALS_DIR, `${id}.mp4`);

    await this.streamToDisk(file, absolutePath);

    try {
      await this.validate(absolutePath);
    } catch (err) {
      // Reject before any record is created and leave no stored file behind (Req 2.4).
      await this.safeUnlink(absolutePath);
      throw err;
    }

    return this.metadata.createUpload({
      id,
      originalFilename: file.filename,
      storedPath: relativePath,
    });
  }

  /** Pipe the upload stream to `absolutePath`, creating parent dirs, without buffering the file. */
  private async streamToDisk(file: IncomingUpload, absolutePath: string): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      await pipeline(file.createReadStream(), createWriteStream(absolutePath));
    } catch (err) {
      await this.safeUnlink(absolutePath);
      throw err;
    }
  }

  /** Run both MP4 checks against the file already on disk. Throws {@link InvalidMp4Error} on failure. */
  private async validate(absolutePath: string): Promise<void> {
    const header = await this.readHeader(absolutePath);
    if (!hasFtypMagic(header)) {
      throw new InvalidMp4Error(
        'Uploaded file is not a valid MP4: missing ftyp box in the file header.',
      );
    }

    const result = await this.probe.probe(absolutePath);
    if (!result.valid) {
      throw new InvalidMp4Error(
        `Uploaded file is not a valid MP4: ${result.reason ?? 'failed container/codec check'}.`,
      );
    }
  }

  /** Read the leading bytes needed for the ftyp magic-byte check without loading the whole file. */
  private async readHeader(absolutePath: string): Promise<Buffer> {
    const handle = await fs.open(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(FTYP_HEADER_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, FTYP_HEADER_BYTES, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  /** Delete a file if it exists, ignoring "not found" so cleanup is idempotent. */
  private async safeUnlink(absolutePath: string): Promise<void> {
    try {
      await fs.unlink(absolutePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
