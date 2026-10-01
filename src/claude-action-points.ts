import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import { getSafeErrorMetadata, logger as defaultLogger } from './logger.js';
import type { TellaTranscript } from './tella-transcript.js';

const actionPointsPrompt = `Analyze the following meeting transcript and produce a clear list of concrete action points.

Use only information present in the transcript. Include an owner or due date only when one is explicitly stated. Return a concise, readable Markdown list.

Transcript:
`;

type ActionPointsFiles = {
  markdownFileName: string;
  jsonFileName: string;
  markdownText?: string;
};

export async function generateActionPoints(
  videoId: string,
  transcript: TellaTranscript,
  queryRunner: typeof query = query,
  operationLogger: Logger = defaultLogger,
): Promise<ActionPointsFiles> {
  const transcriptText = transcript.text?.trim() || transcript.sentences
    ?.map((sentence) => sentence.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join(' ');

  if (!transcriptText) {
    throw new Error('The Tella transcript does not contain any text.');
  }

  let finalResult: unknown;
  const generationStartedAt = performance.now();
  let failureLogged = false;
  try {
    for await (const message of queryRunner({
      prompt: `${actionPointsPrompt}${transcriptText}`,
      options: {
        tools: [],
        maxTurns: 1,
      },
    })) {
      if (message.type === 'result') {
        if (message.subtype !== 'success') {
          failureLogged = true;
          operationLogger.error({
            event: 'integration.claude.failed',
            failureType: 'unsuccessful_result',
            resultSubtype: message.subtype,
            ...('api_error_status' in message && typeof message.api_error_status === 'number'
              ? { statusCode: message.api_error_status }
              : {}),
            durationMs: Math.round(performance.now() - generationStartedAt),
          });
          throw new Error('Claude could not generate action points.');
        }
        if (message.is_error) {
          failureLogged = true;
          operationLogger.error({
            event: 'integration.claude.failed',
            failureType: 'provider_reported_error',
            resultSubtype: message.subtype,
            ...('api_error_status' in message && typeof message.api_error_status === 'number'
              ? { statusCode: message.api_error_status }
              : {}),
            durationMs: Math.round(performance.now() - generationStartedAt),
          });
          throw new Error('Claude could not generate action points.');
        }
        finalResult = message;
      }
    }
  } catch (error: unknown) {
    if (!failureLogged) {
      operationLogger.error({
        event: 'integration.claude.failed',
        failureType: 'sdk_exception',
        ...getSafeErrorMetadata(error),
        durationMs: Math.round(performance.now() - generationStartedAt),
      });
    }
    throw error;
  }

  if (!finalResult || typeof finalResult !== 'object' || !('result' in finalResult) || typeof finalResult.result !== 'string') {
    operationLogger.error({
      event: 'integration.claude.failed',
      failureType: 'invalid_result',
      errorType: 'InvalidResultError',
      durationMs: Math.round(performance.now() - generationStartedAt),
    });
    throw new Error('Claude did not return a complete response.');
  }

  operationLogger.info({
    event: 'integration.claude.completed',
    durationMs: Math.round(performance.now() - generationStartedAt),
  });

  const responseText = finalResult.result;
  const tempDirectory = path.resolve(process.cwd(), 'temp');
  await mkdir(tempDirectory, { recursive: true });

  const fileId = `${videoId}-${randomUUID()}`;
  const markdownFileName = `action-points-${fileId}.md`;
  const jsonFileName = `action-points-${fileId}.json`;

  try {
    await Promise.all([
      writeFile(path.join(tempDirectory, markdownFileName), `${responseText}\n`, 'utf8'),
      writeFile(path.join(tempDirectory, jsonFileName), `${JSON.stringify(finalResult, null, 2)}\n`, 'utf8'),
    ]);
  } catch (error: unknown) {
    operationLogger.error({ event: 'artifact.action_points.persist_failed', ...getSafeErrorMetadata(error) });
    throw new Error('Unable to save generated action points.');
  }

  operationLogger.info({ event: 'artifact.action_points.persisted' });
  return { markdownFileName, jsonFileName, markdownText: responseText };
}