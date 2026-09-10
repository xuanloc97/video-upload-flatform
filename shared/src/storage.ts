import { promises as fs, createReadStream, type ReadStream } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Storage abstraction over the shared `/uploads` filesystem (design "Shared Storage Interface").
 *
 * All paths passed to these methods are *relative* to the storage base directory. The abstraction
 * exists so backend and processing code can share the same file-access contract, and so property/
 * unit tests can run against a temp directory without a live NFS-backed cluster.
 */
export interface Storage {
  /** Absolute base directory that all relative paths resolve against. */
  readonly baseDir: string;

  /** Write `content` to `relativePath`, creating parent directories as needed. */
  write(relativePath: string, content: Buffer | string): Promise<void>;

  /** Read the full contents of `relativePath` as a Buffer. */
  read(relativePath: string): Promise<Buffer>;

  /** Return true if `relativePath` exists. */
  exists(relativePath: string): Promise<boolean>;

  /**
   * Atomically move `fromRelativePath` to `toRelativePath` (rename), creating the destination's
   * parent directories as needed. Used for the tmp-then-rename pattern so partial files are never
   * visible at their final path.
   */
  move(fromRelativePath: string, toRelativePath: string): Promise<void>;

  /**
   * Resolve `relativePath` to an absolute path inside the base directory, throwing if it would
   * escape the base dir (path-traversal guard). Exposed so callers that need a real filesystem
   * path (e.g. the backend file-serving route) reuse the same traversal protection.
   */
  resolvePath(relativePath: string): string;

  /**
   * Return `fs.Stats` for `relativePath` (used to obtain the file size for ranged reads). Rejects
   * if the path escapes the base dir or the file does not exist.
   */
  stat(relativePath: string): Promise<import('fs').Stats>;

  /**
   * Open a readable stream over `relativePath`. When `range` is provided, only the inclusive byte
   * range `[start, end]` is streamed (used to serve HTTP Range requests / 206 Partial Content).
   * Rejects if the path escapes the base dir.
   */
  createReadStream(relativePath: string, range?: { start: number; end: number }): ReadStream;
}

/**
 * Filesystem-backed Storage implementation rooted at a base directory.
 * Backing both the real `/uploads` mount and the temp-dir test implementation.
 */
export class FileSystemStorage implements Storage {
  readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  /** Resolve a relative path against the base dir, guarding against path traversal. */
  resolvePath(relativePath: string): string {
    const target = path.resolve(this.baseDir, relativePath);
    const rel = path.relative(this.baseDir, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes storage base directory: ${relativePath}`);
    }
    return target;
  }

  async write(relativePath: string, content: Buffer | string): Promise<void> {
    const target = this.resolvePath(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async move(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.resolvePath(fromRelativePath);
    const to = this.resolvePath(toRelativePath);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  async stat(relativePath: string): Promise<import('fs').Stats> {
    return fs.stat(this.resolvePath(relativePath));
  }

  createReadStream(relativePath: string, range?: { start: number; end: number }): ReadStream {
    const target = this.resolvePath(relativePath);
    return range
      ? createReadStream(target, { start: range.start, end: range.end })
      : createReadStream(target);
  }
}

/**
 * Temp-dir Storage implementation for tests. Creates a fresh unique directory under the OS temp
 * dir so property/unit tests run deterministically and in isolation without a cluster.
 */
export class TempDirStorage extends FileSystemStorage {
  private constructor(baseDir: string) {
    super(baseDir);
  }

  /** Create a new isolated temp-dir storage. */
  static async create(prefix = 'vup-storage-'): Promise<TempDirStorage> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    return new TempDirStorage(dir);
  }

  /** Recursively remove the temp directory. Call in test teardown. */
  async cleanup(): Promise<void> {
    await fs.rm(this.baseDir, { recursive: true, force: true });
  }
}
