import { Fragment, useState } from 'react';
import { useQuery } from '@apollo/client';
import { LIST_VIDEOS, ListVideosData, ProcessingStatus } from './graphql';
import { VideoDetail } from './VideoDetail';

/** Poll interval (ms) so status badges reflect PENDING → PROCESSING → COMPLETED transitions live. */
const POLL_MS = 3000;

/** Color/label per status for the badge. */
const STATUS_LABEL: Record<ProcessingStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

function StatusBadge({ status }: { status: ProcessingStatus }) {
  return (
    <span data-testid="status-badge" data-status={status} className={`badge badge-${status.toLowerCase()}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * List view (Reqs 9.1, 9.2): shows every upload with filename, upload time, and a live status
 * badge, polling `videos` on an interval. COMPLETED rows can be expanded to view the thumbnail and
 * play renditions (VideoDetail).
 */
export function VideoList() {
  const { data, loading, error } = useQuery<ListVideosData>(LIST_VIDEOS, {
    pollInterval: POLL_MS,
    fetchPolicy: 'cache-and-network',
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading && !data) {
    return <p>Loading videos…</p>;
  }
  if (error) {
    return <p role="alert">Failed to load videos: {error.message}</p>;
  }

  const videos = data?.videos ?? [];
  if (videos.length === 0) {
    return <p>No videos uploaded yet.</p>;
  }

  return (
    <section aria-labelledby="list-heading">
      <h2 id="list-heading">Uploaded videos</h2>
      <table>
        <thead>
          <tr>
            <th>Filename</th>
            <th>Uploaded</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <Fragment key={v.id}>
              <tr data-testid="video-row">
                <td>{v.originalFilename}</td>
                <td>{new Date(v.uploadedAt).toLocaleString()}</td>
                <td>
                  <StatusBadge status={v.status} />
                </td>
                <td>
                  {v.status === 'COMPLETED' && (
                    <button
                      type="button"
                      onClick={() => setExpanded((cur) => (cur === v.id ? null : v.id))}
                    >
                      {expanded === v.id ? 'Hide' : 'View'}
                    </button>
                  )}
                </td>
              </tr>
              {expanded === v.id && (
                <tr>
                  <td colSpan={4}>
                    <VideoDetail id={v.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
