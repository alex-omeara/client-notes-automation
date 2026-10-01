import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import { getSafeErrorMetadata, logger as defaultLogger } from './logger.js';

type TellaTranscriptPayload = {
  status?: string | null;
  text?: string | null;
  sentences?: Array<{ text?: string; startSeconds?: number; endSeconds?: number }> | null;
  language?: string | null;
};

export type TellaTranscript = TellaTranscriptPayload;

type TellaVideoResponse = {
  video?: {
    transcript?: TellaTranscriptPayload | null;
  } | null;
  error?: string;
  message?: string;
};

export async function fetchTranscript(videoId: string, operationLogger: Logger = defaultLogger): Promise<TellaTranscript> {
  const baseUrl = (process.env.TELLA_API_BASE_URL ?? 'https://api.tella.com/v1').replace(/\/$/, '');
  const apiKey = process.env.TELLA_API_KEY;

  if (!apiKey) {
    throw new Error('TELLA_API_KEY is not configured.');
  }

  const trimmedVideoId = videoId.trim();
  if (/^https?:\/\//i.test(trimmedVideoId)) {
    throw new Error('A Tella video ID is required; share URLs are not accepted.');
  }

  const url = `${baseUrl}/videos/${encodeURIComponent(trimmedVideoId)}`;
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error: unknown) {
    operationLogger.error({
      event: 'integration.tella.failed',
      failureType: 'network_error',
      ...getSafeErrorMetadata(error),
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error('Tella transcript request failed.');
  }

  if (!response.ok) {
    operationLogger.error({
      event: 'integration.tella.failed',
      failureType: 'http_error',
      statusCode: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error(`Tella request failed with status ${response.status}.`);
  }

  let body: TellaVideoResponse;
  try {
    body = (await response.json()) as TellaVideoResponse;
  } catch (error: unknown) {
    operationLogger.error({
      event: 'integration.tella.failed',
      failureType: 'invalid_response',
      statusCode: response.status,
      ...getSafeErrorMetadata(error),
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error('Tella returned an invalid transcript response.');
  }

  operationLogger.info({
    event: 'integration.tella.completed',
    statusCode: response.status,
    durationMs: Math.round(performance.now() - startedAt),
  });

  const transcript = body.video?.transcript;
  if (!transcript) {
    operationLogger.warn({ event: 'integration.tella.transcript_unavailable' });
    throw new Error('The Tella video does not have a transcript available yet.');
  }

  return transcript;
}

export async function saveTranscriptPayload(
  videoId: string,
  transcript: TellaTranscript,
  operationLogger: Logger = defaultLogger,
): Promise<string> {
  const tempDirectory = path.resolve(process.cwd(), 'temp');
  const fileName = `transcript-${videoId}-${randomUUID()}.json`;
  try {
    await mkdir(tempDirectory, { recursive: true });
    await writeFile(path.join(tempDirectory, fileName), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  } catch (error: unknown) {
    operationLogger.error({ event: 'artifact.transcript.persist_failed', ...getSafeErrorMetadata(error) });
    throw error;
  }

  operationLogger.info({ event: 'artifact.transcript.persisted' });
  return fileName;
}
