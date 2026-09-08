import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NewUploadRecord, ProcessingStatus, Rendition, UploadRecord } from './types';

/**
 * Metadata store abstraction over the SQLite database on the shared volume
 * (design "Data Models" + "Metadata Persistence"). Parameterized by a DB path.
 *
 * Per the design's single-writer model, only the backend writes `metadata.db`; the processing
 * component reports results through the backend. This interface is the reusable contract shared by
 * backend and processing (and tests). The fully serialized write path / retry-on-busy behavior is
 * implemented on top of this in a later task (Task 3); here we provide the schema, the core
 * read/write operations, and a temp-SQLite implementation so tests run without a cluster.
 */
export interface MetadataStore {
  /** Absolute path to the SQLite database file. */
  readonly dbPath: string;

  /** Create the schema (`upload_records`, `renditions`) if it does not already exist. */
  init(): void;

  /** Insert a new Upload_Record with status PENDING. */
  createUpload(record: NewUploadRecord): UploadRecord;

  /** Return the Upload_Record for `id`, or null if none exists. */
  getUpload(id: string): UploadRecord | null;

  /** Return every Upload_Record (Req 3.1). */
  listUploads(): UploadRecord[];

  /** Update mutable fields of an existing Upload_Record. Returns the updated record. */
  updateUpload(id: string, patch: UploadRecordPatch): UploadRecord;

  /** Replace the set of renditions for an upload. */
  setRenditions(uploadId: string, renditions: Rendition[]): void;

  /** Return the renditions recorded for an upload. */
  getRenditions(uploadId: string): Rendition[];

  /** Close the underlying database connection. */
  close(): void;
}

/** Mutable fields of an Upload_Record that may be patched. */
export interface UploadRecordPatch {
  status?: ProcessingStatus;
  processingStartedAt?: string | null;
  thumbnailPath?: string | null;
  error?: string | null;
}

interface UploadRow {
  id: string;
  original_filename: string;
  stored_path: string;
  uploaded_at: string;
  status: string;
  processing_started_at: string | null;
  thumbnail_path: string | null;
  error: string | null;
}

