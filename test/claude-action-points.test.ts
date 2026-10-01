import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createLogger } from '../src/logger.js';
import { generateActionPoints } from '../src/claude-action-points.js';

const tempDirectory = path.resolve(process.cwd(), 'temp');
const createdFiles: string[] = [];

afterEach(async () => {
  await Promise.all(createdFiles.splice(0).map((fileName) => rm(path.join(tempDirectory, fileName), { force: true })));
});

test('saves the complete Claude response as Markdown and JSON', async () => {
  const responseText = '- Confirm launch date with the client.\n- Send the revised proposal.';
  const fakeQuery = (() => (async function* (): AsyncGenerator<SDKMessage> {
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: responseText,
    } as unknown as SDKMessage;
  })()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const files = await generateActionPoints('vid_123', {
    text: 'The client asked us to confirm the launch date and send the revised proposal.',
  }, fakeQuery);
  createdFiles.push(files.markdownFileName, files.jsonFileName);

  const markdown = await readFile(path.join(tempDirectory, files.markdownFileName), 'utf8');
  const json = JSON.parse(await readFile(path.join(tempDirectory, files.jsonFileName), 'utf8')) as { result: string };

  assert.equal(markdown, `${responseText}\n`);
  assert.equal(json.result, responseText);
  assert.match(files.markdownFileName, /^action-points-vid_123-[0-9a-f-]+\.md$/);
  assert.match(files.jsonFileName, /^action-points-vid_123-[0-9a-f-]+\.json$/);
});

test('uses sentence text when the transcript text field is absent', async () => {
  let receivedPrompt = '';
  const fakeQuery = ((params: Parameters<typeof import('@anthropic-ai/claude-agent-sdk').query>[0]) => {
    receivedPrompt = params.prompt as string;
    return (async function* (): AsyncGenerator<SDKMessage> {
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'No action points found.',
      } as unknown as SDKMessage;
    })();
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const files = await generateActionPoints('vid_456', {
    sentences: [{ text: 'Discuss budget.' }, { text: 'Assign follow-up.' }],
  }, fakeQuery);
  createdFiles.push(files.markdownFileName, files.jsonFileName);

  assert.match(receivedPrompt, /Discuss budget\. Assign follow-up\./);
});

test('logs a sanitized Claude SDK failure without exposing provider details', async () => {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const testLogger = createLogger(destination);
  const failingQuery = (() => (async function* (): AsyncGenerator<SDKMessage> {
    throw Object.assign(new Error('PRIVATE_CLAUDE_FAILURE_SENTINEL'), { status: 429 });
    yield {} as SDKMessage;
  })()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  await assert.rejects(
    generateActionPoints('vid_failure', { text: 'Private transcript' }, failingQuery, testLogger),
    /PRIVATE_CLAUDE_FAILURE_SENTINEL/,
  );

  const log = JSON.parse(output) as Record<string, unknown>;
  assert.equal(log.event, 'integration.claude.failed');
  assert.equal(log.failureType, 'sdk_exception');
  assert.equal(log.statusCode, 429);
  assert.equal(log.errorType, 'Error');
  assert.equal(output.includes('PRIVATE_CLAUDE_FAILURE_SENTINEL'), false);
  assert.equal(output.includes('Private transcript'), false);
  destination.end();
});

test('logs Claude result subtype and API status without exposing result text', async () => {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const testLogger = createLogger(destination);
  const failingQuery = (() => (async function* (): AsyncGenerator<SDKMessage> {
    yield {
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result: 'PRIVATE_CLAUDE_RESULT_SENTINEL',
    } as unknown as SDKMessage;
  })()) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  await assert.rejects(
    generateActionPoints('vid_result_failure', { text: 'Private transcript' }, failingQuery, testLogger),
    /Claude could not generate action points\./,
  );

  const log = JSON.parse(output) as Record<string, unknown>;
  assert.equal(log.event, 'integration.claude.failed');
  assert.equal(log.failureType, 'provider_reported_error');
  assert.equal(log.resultSubtype, 'success');
  assert.equal(log.statusCode, 429);
  assert.equal(output.includes('PRIVATE_CLAUDE_RESULT_SENTINEL'), false);
  assert.equal(output.includes('Private transcript'), false);
  destination.end();
});