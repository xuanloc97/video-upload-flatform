/**
 * Shared constants/helpers for the backend file-serving route (design "File serving").
 *
 * Renditions and thumbnails live on the shared `/uploads` volume at relative paths such as
 * `renditions/<id>/1080p.mp4` and `thumbnails/<id>.jpg`. The backend exposes them over a REST-style
 * route so the frontend can stream/playback the bytes while still performing all *API* calls via
 * GraphQL (Reqs 4.3, 4.4, 9.5). This module centralizes the route prefix and the mapping between a
 * stored relative path and its public URL so the resolver and the controller stay in agreement.
 */

/** Public URL prefix under which files are served (routed to the backend by the Ingress). */
export const FILE_ROUTE_PREFIX = '/files';

/**
 * Build the public file-route URL for a stored relative path (e.g. `renditions/<id>/1080p.mp4`).
 * Each path segment is URL-encoded so ids/labels with reserved characters remain valid in a URL,
 * while the `/` separators are preserved.
 */
export function fileRouteUrl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${FILE_ROUTE_PREFIX}/${encoded}`;
}
