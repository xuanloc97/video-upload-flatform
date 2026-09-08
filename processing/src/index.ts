/**
 * Processing worker entrypoint (design "Processing Component").
 *
 * Wires the production implementations — a filesystem Storage over `/uploads`, the FFmpeg-backed
 * transcoder, and a GraphQL client to the backend — and runs a simple poll loop that claims and
 * processes one job at a time. The worker is intentionally single-replica (the metadata store is
 * single-writer SQLite and the queue is claimed serially), so a sequential loop is the right model.
 */
import { FileSystemStorage } from '@video-platform/shared';
import { GraphQLBackendClient } from './backend-client';
import { FfmpegTranscoder } from './ffmpeg';
import { ProcessingWorker } from './worker';

export { ProcessingWorker } from './worker';
export { planRenditions, RENDITION_LADDER } from './rendition-plan';
export { FfmpegTranscoder } from './ffmpeg';
export { GraphQLBackendClient } from './backend-client';
export { MetadataStoreBackendClient } from './metadata-backend-client';
export type { Transcoder } from './ffmpeg';
export type { BackendClient, ClaimedJob, ProcessingResult } from './backend-client';

/** Default base directory for the shared `/uploads` volume when `UPLOADS_DIR` is unset. */
const DEFAULT_UPLOADS_DIR = '/uploads';
/** Default internal GraphQL endpoint of the backend service. */
const DEFAULT_BACKEND_GRAPHQL = 'http://backend:3000/graphql';
/** Poll interval (ms) between claim attempts when the queue is empty. */
const DEFAULT_POLL_INTERVAL_MS = 2000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const uploadsDir = process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR;
  const backendUrl = process.env.BACKEND_GRAPHQL_URL ?? DEFAULT_BACKEND_GRAPHQL;
  const pollMs = Number(process.env.POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);

  const storage = new FileSystemStorage(uploadsDir);
  const transcoder = new FfmpegTranscoder();
  const backend = new GraphQLBackendClient(backendUrl);
  const worker = new ProcessingWorker(storage, transcoder, backend);

  // eslint-disable-next-line no-console
  console.log(
    `Processing worker started. uploads=${uploadsDir} backend=${backendUrl} poll=${pollMs}ms`,
  );

  // Sequential poll loop: process jobs back-to-back while work exists, then idle for pollMs.
  for (;;) {
    let processedId: string | null = null;
    try {
      processedId = await worker.processOne();
    } catch (err) {
      // processOne already reports FAILED per-job; a throw here is an unexpected loop error.
      // eslint-disable-next-line no-console
      console.error('Worker loop error:', (err as Error).message);
    }
    if (!processedId) {
      await sleep(pollMs);
    }
  }
}

// Only run the loop when executed directly, not when imported by tests.
if (require.main === module) {
  void main();
}
