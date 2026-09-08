/**
 * Processing worker entrypoint placeholder.
 *
 * The FFmpeg worker (atomic job claim, downscale-only renditions, thumbnail extraction, atomic
 * tmp-then-rename, completion/failure callbacks, recovery/retry) is implemented in Task 8. This stub
 * only confirms the shared package is wired in and the workspace builds.
 */
import { RENDITION_LABELS } from '@video-platform/shared';

export const PROCESSING_PLACEHOLDER = `processing scaffold (renditions: ${RENDITION_LABELS.join(', ')})`;
