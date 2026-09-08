import { promises as fs } from 'fs';
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
  private resolve(relativePath: string): string {
    const target = path.resolve(this.baseDir, relativePath);
    const rel = path.relative(this.baseDir, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes storage base directory: ${relativePath}`);
    }
    return target;
  }

  async write(relativePath: string, content: Buffer | string): Promise<void> {
    const target = this.resolve(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(this.resolve(relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async move(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.resolve(fromRelativePath);
    const to = this.resolve(toRelativePath);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
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
