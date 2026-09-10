import { promises as fs } from 'fs';
import { BackendClient, ClaimedJob, ProcessingResult } from '../src/backend-client';
import { Transcoder } from '../src/ffmpeg';
import { PlannedRendition } from '../src/rendition-plan';

/**
 * Test doubles for exercising {@link ProcessingWorker} without FFmpeg or a live backend. Kept out of
 * a `.test.ts` file so Jest does not treat it as a suite.
 */

/**
 * A {@link Transcoder} stub that writes tiny placeholder files instead of invoking FFmpeg, so the
 * worker's staging/move/callback logic can be validated fast and deterministically. Configurable to
 * report fixed source dimensions and to fail on a chosen step.
 */
export class StubTranscoder implements Transcoder {
  transcodeCalls = 0;
  thumbnailCalls = 0;

  constructor(
    private readonly dimensions: { width: number; height: number } = { width: 1920, height: 1080 },
    private readonly failOn: 'none' | 'probe' | 'rendition' | 'thumbnail' = 'none',
  ) {}

  async probeDimensions(): Promise<{ width: number; height: number }> {
    if (this.failOn === 'probe') {
      throw new Error('stub probe failure');
    }
    return this.dimensions;
  }

  async transcodeRendition(
    _inputPath: string,
    outputPath: string,
    rendition: PlannedRendition,
  ): Promise<void> {
    this.transcodeCalls++;
    if (this.failOn === 'rendition') {
      throw new Error('stub rendition failure');
    }
    await fs.writeFile(outputPath, `rendition:${rendition.label}:${rendition.width}x${rendition.height}`);
  }

  async extractThumbnail(_inputPath: string, outputPath: string): Promise<void> {
    this.thumbnailCalls++;
    if (this.failOn === 'thumbnail') {
      throw new Error('stub thumbnail failure');
    }
    await fs.writeFile(outputPath, 'thumbnail-bytes');
  }
}

/** A {@link BackendClient} stub that hands out a queued set of jobs and records reported results. */
export class StubBackendClient implements BackendClient {
  results: ProcessingResult[] = [];
  private readonly queue: ClaimedJob[];

  constructor(queue: ClaimedJob[] = []) {
    this.queue = [...queue];
  }

  async claimNext(): Promise<ClaimedJob | null> {
    return this.queue.shift() ?? null;
  }

  async updateProcessingResult(result: ProcessingResult): Promise<void> {
    this.results.push(result);
  }

  /** The single result reported for `id`, or undefined. */
  resultFor(id: string): ProcessingResult | undefined {
    return this.results.find((r) => r.id === id);
  }
}
