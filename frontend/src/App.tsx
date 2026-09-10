import { UploadForm } from './UploadForm';
import { VideoList } from './VideoList';

/** Top-level app: upload control above the live-updating list of uploads. */
export function App() {
  return (
    <main className="app">
      <h1>Video Upload Platform</h1>
      <UploadForm />
      <VideoList />
    </main>
  );
}
