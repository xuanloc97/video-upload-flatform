import { ProcessingStatus, RenditionLabel } from '@video-platform/shared';

/**
 * The subset of an Upload_Record the worker needs to process a job. The backend owns the full
 * record; it hands the worker just the id and where the original lives.
 */
export interface ClaimedJob {
  id: string;
  /** Relative path of the original under `/uploads`, e.g. `originals/<id>.mp4`. */
  storedPath: string;
}

/** A rendition reference the worker reports back to the backend on completion. */
export interface RenditionRef {
  label: RenditionLabel;
  /** Relative path under `/uploads`, e.g. `renditions/<id>/1080p.mp4`. */
  path: string;
  width: number;
  height: number;
}

/** Payload for reporting a terminal processing result to the backend. */
export interface ProcessingResult {
  id: string;
  status: ProcessingStatus.COMPLETED | ProcessingStatus.FAILED;
  renditions?: RenditionRef[];
  /** Relative thumbnail path, e.g. `thumbnails/<id>.jpg`; set on success. */
  thumbnailPath?: string;
  /** Error message; set on failure. */
  error?: string;
}

/**
 * Backend communication contract (design "Metadata ownership"). The processing component never
 * opens `metadata.db`; it claims work and reports results through the backend, keeping a single
 * writer to SQLite. Injecting this interface lets the worker be tested without a live backend.
 */
export interface BackendClient {
  /** Atomically claim the next PENDING job (backend flips it to PROCESSING), or null if none. */
  claimNext(): Promise<ClaimedJob | null>;

  /** Report a COMPLETED (with refs) or FAILED (with error) result for a job. */
  updateProcessingResult(result: ProcessingResult): Promise<void>;
}

/** Minimal shape of a GraphQL-over-HTTP response body. */
interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * GraphQL-over-HTTP {@link BackendClient} used in production. Talks to the backend's internal
 * `claimNext` and `updateProcessingResult` mutations via `fetch` (Node 18+ global fetch).
 */
export class GraphQLBackendClient implements BackendClient {
  constructor(private readonly endpoint: string) {}

  async claimNext(): Promise<ClaimedJob | null> {
    // The backend's UploadRecord schema does not expose storedPath; the worker derives the original
    // path from the id (originals/<id>.mp4), so the claim only needs the id.
    const data = await this.request<{ claimNext: { id: string } | null }>(
      `mutation ClaimNext { claimNext { id } }`,
    );
    const claimed = data.claimNext;
    if (!claimed) {
      return null;
    }
    return { id: claimed.id, storedPath: `originals/${claimed.id}.mp4` };
  }

  async updateProcessingResult(result: ProcessingResult): Promise<void> {
    const mutation = `
      mutation UpdateResult($input: ProcessingResultInput!) {
        updateProcessingResult(input: $input) { id status }
      }`;
    await this.request(mutation, {
      input: {
        id: result.id,
        status: result.status,
        renditions: result.renditions?.map((r) => ({
          label: r.label,
          path: r.path,
          width: r.width,
          height: r.height,
        })),
        thumbnailPath: result.thumbnailPath ?? null,
        error: result.error ?? null,
      },
    });
  }

  /** Execute a GraphQL request, throwing on transport or GraphQL-level errors. */
  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Backend GraphQL request failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors && body.errors.length > 0) {
      throw new Error(`Backend GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) {
      throw new Error('Backend GraphQL response contained no data');
    }
    return body.data;
  }
}
