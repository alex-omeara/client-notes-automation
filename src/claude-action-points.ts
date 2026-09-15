import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { TellaTranscript } from './tella-transcript.js';

const actionPointsPrompt = `Analyze the following meeting transcript and produce a clear list of concrete action points.

Use only information present in the transcript. Include an owner or due date only when one is explicitly stated. Return a concise, readable Markdown list.

Transcript:
`;

type ActionPointsFiles = {
  markdownFileName: string;
  jsonFileName: string;
};

export async function generateActionPoints(
  videoId: string,
  transcript: TellaTranscript,
  queryRunner: typeof query = query,
): Promise<ActionPointsFiles> {
  const transcriptText = transcript.text?.trim() || transcript.sentences
    ?.map((sentence) => sentence.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join(' ');

  if (!transcriptText) {
    throw new Error('The Tella transcript does not contain any text.');
  }

  let finalResult: unknown;
  for await (const message of queryRunner({
    prompt: `${actionPointsPrompt}${transcriptText}`,
    options: {
      tools: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error('Claude could not generate action points.');
      }
      if (message.is_error) {
        throw new Error(message.result || 'Claude could not generate action points.');
      }
      finalResult = message;
    }
  }

  if (!finalResult || typeof finalResult !== 'object' || !('result' in finalResult) || typeof finalResult.result !== 'string') {
    throw new Error('Claude did not return a complete response.');
  }

  const responseText = finalResult.result;
  const tempDirectory = path.resolve(process.cwd(), 'temp');
  await mkdir(tempDirectory, { recursive: true });

  const fileId = `${videoId}-${randomUUID()}`;
  const markdownFileName = `action-points-${fileId}.md`;
  const jsonFileName = `action-points-${fileId}.json`;

  await Promise.all([
    writeFile(path.join(tempDirectory, markdownFileName), `${responseText}\n`, 'utf8'),
    writeFile(path.join(tempDirectory, jsonFileName), `${JSON.stringify(finalResult, null, 2)}\n`, 'utf8'),
  ]);

  return { markdownFileName, jsonFileName };
}