interface RenditionRow {
  id: number;
  upload_id: string;
  label: string;
  path: string;
  width: number | null;
  height: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS upload_records (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL,
  processing_started_at TEXT,
  thumbnail_path TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS renditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id TEXT NOT NULL REFERENCES upload_records(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER
);

CREATE INDEX IF NOT EXISTS idx_renditions_upload_id ON renditions(upload_id);
`;

function rowToUpload(row: UploadRow): UploadRecord {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    storedPath: row.stored_path,
    uploadedAt: row.uploaded_at,
    status: row.status as ProcessingStatus,
    processingStartedAt: row.processing_started_at,
    thumbnailPath: row.thumbnail_path,
    error: row.error,
  };
}

function rowToRendition(row: RenditionRow): Rendition {
  return {
    id: row.id,
    uploadId: row.upload_id,
    label: row.label as Rendition['label'],
    path: row.path,
    width: row.width,
    height: row.height,
  };
}

/** SQLite result codes that indicate a transient lock contention and are safe to retry. */
export const SQLITE_BUSY_CODES: ReadonlySet<string> = new Set([
  'SQLITE_BUSY',
  'SQLITE_BUSY_SNAPSHOT',
]);

/** Default number of attempts (including the first) for a write before giving up. */
export const DEFAULT_MAX_WRITE_ATTEMPTS = 5;

/** Default base backoff in milliseconds; backoff grows linearly with the attempt number. */
export const DEFAULT_WRITE_BACKOFF_MS = 20;

/** Options controlling the retry-on-busy write path. */
export interface BusyRetryOptions {
  /** Maximum number of attempts (including the first). Defaults to {@link DEFAULT_MAX_WRITE_ATTEMPTS}. */
  maxAttempts?: number;
  /** Base backoff in ms; the delay before attempt N is `baseBackoffMs * (N-1)`. */
  baseBackoffMs?: number;
  /** Synchronous sleep function; overridable in tests. Defaults to {@link sleepSync}. */
  sleep?: (ms: number) => void;
}

/** True if `err` is a better-sqlite3 error whose code marks it as a retryable busy/lock error. */
export function isSqliteBusyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && SQLITE_BUSY_CODES.has(code);
}

/**
 * Synchronous sleep used between retry attempts.
 *
 * better-sqlite3 is fully synchronous, so we cannot `await` here. `Atomics.wait` on a throwaway
 * SharedArrayBuffer blocks the current thread for `ms` without spinning the CPU, which is exactly
 * the semantics we want for a short bounded backoff on `SQLITE_BUSY`.
 */
export function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run a synchronous write operation, retrying on `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` with a small
 * bounded linear backoff before giving up. Non-busy errors propagate immediately.
 *
 * This is the reusable core of the design's "serialized write path with retry-on-busy": callers
 * pass an operation that is already wrapped in a `BEGIN IMMEDIATE` transaction, so a busy result
 * means the RESERVED lock could not be acquired (or was lost) and the transaction rolled back,
 * making a fresh retry safe.
 */
export function runWithBusyRetry<T>(op: () => T, options: BusyRetryOptions = {}): T {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_WRITE_ATTEMPTS;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_WRITE_BACKOFF_MS;
  const sleep = options.sleep ?? sleepSync;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return op();
    } catch (err) {
      lastErr = err;
      if (!isSqliteBusyError(err) || attempt === maxAttempts) {
        throw err;
      }
      sleep(baseBackoffMs * attempt);
    }
  }
  // Unreachable (loop either returns or throws), but keeps the type checker happy.
  throw lastErr;
}

/**
 * SQLite-backed MetadataStore, parameterized by a DB path.
 *
 * Implements the design's single-writer serialized write path (see "Metadata Persistence"). All
 * mutations (`createUpload`, `updateUpload`, `setRenditions`) are funneled through {@link runWrite},
 * which wraps the operation in a `BEGIN IMMEDIATE` transaction and retries on `SQLITE_BUSY` with a
 * short bounded backoff. Reads run directly since they do not need the write serialization.
 *
 * Concurrency model: better-sqlite3 is fully synchronous, so within a single process a write
 * operation runs to completion before any other JS runs — the "mutex" is effectively implicit. The
 * real contention is *across processes* (multiple backend replicas over NFS); there, `BEGIN
 * IMMEDIATE` takes the database's RESERVED lock so writers serialize at the SQLite level, the
 * `busy_timeout` pragma makes SQLite itself wait for the lock, and {@link runWithBusyRetry} adds an
 * outer retry loop for the residual `SQLITE_BUSY` cases. WAL is intentionally NOT enabled because it
 * is unsafe on NFS; we rely on the default rollback journal per the design.
 */
export class SqliteMetadataStore implements MetadataStore {
  readonly dbPath: string;
  private readonly db: Database.Database;
  private readonly retryOptions: BusyRetryOptions;

  constructor(dbPath: string, retryOptions: BusyRetryOptions = {}) {
    this.dbPath = path.resolve(dbPath);
    this.db = new Database(this.dbPath);
    this.retryOptions = retryOptions;
    this.db.pragma('foreign_keys = ON');
    // Make SQLite itself wait for a busy lock before returning SQLITE_BUSY; the outer retry loop in
    // runWrite handles anything that still slips through. Note: the default rollback journal is
    // kept (no WAL) because WAL is unsafe on NFS (design "Metadata Persistence").
    this.db.pragma('busy_timeout = 5000');
  }

  /**
   * Run a write `fn` through the serialized write path: a `BEGIN IMMEDIATE` transaction (so writers
   * serialize on the RESERVED lock across processes) wrapped in retry-on-`SQLITE_BUSY`. Any value
   * returned by `fn` is returned to the caller after the transaction commits.
   */
  protected runWrite<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    // `.immediate` runs the transaction as `BEGIN IMMEDIATE`, acquiring the RESERVED lock up front
    // instead of lazily on first write, so concurrent writers fail fast (and get retried) rather
    // than deadlocking after doing work.
    return runWithBusyRetry(() => tx.immediate() as T, this.retryOptions);
  }

  init(): void {
    this.db.exec(SCHEMA);
  }

  createUpload(record: NewUploadRecord): UploadRecord {
    const uploadedAt = record.uploadedAt ?? new Date().toISOString();
    return this.runWrite(() => {
      this.db
        .prepare(
          `INSERT INTO upload_records
            (id, original_filename, stored_path, uploaded_at, status, processing_started_at, thumbnail_path, error)
           VALUES (@id, @originalFilename, @storedPath, @uploadedAt, @status, NULL, NULL, NULL)`,
        )
        .run({
          id: record.id,
          originalFilename: record.originalFilename,
          storedPath: record.storedPath,
          uploadedAt,
          status: ProcessingStatus.PENDING,
        });
      return this.requireUpload(record.id);
    });
  }

  getUpload(id: string): UploadRecord | null {
    const row = this.db
      .prepare('SELECT * FROM upload_records WHERE id = ?')
      .get(id) as UploadRow | undefined;
    return row ? rowToUpload(row) : null;
  }

  listUploads(): UploadRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM upload_records ORDER BY uploaded_at ASC')
      .all() as UploadRow[];
    return rows.map(rowToUpload);
  }

  updateUpload(id: string, patch: UploadRecordPatch): UploadRecord {
    return this.runWrite(() => {
      const existing = this.requireUpload(id);
      const next: UploadRecord = {
        ...existing,
        status: patch.status ?? existing.status,
        processingStartedAt:
          patch.processingStartedAt !== undefined
            ? patch.processingStartedAt
            : existing.processingStartedAt,
        thumbnailPath:
          patch.thumbnailPath !== undefined ? patch.thumbnailPath : existing.thumbnailPath,
        error: patch.error !== undefined ? patch.error : existing.error,
      };
      this.db
        .prepare(
          `UPDATE upload_records
              SET status = @status,
                  processing_started_at = @processingStartedAt,
                  thumbnail_path = @thumbnailPath,
                  error = @error
            WHERE id = @id`,
        )
        .run({
          id,
          status: next.status,
          processingStartedAt: next.processingStartedAt,
          thumbnailPath: next.thumbnailPath,
          error: next.error,
        });
      return next;
    });
  }

  setRenditions(uploadId: string, renditions: Rendition[]): void {
    const del = this.db.prepare('DELETE FROM renditions WHERE upload_id = ?');
    const ins = this.db.prepare(
      `INSERT INTO renditions (upload_id, label, path, width, height)
       VALUES (@uploadId, @label, @path, @width, @height)`,
    );
    this.runWrite(() => {
      del.run(uploadId);
      for (const r of renditions) {
        ins.run({
          uploadId,
          label: r.label,
          path: r.path,
          width: r.width ?? null,
          height: r.height ?? null,
        });
      }
    });
  }

  getRenditions(uploadId: string): Rendition[] {
    const rows = this.db
      .prepare('SELECT * FROM renditions WHERE upload_id = ? ORDER BY id ASC')
      .all(uploadId) as RenditionRow[];
    return rows.map(rowToRendition);
  }

  close(): void {
    this.db.close();
  }

  private requireUpload(id: string): UploadRecord {
    const record = this.getUpload(id);
    if (!record) {
      throw new Error(`Upload_Record not found: ${id}`);
    }
    return record;
  }
}

/**
 * Temp-SQLite MetadataStore for tests: creates the DB inside a fresh unique temp directory,
 * initializes the schema, and provides a cleanup helper. Lets property/unit tests run without a
 * cluster.
 */
export class TempSqliteMetadataStore extends SqliteMetadataStore {
  private readonly tempDir: string;

  private constructor(dbPath: string, tempDir: string) {
    super(dbPath);
    this.tempDir = tempDir;
  }

  /** Create a new isolated temp-SQLite store with the schema already initialized. */
  static async create(prefix = 'vup-meta-'): Promise<TempSqliteMetadataStore> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const store = new TempSqliteMetadataStore(path.join(dir, 'metadata.db'), dir);
    store.init();
    return store;
  }

  /** Close the connection and remove the temp directory. Call in test teardown. */
  async cleanup(): Promise<void> {
    this.close();
    await fs.rm(this.tempDir, { recursive: true, force: true });
  }
}
