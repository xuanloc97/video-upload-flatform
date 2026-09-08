import * as fc from 'fast-check';
import { TempSqliteMetadataStore } from './metadata-store';
import { ProcessingStatus } from './types';

/*
 * Property tests for the DB-backed job queue behavior of SqliteMetadataStore: atomic claim
 * (Property 12), stuck-job recovery (Property 16), and manual retry (Property 17). Each runs against
 * a fresh temp-SQLite store so no cluster is needed. better-sqlite3 is synchronous, so within one
 * process a write runs to completion before any other JS — that is precisely the serialization these
 * operations rely on, letting us assert the invariants deterministically.
 */

/** Seed `n` PENDING upload records with strictly increasing upload timestamps. */
function seedPending(store: TempSqliteMetadataStore, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `u-${i}`;
    store.createUpload({
      id,
      originalFilename: `${id}.mp4`,
      storedPath: `originals/${id}.mp4`,
      // Distinct, ordered timestamps so "oldest first" claiming is well defined.
      uploadedAt: new Date(Date.UTC(2024, 0, 1) + i * 1000).toISOString(),
    });
    ids.push(id);
  }
  return ids;
}

describe('SqliteMetadataStore job-queue properties', () => {
  let store: TempSqliteMetadataStore;

  beforeEach(async () => {
    store = await TempSqliteMetadataStore.create();
  });

  afterEach(async () => {
    await store.cleanup();
  });

  /*
   * Feature: video-upload-platform, Property 12: Claiming a job is atomic and exclusive
   *
   * Given N PENDING records, calling claimNext K times returns exactly min(N, K) distinct records,
   * each transitioned to PROCESSING with a processingStartedAt stamp, in oldest-first order, and
   * once all are claimed further calls return null. No record is ever claimed twice.
   *
   * Validates: Requirements 6.1
   */
  it('Property 12: claimNext claims each PENDING record exactly once, oldest first', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 16 }),
        async (n, k) => {
          const local = await TempSqliteMetadataStore.create();
          try {
            const seeded = seedPending(local, n);

            const claimedIds: string[] = [];
            for (let i = 0; i < k; i++) {
              const claimed = local.claimNext();
              if (claimed === null) {
                break;
              }
              // Every claimed record is now PROCESSING with a start stamp.
              expect(claimed.status).toBe(ProcessingStatus.PROCESSING);
              expect(claimed.processingStartedAt).not.toBeNull();
              claimedIds.push(claimed.id);
            }

            const expectedCount = Math.min(n, k);
            expect(claimedIds).toHaveLength(expectedCount);
            // Exclusive: no id claimed twice.
            expect(new Set(claimedIds).size).toBe(claimedIds.length);
            // Oldest-first: claims follow seed order.
            expect(claimedIds).toEqual(seeded.slice(0, expectedCount));

            // Exactly `expectedCount` records are PROCESSING; the rest remain PENDING.
            const processing = local
              .listUploads()
              .filter((u) => u.status === ProcessingStatus.PROCESSING);
            expect(processing).toHaveLength(expectedCount);

            // If we claimed everything available, the queue is drained.
            if (k >= n) {
              expect(local.claimNext()).toBeNull();
            }
          } finally {
            await local.cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 16: Stuck jobs recover to PENDING
   *
   * A record left in PROCESSING longer than the timeout (or with no start stamp) is reset to
   * PENDING with processingStartedAt cleared; a record that started within the timeout window is
   * left untouched. Records in other states are never affected.
   *
   * Validates: Requirements 7.1
   */
  it('Property 16: resetStuckProcessing re-queues only timed-out PROCESSING records', async () => {
    // Ages (ms) since "now" that each PROCESSING record started. Some are stale (> timeout),
    // some are fresh (< timeout). null models a record with no start stamp (also stuck).
    const ageArb = fc.oneof(
      fc.constant<number | null>(null),
      fc.integer({ min: 0, max: 600_000 }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(ageArb, { minLength: 0, maxLength: 12 }), async (ages) => {
        const local = await TempSqliteMetadataStore.create();
        try {
          const timeoutMs = 300_000; // 5 minutes
          const now = new Date(Date.UTC(2024, 5, 1, 12, 0, 0));
          const nowIso = now.toISOString();

          // Set up one PROCESSING record per age.
          const expectStuck = new Set<string>();
          ages.forEach((age, i) => {
            const id = `p-${i}`;
            local.createUpload({
              id,
              originalFilename: `${id}.mp4`,
              storedPath: `originals/${id}.mp4`,
            });
            const startedAt =
              age === null ? null : new Date(now.getTime() - age).toISOString();
            local.updateUpload(id, {
              status: ProcessingStatus.PROCESSING,
              processingStartedAt: startedAt,
            });
            // Stuck iff no start stamp OR started at/earlier than the cutoff.
            if (age === null || age >= timeoutMs) {
              expectStuck.add(id);
            }
          });

          const resetIds = local.resetStuckProcessing(timeoutMs, nowIso);

          // The returned set is exactly the records we expected to be stuck.
          expect(new Set(resetIds)).toEqual(expectStuck);

          for (const u of local.listUploads()) {
            if (expectStuck.has(u.id)) {
              expect(u.status).toBe(ProcessingStatus.PENDING);
              expect(u.processingStartedAt).toBeNull();
            } else {
              // Fresh PROCESSING records are untouched.
              expect(u.status).toBe(ProcessingStatus.PROCESSING);
              expect(u.processingStartedAt).not.toBeNull();
            }
          }
        } finally {
          await local.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  /*
   * Feature: video-upload-platform, Property 17: Retry resets a FAILED record to PENDING
   *
   * For a FAILED record, retryProcessing transitions it to PENDING and clears both the error and
   * processingStartedAt. For a record in any non-FAILED state, retryProcessing throws and leaves the
   * record unchanged.
   *
   * Validates: Requirements 7.2
   */
  it('Property 17: retryProcessing resets FAILED to PENDING and rejects other states', async () => {
    const statusArb = fc.constantFrom(
      ProcessingStatus.PENDING,
      ProcessingStatus.PROCESSING,
      ProcessingStatus.COMPLETED,
      ProcessingStatus.FAILED,
    );

    await fc.assert(
      fc.asyncProperty(statusArb, async (status) => {
        const local = await TempSqliteMetadataStore.create();
        try {
          local.createUpload({
            id: 'x',
            originalFilename: 'x.mp4',
            storedPath: 'originals/x.mp4',
          });
          // Drive the record into the chosen state, giving FAILED an error + start stamp to clear.
          local.updateUpload('x', {
            status,
            error: status === ProcessingStatus.FAILED ? 'boom' : null,
            processingStartedAt:
              status === ProcessingStatus.PROCESSING || status === ProcessingStatus.FAILED
                ? '2024-01-01T00:00:00.000Z'
                : null,
          });

          if (status === ProcessingStatus.FAILED) {
            const retried = local.retryProcessing('x');
            expect(retried.status).toBe(ProcessingStatus.PENDING);
            expect(retried.error).toBeNull();
            expect(retried.processingStartedAt).toBeNull();
            // Persisted, not just returned.
            expect(local.getUpload('x')!.status).toBe(ProcessingStatus.PENDING);
          } else {
            expect(() => local.retryProcessing('x')).toThrow(/FAILED/);
            // Unchanged.
            expect(local.getUpload('x')!.status).toBe(status);
          }
        } finally {
          await local.cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 17 (edge): retryProcessing throws for a missing id', () => {
    expect(() => store.retryProcessing('does-not-exist')).toThrow(/not found/i);
  });
});
