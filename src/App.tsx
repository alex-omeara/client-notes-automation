import { useEffect, useState, type ReactElement } from 'react';

type AppStatus = 'ready' | 'recording' | 'processing' | 'success' | 'error';
type OutputMode = 'google-sheet' | 'downloads';

type ActionPointsSuccess = {
  actionPoints: {
    markdownFileName: string;
    jsonFileName: string;
  };
  transcriptFileName: string;
};

type SpreadsheetOption = { name: string };

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
  const [outputMode, setOutputMode] = useState<OutputMode>('google-sheet');
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetOption[]>([]);
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsError, setSheetsError] = useState('');
  const [weekNumber, setWeekNumber] = useState('1');

  const canStart = status === 'ready' || status === 'success' || status === 'error';
  const canStop = status === 'recording';

  useEffect(() => {
    let cancelled = false;
    setSheetsLoading(true);
    setSheetsError('');
    void fetch('/api/google/spreadsheets', { cache: 'no-store' })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || !isSpreadsheetList(payload)) {
          throw new Error('Unable to load Google spreadsheets.');
        }
        if (cancelled) return;
        setSpreadsheets(payload.spreadsheets);
        setSpreadsheetName((currentName) => currentName || payload.spreadsheets[0]?.name || '');
      })
      .catch(() => {
        if (!cancelled) setSheetsError('Could not load spreadsheets. Check Google Drive access and try again.');
      })
      .finally(() => {
        if (!cancelled) setSheetsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!spreadsheetName) {
      setTabs([]);
      setSheetName('');
      return;
    }

    let cancelled = false;
    setSheetsLoading(true);
    setSheetsError('');
    void fetch(`/api/google/spreadsheets/${encodeURIComponent(spreadsheetName)}/tabs`, { cache: 'no-store' })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || !isTabList(payload)) {
          throw new Error('Unable to load worksheet tabs.');
        }
        if (cancelled) return;
        setTabs(payload.tabs);
        setSheetName((currentName) => payload.tabs.includes(currentName)
          ? currentName
          : payload.tabs.includes('test') ? 'test' : payload.tabs[0] ?? '');
      })
      .catch(() => {
        if (!cancelled) {
          setTabs([]);
          setSheetName('');
          setSheetsError('Could not load worksheet tabs for that spreadsheet.');
        }
      })
      .finally(() => {
        if (!cancelled) setSheetsLoading(false);
      });
    return () => { cancelled = true; };
  }, [spreadsheetName]);

  function startRecording(): void {
    setStatus('recording');
    setDetail('Record in Tella and then click Finish recording to send the session to the connector.');
    setVideoId('');
  }

  async function finishRecording(): Promise<void> {
    if (!videoId) {
      setStatus('error');
      setDetail('Enter a Tella video ID to continue. Share URLs are not accepted.');
      return;
    }

    if (/^https?:\/\//i.test(videoId.trim())) {
      setStatus('error');
      setDetail('Enter the Tella video ID only. Share URLs are not accepted.');
      return;
    }

    setStatus('processing');
    setDetail('');

    try {
      const response = await fetch('/api/transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          outputMode,
          spreadsheetName: outputMode === 'google-sheet' ? spreadsheetName : undefined,
          sheetName: outputMode === 'google-sheet' ? sheetName : '',
          weekNumber: outputMode === 'google-sheet' ? Number(weekNumber) : undefined,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok || !isActionPointsSuccess(payload)) {
        if (response.status === 400 && isTranscriptError(payload)) {
          throw new Error(payload.error);
        }
        const requestId = isTranscriptError(payload) ? payload.requestId : undefined;
        throw new Error(requestId
          ? `Unable to complete the transcript request. Reference: ${requestId}`
          : 'Unable to complete the transcript request.');
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

        {status === 'ready' && <div className="message-block"><h2>Ready when you are</h2><p>Start a Tella recording, then enter its video ID to continue with transcript extraction. Share URLs are not accepted.</p></div>}
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
              placeholder="Enter the Tella video ID only"
              aria-label="Tella video ID"
            />
          </label>

          <div aria-label="Output mode" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={outputMode === 'google-sheet' ? 'primary-button' : 'secondary-button'}
              onClick={() => setOutputMode('google-sheet')}
            >
              Google Sheet
            </button>
            <button
              type="button"
              className={outputMode === 'downloads' ? 'primary-button' : 'secondary-button'}
              onClick={() => setOutputMode('downloads')}
            >
              Downloads
            </button>
          </div>

          {outputMode === 'google-sheet' && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
                Spreadsheet
                <select
                  value={spreadsheetName}
                  onChange={(event) => {
                    setSpreadsheetName(event.target.value);
                    setTabs([]);
                    setSheetName('');
                  }}
                  aria-label="Spreadsheet"
                  disabled={sheetsLoading || spreadsheets.length === 0}
                >
                  {spreadsheets.map((spreadsheet) => (
                    <option key={spreadsheet.name} value={spreadsheet.name}>{spreadsheet.name}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
                Worksheet tab
                <select
                  value={sheetName}
                  onChange={(event) => setSheetName(event.target.value)}
                  aria-label="Worksheet tab"
                  disabled={sheetsLoading || tabs.length === 0}
                >
                  {tabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
                </select>
              </label>

              {sheetsError && <p role="alert">{sheetsError}</p>}

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
                Week number
                <input
                  value={weekNumber}
                  onChange={(event) => setWeekNumber(event.target.value.trim())}
                  placeholder="1"
                  aria-label="Week number"
                />
              </label>
            </>
          )}

          <button
            className="secondary-button"
            type="button"
            disabled={(!canStop && !videoId) || (outputMode === 'google-sheet' && (sheetsLoading || !spreadsheetName || !sheetName))}
            onClick={() => void finishRecording()}
          >
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

function isTranscriptError(value: unknown): value is { error: string; requestId?: string } {
  return typeof value === 'object'
    && value !== null
    && 'error' in value
    && typeof value.error === 'string'
    && (!('requestId' in value) || typeof value.requestId === 'string');
}

function isSpreadsheetList(value: unknown): value is { spreadsheets: SpreadsheetOption[] } {
  return typeof value === 'object' && value !== null && 'spreadsheets' in value
    && Array.isArray(value.spreadsheets)
    && value.spreadsheets.every((item) => typeof item === 'object' && item !== null
      && 'name' in item && typeof item.name === 'string');
}

function isTabList(value: unknown): value is { tabs: string[] } {
  return typeof value === 'object' && value !== null && 'tabs' in value
    && Array.isArray(value.tabs)
    && value.tabs.every((tab) => typeof tab === 'string');
}