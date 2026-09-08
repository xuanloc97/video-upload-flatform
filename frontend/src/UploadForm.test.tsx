import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockedProvider, MockedResponse } from '@apollo/client/testing';
import { GraphQLError } from 'graphql';
import { UploadForm } from './UploadForm';
import { LIST_VIDEOS, UPLOAD_VIDEO } from './graphql';

/*
 * Component tests for the upload view (Reqs 8.1–8.4): the file-select control, GraphQL upload
 * wiring, and success/error banners. Apollo's MockedProvider stands in for the backend.
 */

function makeMp4(name = 'clip.mp4'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'video/mp4' });
}

const listMock: MockedResponse = {
  request: { query: LIST_VIDEOS },
  result: { data: { videos: [] } },
};

describe('UploadForm', () => {
  it('offers an MP4 file-select control', () => {
    render(
      <MockedProvider mocks={[]}>
        <UploadForm />
      </MockedProvider>,
    );
    const input = screen.getByLabelText(/choose an mp4 video/i) as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'video/mp4');
  });

  it('shows a success banner after a successful upload', async () => {
    const file = makeMp4('holiday.mp4');
    const mocks: MockedResponse[] = [
      {
        request: { query: UPLOAD_VIDEO, variables: { file } },
        result: {
          data: {
            uploadVideo: {
              id: 'abc',
              originalFilename: 'holiday.mp4',
              uploadedAt: '2026-01-01T00:00:00.000Z',
              status: 'PENDING',
            },
          },
        },
      },
      listMock,
    ];

    render(
      <MockedProvider mocks={mocks}>
        <UploadForm />
      </MockedProvider>,
    );

    await userEvent.upload(screen.getByLabelText(/choose an mp4 video/i), file);
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    const banner = await screen.findByRole('status');
    expect(banner).toHaveAttribute('data-feedback', 'success');
    expect(banner).toHaveTextContent(/holiday\.mp4/);
  });

  it('shows an error banner with the backend message on failure', async () => {
    const file = makeMp4('bad.mp4');
    const mocks: MockedResponse[] = [
      {
        request: { query: UPLOAD_VIDEO, variables: { file } },
        result: { errors: [new GraphQLError('Uploaded file is not a valid MP4')] },
      },
    ];

    render(
      <MockedProvider mocks={mocks}>
        <UploadForm />
      </MockedProvider>,
    );

    await userEvent.upload(screen.getByLabelText(/choose an mp4 video/i), file);
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-feedback', 'error');
    expect(alert).toHaveTextContent(/not a valid mp4/i);
  });

  it('validates that a file is selected before submitting', async () => {
    render(
      <MockedProvider mocks={[]}>
        <UploadForm />
      </MockedProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/choose an mp4/i);
  });
});
