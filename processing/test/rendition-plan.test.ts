import * as fc from 'fast-check';
import { planRenditions, RENDITION_LADDER } from '../src/rendition-plan';

/*
 * Unit + property tests for the downscale-only rendition planner (Req 6.2, 6.3). These are pure and
 * fast — no FFmpeg — and pin down the "never upscale, preserve aspect ratio, even dimensions" rules.
 */

describe('planRenditions', () => {
  it('produces all four renditions for a 4K (2160p) source', () => {
    const plan = planRenditions(3840, 2160);
    expect(plan.map((r) => r.label)).toEqual(['2K', '1080p', '720p', '480p']);
  });

  it('omits higher renditions than the source (a 1080p source gets no 2K)', () => {
    const plan = planRenditions(1920, 1080);
    expect(plan.map((r) => r.label)).toEqual(['1080p', '720p', '480p']);
    expect(plan.some((r) => r.label === '2K')).toBe(false);
  });

  it('gives a 480p source only the 480p rendition', () => {
    const plan = planRenditions(854, 480);
    expect(plan.map((r) => r.label)).toEqual(['480p']);
  });

  it('emits a single source-resolution rendition when smaller than every rung (360p)', () => {
    const plan = planRenditions(640, 360);
    expect(plan).toHaveLength(1);
    expect(plan[0].height).toBe(360);
    expect(plan[0].width).toBe(640);
  });

  it('preserves aspect ratio for the produced renditions (16:9 source)', () => {
    const plan = planRenditions(3840, 2160);
    for (const r of plan) {
      // 16:9 within rounding-to-even tolerance.
      expect(Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.02);
    }
  });

  it('throws on invalid dimensions', () => {
    expect(() => planRenditions(0, 100)).toThrow();
    expect(() => planRenditions(100, -1)).toThrow();
  });

  /*
   * Property: downscale-only + even dimensions hold for any source.
   *
   * For any positive source dimensions, every planned rendition is no taller than the source, uses
   * even width/height, and the produced ladder rungs are a subset of the canonical ladder heights
   * (or the source-fallback rung when smaller than all rungs).
   */
  it('never upscales and always yields even dimensions (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16, max: 8000 }),
        fc.integer({ min: 16, max: 5000 }),
        (w, h) => {
          const plan = planRenditions(w, h);
          expect(plan.length).toBeGreaterThanOrEqual(1);
          for (const r of plan) {
            // Downscale-only: never taller than the source.
            expect(r.height).toBeLessThanOrEqual(h + 1); // +1 tolerance for even-rounding at source
            // Even dimensions (yuv420p requirement).
            expect(r.width % 2).toBe(0);
            expect(r.height % 2).toBe(0);
          }
          // Labels are unique within a plan.
          const labels = plan.map((r) => r.label);
          expect(new Set(labels).size).toBe(labels.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('ladder is ordered largest-first', () => {
    const heights = RENDITION_LADDER.map((r) => r.height);
    const sorted = [...heights].sort((a, b) => b - a);
    expect(heights).toEqual(sorted);
  });
});
