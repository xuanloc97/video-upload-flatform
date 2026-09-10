import { useState, useRef, FormEvent } from 'react';
import { useMutation } from '@apollo/client';
import { LIST_VIDEOS, UPLOAD_VIDEO, UploadVideoData } from './graphql';

type Feedback = { kind: 'success' | 'error'; message: string } | null;

/**
 * Upload view (Reqs 8.1–8.4): pick an MP4, submit it via the GraphQL `uploadVideo` mutation, and
 * show a success banner on confirmation or an error banner carrying the backend's message.
 */
export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploadVideo, { loading }] = useMutation<UploadVideoData>(UPLOAD_VIDEO, {
    // Refresh the list so the newly-created PENDING record shows up immediately.
    refetchQueries: [{ query: LIST_VIDEOS }],
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!file) {
      setFeedback({ kind: 'error', message: 'Please choose an MP4 file first.' });
      return;
    }
    try {
      const { data } = await uploadVideo({ variables: { file } });
      setFeedback({
        kind: 'success',
        message: `Uploaded "${data?.uploadVideo.originalFilename}" — processing started.`,
      });
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <section aria-labelledby="upload-heading">
      <h2 id="upload-heading">Upload a video</h2>
      <form onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4"
          aria-label="Choose an MP4 video"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {feedback && (
        <p role={feedback.kind === 'error' ? 'alert' : 'status'} data-feedback={feedback.kind}>
          {feedback.message}
        </p>
      )}
    </section>
  );
}
