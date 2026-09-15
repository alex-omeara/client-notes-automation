import { useState, type ReactElement } from 'react';

type AppStatus = 'ready' | 'recording' | 'processing' | 'success' | 'error';

type ActionPointsSuccess = {
  actionPoints: {
    markdownFileName: string;
    jsonFileName: string;
  };
  transcriptFileName: string;
};

function statusLabel(status: AppStatus): string {
  const labels: Record<AppStatus, string> = {
    ready: 'Ready to record',
    recording: 'Recording in progress',
    processing: 'Generating action points',
    success: 'Action points generated',
    error: 'Something went wrong',
  };

  return labels[status];
}

export default function App(): ReactElement {
  const [status, setStatus] = useState<AppStatus>('ready');
  const [detail, setDetail] = useState('');
  const [savedFiles, setSavedFiles] = useState<ActionPointsSuccess | null>(null);
  const [videoId, setVideoId] = useState('');

  const canStart = status === 'ready' || status === 'success' || status === 'error';
  const canStop = status === 'recording';

  function startRecording(): void {
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

      if (!response.ok || !isActionPointsSuccess(payload)) {
        throw new Error(isTranscriptError(payload) ? payload.error : 'Action points could not be generated.');
      }

      setSavedFiles(payload);
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
        <p className="eyebrow">Client notes automation</p>
        <h1>Capture a clear report, then keep the words.</h1>
        <p className="intro">Use Tella to record your screen or camera. When the video is ready, the connector fetches the transcript and generates temporary action-point artifacts.</p>
      </section>

      <section className="workspace" aria-live="polite">
        <div className={`status-indicator status-${status}`}>
          <span className="status-dot" />
          <span>{statusLabel(status)}</span>
        </div>

        {status === 'ready' && <div className="message-block"><h2>Ready when you are</h2><p>Start a Tella recording, then paste the Tella video ID to continue with transcript extraction.</p></div>}
        {status === 'recording' && <div className="message-block"><h2>Make your point</h2><p>Your Tella recording is active. Finish the recording to continue.</p></div>}
        {status === 'processing' && <div className="message-block"><h2>Generating action points</h2><p>The server is fetching the transcript and asking Claude to produce temporary action-point artifacts.</p></div>}
        {status === 'success' && savedFiles && <div className="message-block"><h2>Action points generated</h2><p>Transcript: <code>{savedFiles.transcriptFileName}</code></p><p>Markdown: <code>{savedFiles.actionPoints.markdownFileName}</code></p><p>JSON: <code>{savedFiles.actionPoints.jsonFileName}</code></p></div>}
        {status === 'error' && <div className="message-block"><h2>Recording workflow needs attention</h2><p>{detail}</p></div>}

        <div className="actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
          <button className="primary-button" type="button" disabled={!canStart} onClick={startRecording}>
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
            Generate action points from video transcript
          </button>
        </div>
      </section>

      <footer>Recordings are handled by Tella. Transcript and action-point files are temporary local artifacts.</footer>
    </main>
  );
}

function isActionPointsSuccess(value: unknown): value is ActionPointsSuccess {
  if (typeof value !== 'object' || value === null || !('transcriptFileName' in value) || !('actionPoints' in value)) {
    return false;
  }

  const actionPoints = value.actionPoints;
  return typeof value.transcriptFileName === 'string'
    && typeof actionPoints === 'object'
    && actionPoints !== null
    && 'markdownFileName' in actionPoints
    && typeof actionPoints.markdownFileName === 'string'
    && 'jsonFileName' in actionPoints
    && typeof actionPoints.jsonFileName === 'string';
}

function isTranscriptError(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string';
}