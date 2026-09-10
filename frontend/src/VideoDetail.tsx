import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { VIDEO_METADATA, VideoMetadataData } from './graphql';

/**
 * Thumbnail + rendition playback for a COMPLETED upload (Reqs 9.3, 9.4).
 *
 * Fetches `videoMetadata` for the given id; once COMPLETED it shows the thumbnail and an HTML5
 * `<video>` player whose source is switchable across the available renditions. File bytes are
 * fetched from the backend file URLs returned in the metadata (not via GraphQL).
 */
export function VideoDetail({ id }: { id: string }) {
  const { data, loading, error } = useQuery<VideoMetadataData>(VIDEO_METADATA, {
    variables: { id },
  });
  const [selected, setSelected] = useState<string | null>(null);

  if (loading) {
    return <p>Loading video details…</p>;
  }
  if (error) {
    return <p role="alert">Failed to load details: {error.message}</p>;
  }

  const meta = data?.videoMetadata;
  if (!meta || meta.status !== 'COMPLETED') {
    return <p>Renditions and thumbnail are available once processing completes.</p>;
  }

  const current = selected ?? meta.renditions[0]?.url ?? null;

  return (
    <div className="video-detail">
      {meta.thumbnailUrl && (
        <img src={meta.thumbnailUrl} alt="Video thumbnail" width={320} data-testid="thumbnail" />
      )}

      {current && (
        <video controls width={480} src={current} data-testid="player">
          Your browser does not support the video tag.
        </video>
      )}

      <ul aria-label="Available renditions">
        {meta.renditions.map((r) => (
          <li key={r.label}>
            <button type="button" onClick={() => setSelected(r.url)}>
              Play {r.label}
              {r.width && r.height ? ` (${r.width}×${r.height})` : ''}
            </button>
            {' — '}
            <a href={r.url} target="_blank" rel="noreferrer">
              open {r.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
