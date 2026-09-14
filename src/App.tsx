import { useState, type ReactElement } from 'react';

type AppStatus = 'missing-config' | 'ready' | 'recording' | 'processing' | 'success' | 'error';

const tellaApiKey = import.meta.env.VITE_TELLA_API_KEY ?? '';

function statusLabel(status: AppStatus): string {
  const labels: Record<AppStatus, string> = {
    'missing-config': 'Setup required',
    ready: 'Ready to record',
    recording: 'Recording in progress',
    processing: 'Fetching transcript',
    success: 'Transcript saved',
    error: 'Something went wrong',
  };

  return labels[status];
}

export default function App(): ReactElement {
  const [status, setStatus] = useState<AppStatus>(tellaApiKey ? 'ready' : 'missing-config');
  const [detail, setDetail] = useState('');
  const [savedFile, setSavedFile] = useState('');
  const [videoId, setVideoId] = useState('');

  const canStart = status === 'ready' || status === 'success' || status === 'error';
  const canStop = status === 'recording';

  async function startRecording(): Promise<void> {
    if (!tellaApiKey) {
      setStatus('missing-config');
      setDetail('Add VITE_TELLA_API_KEY to the browser env or switch to a server-managed flow.');
      return;
    }

    setStatus('recording');
    setDetail('Record in Tella and then click Finish recording to send the session to the connector.');
    setVideoId('');
  }

  async function finishRecording(): Promise<void> {
    if (!videoId) {
      setStatus('error');
      setDetail('No Tella video was supplied yet. Record a clip in Tella and paste the video ID if needed.');
      return;
    }

    setStatus('processing');
    setDetail('');

    try {
      const response = await fetch('/api/transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const payload: unknown = await response.json();

      if (!response.ok || !isTranscriptSuccess(payload)) {
        throw new Error(isTranscriptError(payload) ? payload.error : 'The transcript could not be saved.');
      }

      setSavedFile(payload.fileName);
      setStatus('success');
      setDetail('');
    } catch (error: unknown) {
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'The transcript request failed.');
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Client report connector</p>
        <h1>Capture a clear report, then keep the words.</h1>
        <p className="intro">Use Tella to record your screen or camera. When the video is ready, the connector fetches the transcript and saves it as a temporary JSON artifact.</p>
      </section>

      <section className="workspace" aria-live="polite">
        <div className={`status-indicator status-${status}`}>
          <span className="status-dot" />
          <span>{statusLabel(status)}</span>
        </div>

        {status === 'missing-config' && (
          <div className="message-block">
            <h2>Add the Tella API key</h2>
            <p>Set <code>VITE_TELLA_API_KEY</code> in your local environment for a browser-visible placeholder, then restart the dev server.</p>
          </div>
        )}

        {status === 'ready' && <div className="message-block"><h2>Ready when you are</h2><p>Start a Tella recording, then paste the Tella video ID to continue with transcript extraction.</p></div>}
        {status === 'recording' && <div className="message-block"><h2>Make your point</h2><p>Your Tella recording is active. Finish the recording to continue.</p></div>}
        {status === 'processing' && <div className="message-block"><h2>Saving the transcript</h2><p>The server is fetching the transcript data and writing the temporary JSON artifact.</p></div>}
        {status === 'success' && <div className="message-block"><h2>Transcript saved</h2><p>Temporary file: <code>{savedFile}</code></p></div>}
        {status === 'error' && <div className="message-block"><h2>Recording workflow needs attention</h2><p>{detail}</p></div>}

        <div className="actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
          <button className="primary-button" type="button" disabled={!canStart} onClick={() => void startRecording()}>
            {status === 'success' || status === 'error' ? 'Start another recording' : 'Start recording'}
          </button>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
            Tella video ID
            <input
              value={videoId}
              onChange={(event) => setVideoId(event.target.value.trim())}
              placeholder="vid_abc123"
              aria-label="Tella video ID"
            />
          </label>

          <button className="secondary-button" type="button" disabled={!canStop && !videoId} onClick={() => void finishRecording()}>
            Save transcript
          </button>
        </div>
      </section>

      <footer>Recordings are handled by Tella. Transcript files are temporary local artifacts.</footer>
    </main>
  );
}

function isTranscriptSuccess(value: unknown): value is { fileName: string } {
  return typeof value === 'object' && value !== null && 'fileName' in value && typeof value.fileName === 'string';
}

function isTranscriptError(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string';
}