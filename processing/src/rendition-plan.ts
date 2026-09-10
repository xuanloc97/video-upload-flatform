import { RenditionLabel } from '@video-platform/shared';

/**
 * Downscale-only rendition planning (design "Transcode").
 *
 * The platform targets four resolutions — 2K / 1080p / 720p / 480p — defined by their vertical
 * resolution (height). Renditions are only ever produced at or below the source resolution: a 480p
 * source is never upscaled to 2K, and small sources simply gain fewer renditions (Req 6.2). Aspect
 * ratio is preserved and both dimensions are forced even (required by the yuv420p pixel format used
 * for broad player compatibility).
 */

/** A rendition target keyed by its canonical height. */
export interface RenditionTarget {
  label: RenditionLabel;
  /** Target vertical resolution in pixels. */
  height: number;
}

/**
 * Canonical rendition ladder, ordered largest-first. "2K" here means 1440p (2560×1440 at 16:9),
 * the common streaming meaning of 2K, not DCI 2K.
 */
export const RENDITION_LADDER: readonly RenditionTarget[] = [
  { label: '2K', height: 1440 },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p', height: 480 },
];

/** A concrete rendition to produce: label plus exact output pixel dimensions. */
export interface PlannedRendition {
  label: RenditionLabel;
  width: number;
  height: number;
}

/** Round `value` to the nearest even integer ≥ 2 (yuv420p requires even width/height). */
function toEven(value: number): number {
  const rounded = Math.round(value);
  const even = rounded % 2 === 0 ? rounded : rounded - 1;
  return Math.max(2, even);
}

/**
 * Compute the downscale-only rendition set for a source of `sourceWidth`×`sourceHeight`.
 *
 * Rules (Req 6.2, 6.3):
 * - Only targets whose height is ≤ the source height are produced (never upscale).
 * - Each output preserves the source aspect ratio, with width derived from the target height.
 * - Dimensions are forced even.
 * - If the source is smaller than every ladder rung, a single rendition at the source's own
 *   (evened) resolution is produced so there is always at least one playable output.
 *
 * The result is ordered largest-first and contains no duplicate resolutions.
 */
export function planRenditions(sourceWidth: number, sourceHeight: number): PlannedRendition[] {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`Invalid source dimensions: ${sourceWidth}x${sourceHeight}`);
  }

  const aspect = sourceWidth / sourceHeight;
  const planned: PlannedRendition[] = [];
  const seen = new Set<string>();

  for (const target of RENDITION_LADDER) {
    if (target.height > sourceHeight) {
      continue; // downscale-only: skip rungs taller than the source
    }
    const height = toEven(target.height);
    const width = toEven(height * aspect);
    const key = `${width}x${height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    planned.push({ label: target.label, width, height });
  }

  // Source smaller than the smallest rung (e.g. a 360p clip): still emit one rendition at the
  // source's own resolution, labelled with the smallest ladder rung so downstream code has a label.
  if (planned.length === 0) {
    const height = toEven(sourceHeight);
    const width = toEven(sourceWidth);
    const smallest = RENDITION_LADDER[RENDITION_LADDER.length - 1];
    planned.push({ label: smallest.label, width, height });
  }

  return planned;
}
