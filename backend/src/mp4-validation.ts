/**
 * MP4 validation used by the upload path (Req 2.4). Validation combines two independent checks per
 * the design ("Upload handling"):
 *
 *   (a) Magic bytes — a well-formed MP4/ISO-BMFF file begins with a `ftyp` box whose 4-byte type
 *       field ("ftyp") sits at offset 4..8, right after the box's 4-byte big-endian size. This
 *       cheaply rejects renamed `.txt` files and non-MP4 containers with a spoofed extension.
 *   (b) A container/codec probe (`ffprobe`) confirming the bytes are actually a decodable MP4. The
 *       probe is injected (see {@link Mp4Probe}) so the logic is testable without a real binary.
 *
 * Keeping both checks pure/injectable means the streaming upload code can validate the file that was
 * written to disk and reject it before any Upload_Record is created.
 */

/** Number of leading bytes we need to inspect for the `ftyp` box type field. */
export const FTYP_HEADER_BYTES = 12;

/** ASCII "ftyp" — the ISO Base Media File Format box type that a valid MP4 opens with. */
const FTYP_MAGIC = Buffer.from('ftyp', 'ascii');

/**
 * True if `header` looks like the start of an MP4/ISO-BMFF file: the bytes at offset 4..8 equal the
 * ASCII string "ftyp". `header` should be the first {@link FTYP_HEADER_BYTES} bytes of the file (a
 * shorter buffer, e.g. a truncated file, fails the check).
 */
export function hasFtypMagic(header: Buffer): boolean {
  if (header.length < 8) {
    return false;
  }
  return header.subarray(4, 8).equals(FTYP_MAGIC);
}

/** Result of a container/codec probe of a candidate MP4 file. */
export interface Mp4ProbeResult {
  /** True if the probe considers the file a valid, decodable MP4 container. */
  valid: boolean;
  /** Video stream width in pixels, if the probe could determine it. */
  width?: number;
  /** Video stream height in pixels, if the probe could determine it. */
  height?: number;
  /** Optional human-readable reason when `valid` is false. */
  reason?: string;
}

/**
 * Injectable MP4 container/codec probe.
 *
 * Production binds an `ffprobe`-backed implementation; tests bind a stub that decides
 * deterministically from the file bytes. The probe receives the absolute path of the file already
 * streamed to disk so it never has to buffer the (potentially 4K) upload in memory.
 */
export interface Mp4Probe {
  probe(absolutePath: string): Promise<Mp4ProbeResult>;
}

/** Error thrown when an uploaded file fails MP4 validation; carries a descriptive message (Req 2.4). */
export class InvalidMp4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMp4Error';
  }
}
