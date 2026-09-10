import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockedProvider, MockedResponse } from '@apollo/client/testing';
import { VideoList } from '../src/VideoList';
import { LIST_VIDEOS, VIDEO_METADATA } from '../src/graphql';

/*
 * Component tests for the list/status view (Reqs 9.1–9.4): row rendering with status badges, and —
 * for a COMPLETED record — expanding to show the thumbnail and rendition links.
 */

const videos = [
  { id: '1', originalFilename: 'a.mp4', uploadedAt: '2026-01-01T00:00:00.000Z', status: 'PENDING' },
  { id: '2', originalFilename: 'b.mp4', uploadedAt: '2026-01-02T00:00:00.000Z', status: 'COMPLETED' },
];

const listMock: MockedResponse = {
  request: { query: LIST_VIDEOS },
  result: { data: { videos } },
  // Allow polling refetches to reuse this mock.
  maxUsageCount: Number.POSITIVE_INFINITY,
};

const metadataMock: MockedResponse = {
  request: { query: VIDEO_METADATA, variables: { id: '2' } },
  result: {
    data: {
      videoMetadata: {
        id: '2',
        status: 'COMPLETED',
        thumbnailUrl: '/files/thumbnails/2.jpg',
        renditions: [
          { label: '720p', url: '/files/renditions/2/720p.mp4', width: 1280, height: 720 },
          { label: '480p', url: '/files/renditions/2/480p.mp4', width: 854, height: 480 },
        ],
      },
    },
  },
};

describe('VideoList', () => {
  it('renders each upload with filename and a status badge', async () => {
    render(
      <MockedProvider mocks={[listMock]}>
        <VideoList />
      </MockedProvider>,
    );

    expect(await screen.findByText('a.mp4')).toBeInTheDocument();
    expect(screen.getByText('b.mp4')).toBeInTheDocument();

    const badges = screen.getAllByTestId('status-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveAttribute('data-status', 'PENDING');
    expect(badges[1]).toHaveAttribute('data-status', 'COMPLETED');
  });

  it('expands a COMPLETED row to show thumbnail and rendition links', async () => {
    render(
      <MockedProvider mocks={[listMock, metadataMock]}>
        <VideoList />
      </MockedProvider>,
    );

    // Only the COMPLETED row exposes a View button.
    const viewButton = await screen.findByRole('button', { name: /view/i });
    await userEvent.click(viewButton);

    // Thumbnail image + rendition links appear from videoMetadata.
    expect(await screen.findByTestId('thumbnail')).toHaveAttribute('src', '/files/thumbnails/2.jpg');
    expect(screen.getByRole('link', { name: /open 720p/i })).toHaveAttribute(
      'href',
      '/files/renditions/2/720p.mp4',
    );
    expect(screen.getByRole('link', { name: /open 480p/i })).toBeInTheDocument();
    // A player is present.
    expect(screen.getByTestId('player')).toBeInTheDocument();
  });
});
