import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function saveTranscript(videoId: string): Promise<string> {
  const template = process.env.LOOM_TRANSCRIPT_URL_TEMPLATE;
  if (!template) {
    throw new Error('LOOM_TRANSCRIPT_URL_TEMPLATE is not configured.');
  }

  const token = process.env.LOOM_API_TOKEN;
  const url = template.replace('{videoId}', encodeURIComponent(videoId));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Loom transcript request failed with status ${response.status}.`);
  }

  const tempDirectory = path.resolve(process.cwd(), 'temp');
  await mkdir(tempDirectory, { recursive: true });
  const fileName = `transcript-${videoId}-${randomUUID()}.json`;
  await writeFile(path.join(tempDirectory, fileName), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return fileName;
}