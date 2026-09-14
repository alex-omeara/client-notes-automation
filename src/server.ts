import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { saveTranscript } from './tella-transcript.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const frontendDirectory = path.resolve(process.cwd(), 'dist');

app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({ ok: true });
});

app.post('/api/transcripts', async (request: Request, response: Response) => {
  const videoId = request.body?.videoId;
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
    response.status(400).json({ error: 'A valid Tella videoId is required.' });
    return;
  }

  try {
    const fileName = await saveTranscript(videoId);
    response.json({ fileName, videoId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to save transcript.';
    response.status(502).json({ error: message });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(frontendDirectory));
  app.use((request: Request, response: Response, next) => {
    if (request.method === 'GET' && !request.path.startsWith('/api')) {
      response.sendFile(path.join(frontendDirectory, 'index.html'));
      return;
    }
    next();
  });
}

app.listen(port, () => {
  console.log(`Client report connector server listening on http://localhost:${port}`);
});