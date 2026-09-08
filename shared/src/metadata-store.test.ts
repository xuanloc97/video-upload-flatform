import {
  DEFAULT_MAX_WRITE_ATTEMPTS,
  isSqliteBusyError,
  runWithBusyRetry,
  TempSqliteMetadataStore,
} from './metadata-store';
import { ProcessingStatus } from './types';

/** Build an Error carrying a better-sqlite3-style `code`, e.g. 'SQLITE_BUSY'. */
function sqliteError(code: string, message = code): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe('SqliteMetadataStore / TempSqliteMetadataStore', () => {
  let store: TempSqliteMetadataStore;

  beforeEach(async () => {
    store = await TempSqliteMetadataStore.create();
  });

  afterEach(async () => {
    await store.cleanup();
  });

  it('creates an upload with PENDING status and reads it back', () => {
    const created = store.createUpload({
      id: 'id-1',
      originalFilename: 'clip.mp4',
      storedPath: 'originals/id-1.mp4',
    });
    expect(created.status).toBe(ProcessingStatus.PENDING);
    expect(created.originalFilename).toBe('clip.mp4');
    expect(created.thumbnailPath).toBeNull();

    const fetched = store.getUpload('id-1');
    expect(fetched).toEqual(created);
  });

  it('returns null for a missing upload', () => {
    expect(store.getUpload('missing')).toBeNull();
  });

  it('lists every created record', () => {
    store.createUpload({ id: 'a', originalFilename: 'a.mp4', storedPath: 'originals/a.mp4', uploadedAt: '2024-01-01T00:00:00.000Z' });
    store.createUpload({ id: 'b', originalFilename: 'b.mp4', storedPath: 'originals/b.mp4', uploadedAt: '2024-01-02T00:00:00.000Z' });
    const ids = store.listUploads().map((u) => u.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('updates status and preserves untouched fields', () => {
    store.createUpload({ id: 'u', originalFilename: 'u.mp4', storedPath: 'originals/u.mp4' });
    const updated = store.updateUpload('u', {
      status: ProcessingStatus.PROCESSING,
      processingStartedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(updated.status).toBe(ProcessingStatus.PROCESSING);
    expect(updated.processingStartedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(updated.originalFilename).toBe('u.mp4');
  });

  it('walks the full lifecycle PENDING -> PROCESSING -> COMPLETED and persists across reads', () => {
    store.createUpload({ id: 'life', originalFilename: 'life.mp4', storedPath: 'originals/life.mp4' });
    expect(store.getUpload('life')!.status).toBe(ProcessingStatus.PENDING);

    store.updateUpload('life', {
      status: ProcessingStatus.PROCESSING,
      processingStartedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(store.getUpload('life')!.status).toBe(ProcessingStatus.PROCESSING);

    store.updateUpload('life', {
      status: ProcessingStatus.COMPLETED,
      thumbnailPath: 'thumbnails/life.jpg',
    });
    const completed = store.getUpload('life')!;
    expect(completed.status).toBe(ProcessingStatus.COMPLETED);
    expect(completed.thumbnailPath).toBe('thumbnails/life.jpg');
    // processing_started_at set earlier is preserved through the later patch.
    expect(completed.processingStartedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(completed.error).toBeNull();
  });

  it('transitions to FAILED with an error message set', () => {
    store.createUpload({ id: 'bad', originalFilename: 'bad.mp4', storedPath: 'originals/bad.mp4' });
    store.updateUpload('bad', { status: ProcessingStatus.PROCESSING });
    const failed = store.updateUpload('bad', {
      status: ProcessingStatus.FAILED,
      error: 'transcode exploded',
    });
    expect(failed.status).toBe(ProcessingStatus.FAILED);
    expect(failed.error).toBe('transcode exploded');
    expect(store.getUpload('bad')!.error).toBe('transcode exploded');
  });

  it('throws when updating a non-existent upload', () => {
    expect(() => store.updateUpload('nope', { status: ProcessingStatus.FAILED })).toThrow(
      /not found/i,
    );
  });

  it('stores and retrieves renditions for an upload', () => {
    store.createUpload({ id: 'r', originalFilename: 'r.mp4', storedPath: 'originals/r.mp4' });
    store.setRenditions('r', [
      { uploadId: 'r', label: '1080p', path: 'renditions/r/1080p.mp4', width: 1920, height: 1080 },
      { uploadId: 'r', label: '720p', path: 'renditions/r/720p.mp4', width: 1280, height: 720 },
    ]);
    const renditions = store.getRenditions('r');
    expect(renditions.map((x) => x.label)).toEqual(['1080p', '720p']);
    expect(renditions[0].width).toBe(1920);
  });

  it('replaces renditions on subsequent setRenditions calls', () => {
    store.createUpload({ id: 'r2', originalFilename: 'r2.mp4', storedPath: 'originals/r2.mp4' });
    store.setRenditions('r2', [
      { uploadId: 'r2', label: '480p', path: 'renditions/r2/480p.mp4', width: 854, height: 480 },
    ]);
    store.setRenditions('r2', [
      { uploadId: 'r2', label: '720p', path: 'renditions/r2/720p.mp4', width: 1280, height: 720 },
    ]);
    expect(store.getRenditions('r2').map((x) => x.label)).toEqual(['720p']);
  });

  it('returns an empty list of renditions for an upload with none', () => {
    store.createUpload({ id: 'none', originalFilename: 'none.mp4', storedPath: 'originals/none.mp4' });
    expect(store.getRenditions('none')).toEqual([]);
  });
});

describe('isSqliteBusyError', () => {
  it('recognizes SQLITE_BUSY and SQLITE_BUSY_SNAPSHOT codes', () => {
    expect(isSqliteBusyError(sqliteError('SQLITE_BUSY'))).toBe(true);
    expect(isSqliteBusyError(sqliteError('SQLITE_BUSY_SNAPSHOT'))).toBe(true);
  });

  it('rejects other errors and non-error values', () => {
    expect(isSqliteBusyError(sqliteError('SQLITE_CONSTRAINT'))).toBe(false);
    expect(isSqliteBusyError(new Error('plain'))).toBe(false);
    expect(isSqliteBusyError('SQLITE_BUSY')).toBe(false);
    expect(isSqliteBusyError(null)).toBe(false);
    expect(isSqliteBusyError(undefined)).toBe(false);
  });
});

describe('runWithBusyRetry', () => {
  // better-sqlite3 is synchronous, so forcing a genuine cross-process SQLITE_BUSY inside a unit
  // test is impractical. Instead we test the retry helper directly (the design's retry-on-busy
  // core) by injecting a fake operation that throws SQLITE_BUSY a bounded number of times before
  // succeeding, using a synchronous no-op sleep so the test stays fast.
  const noSleep = () => {};

  it('succeeds on the first attempt when the operation does not throw', () => {
    let calls = 0;
    const result = runWithBusyRetry(
      () => {
        calls++;
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on SQLITE_BUSY and eventually succeeds', () => {
    let calls = 0;
    const result = runWithBusyRetry(
      () => {
        calls++;
        if (calls < 3) {
          throw sqliteError('SQLITE_BUSY');
        }
        return 'recovered';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('records the backoff delays it sleeps for between attempts', () => {
    const delays: number[] = [];
    let calls = 0;
    runWithBusyRetry(
      () => {
        calls++;
        if (calls < 3) {
          throw sqliteError('SQLITE_BUSY_SNAPSHOT');
        }
        return 'done';
      },
      { sleep: (ms) => delays.push(ms), baseBackoffMs: 10 },
    );
    // Linear backoff: 10ms before attempt 2, 20ms before attempt 3.
    expect(delays).toEqual([10, 20]);
  });

  it('gives up and rethrows after maxAttempts consecutive busy errors', () => {
    let calls = 0;
    expect(() =>
      runWithBusyRetry(
        () => {
          calls++;
          throw sqliteError('SQLITE_BUSY', 'still locked');
        },
        { maxAttempts: 4, sleep: noSleep },
      ),
    ).toThrow('still locked');
    expect(calls).toBe(4);
  });

  it('propagates non-busy errors immediately without retrying', () => {
    let calls = 0;
    expect(() =>
      runWithBusyRetry(
        () => {
          calls++;
          throw sqliteError('SQLITE_CONSTRAINT', 'unique violation');
        },
        { sleep: noSleep },
      ),
    ).toThrow('unique violation');
    expect(calls).toBe(1);
  });

  it('defaults to DEFAULT_MAX_WRITE_ATTEMPTS attempts', () => {
    let calls = 0;
    expect(() =>
      runWithBusyRetry(
        () => {
          calls++;
          throw sqliteError('SQLITE_BUSY');
        },
        { sleep: noSleep },
      ),
    ).toThrow();
    expect(calls).toBe(DEFAULT_MAX_WRITE_ATTEMPTS);
  });
});

describe('SqliteMetadataStore write path integration', () => {
  it('commits writes through the serialized BEGIN IMMEDIATE path and reads them back', async () => {
    const store = await TempSqliteMetadataStore.create();
    try {
      // Exercise every write op end-to-end to confirm runWrite commits (not just BEGIN without
      // COMMIT) and returns the expected values.
      const created = store.createUpload({
        id: 'wp',
        originalFilename: 'wp.mp4',
        storedPath: 'originals/wp.mp4',
      });
      expect(created.status).toBe(ProcessingStatus.PENDING);

      store.updateUpload('wp', { status: ProcessingStatus.PROCESSING });
      store.setRenditions('wp', [
        { uploadId: 'wp', label: '720p', path: 'renditions/wp/720p.mp4', width: 1280, height: 720 },
      ]);

      // A fresh connection to the same file proves the data was actually committed to disk.
      const reopened = new TempReadback(store.dbPath);
      try {
        expect(reopened.status('wp')).toBe(ProcessingStatus.PROCESSING);
        expect(reopened.renditionCount('wp')).toBe(1);
      } finally {
        reopened.close();
      }
    } finally {
      await store.cleanup();
    }
  });
});

/** Minimal read-only reopen of a metadata DB file to assert writes were committed to disk. */
class TempReadback {
  private readonly db: import('better-sqlite3').Database;
  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    this.db = new Database(dbPath, { readonly: true });
  }
  status(id: string): string {
    const row = this.db.prepare('SELECT status FROM upload_records WHERE id = ?').get(id) as
      | { status: string }
      | undefined;
    return row!.status;
  }
  renditionCount(uploadId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM renditions WHERE upload_id = ?')
      .get(uploadId) as { c: number };
    return row.c;
  }
  close(): void {
    this.db.close();
  }
}
