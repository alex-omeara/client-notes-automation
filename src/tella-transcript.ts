import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type TellaTranscriptPayload = {
  status?: string | null;
  text?: string | null;
  sentences?: Array<{ text?: string; startSeconds?: number; endSeconds?: number }> | null;
  language?: string | null;
};

type TellaVideoResponse = {
  video?: {
    transcript?: TellaTranscriptPayload | null;
  } | null;
  error?: string;
  message?: string;
};

export async function saveTranscript(videoId: string): Promise<string> {
  const baseUrl = (process.env.TELLA_API_BASE_URL ?? 'https://api.tella.com/v1').replace(/\/$/, '');
  const apiKey = process.env.TELLA_API_KEY;

  if (!apiKey) {
    throw new Error('TELLA_API_KEY is not configured.');
  }

  const url = `${baseUrl}/videos/${encodeURIComponent(videoId)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const body = (await response.json()) as TellaVideoResponse;
  if (!response.ok) {
    throw new Error(body.message ?? `Tella request failed with status ${response.status}.`);
  }

  const transcript = body.video?.transcript;
  if (!transcript) {
    throw new Error('The Tella video does not have a transcript available yet.');
  }

  const tempDirectory = path.resolve(process.cwd(), 'temp');
  await mkdir(tempDirectory, { recursive: true });

  const fileName = `transcript-${videoId}-${randomUUID()}.json`;
  await writeFile(path.join(tempDirectory, fileName), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');

  return fileName;
}
