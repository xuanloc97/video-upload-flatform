/**
 * Dependency-injection tokens for the shared infrastructure abstractions.
 *
 * The backend never constructs a {@link Storage} or {@link MetadataStore} directly in its
 * resolvers/services; instead it injects these tokens. That lets production wire the real
 * `/uploads` (env `UPLOADS_DIR`) FileSystemStorage + SqliteMetadataStore, while tests override the
 * same tokens with the shared temp-dir Storage and temp-SQLite MetadataStore so they run without a
 * cluster (design "Shared Storage Interface" / "Metadata Persistence").
 */
export const STORAGE = Symbol('STORAGE');
export const METADATA_STORE = Symbol('METADATA_STORE');

/**
 * Injectable MP4 container/codec probe. Abstracted so the streaming validation path can be
 * unit-/property-tested without a real `ffprobe` binary on the machine, and so production can swap
 * in an implementation backed by the FFmpeg toolchain.
 */
export const MP4_PROBE = Symbol('MP4_PROBE');
