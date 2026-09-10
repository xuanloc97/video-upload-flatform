import { Readable } from 'stream';
import { Mp4Probe, Mp4ProbeResult } from '../mp4-validation';
import { IncomingUpload } from './upload.service';

/**
 * Test helpers for exercising {@link UploadService} directly (no HTTP / GraphQL server), backed by
 * the shared temp-dir Storage + temp-SQLite MetadataStore. Kept out of `.test.ts` so Jest does not
 * treat this file as a test suite.
 */

/** Build an {@link IncomingUpload} whose stream yields `content`, mimicking `graphql-upload`. */
export function makeUpload(filename: string, content: Buffer, mimetype = 'video/mp4'): IncomingUpload {
  return {
    filename,
    mimetype,
    // A fresh stream per call, matching graphql-upload's createReadStream contract.
    createReadStream: () => Readable.from(content),
  };
}

/**
 * Build a minimal buffer that begins with a valid ISO-BMFF `ftyp` box: a 4-byte big-endian box
 * size followed by the ASCII type "ftyp", then arbitrary trailing bytes. This satisfies the
 * magic-byte check without needing a real encoder.
 */
export function makeFtypBuffer(trailing: Buffer = Buffer.alloc(0)): Buffer {
  const boxSize = 8 + trailing.length;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(boxSize, 0);
  return Buffer.concat([size, Buffer.from('ftyp', 'ascii'), trailing]);
}

/** A probe stub that always reports a valid MP4 with the given dimensions. */
export class StubValidProbe implements Mp4Probe {
  constructor(
    private readonly width?: number,
    private readonly height?: number,
  ) {}

  async probe(): Promise<Mp4ProbeResult> {
    return { valid: true, width: this.width, height: this.height };
  }
}

/** A probe stub that always rejects with the given reason. */
export class StubInvalidProbe implements Mp4Probe {
  constructor(private readonly reason = 'stubbed invalid container') {}

  async probe(): Promise<Mp4ProbeResult> {
    return { valid: false, reason: this.reason };
  }
}

/**
 * Build a fully-wired {@link UploadResolver} over the given Storage + MetadataStore, using a probe
 * stub that accepts everything. Lets the query resolvers (`videos`/`videoStatus`/`videoMetadata`)
 * be exercised directly — no HTTP/GraphQL server needed — against temp-dir/temp-SQLite backends.
 */
export function makeResolver(
  storage: import('@video-platform/shared').Storage,
  metadata: import('@video-platform/shared').MetadataStore,
): import('./upload.resolver').UploadResolver {
  // Lazy require to avoid a load-time cycle (resolver -> service -> helpers in some orderings).

  const { UploadService } = require('./upload.service') as typeof import('./upload.service');

  const { UploadResolver } = require('./upload.resolver') as typeof import('./upload.resolver');
  const service = new UploadService(storage, metadata, new StubValidProbe());
  return new UploadResolver(service, metadata);
}
