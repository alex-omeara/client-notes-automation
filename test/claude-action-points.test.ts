import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { generateActionPoints } from '../src/claude-action-points.js';

const tempDirectory = path.resolve(process.cwd(), 'temp');

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
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

  await generateActionPoints('vid_456', {
    sentences: [{ text: 'Discuss budget.' }, { text: 'Assign follow-up.' }],
  }, fakeQuery);

  assert.match(receivedPrompt, /Discuss budget\. Assign follow-up\./);
});