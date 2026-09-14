import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { saveTranscript } from '../src/tella-transcript.js';

const tempDirectory = path.resolve(process.cwd(), 'temp');
const originalFetch = globalThis.fetch;
const originalKey = process.env.TELLA_API_KEY;
const originalBaseUrl = process.env.TELLA_API_BASE_URL;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) {
    delete process.env.TELLA_API_KEY;
  } else {
    process.env.TELLA_API_KEY = originalKey;
  }
  if (originalBaseUrl === undefined) {
    delete process.env.TELLA_API_BASE_URL;
  } else {
    process.env.TELLA_API_BASE_URL = originalBaseUrl;
  }
  await rm(tempDirectory, { recursive: true, force: true });
});

test('saves the Tella transcript payload as JSON in temp', async () => {
  process.env.TELLA_API_KEY = 'tella_pk_test_key';
  process.env.TELLA_API_BASE_URL = 'https://api.tella.com/v1';

  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://api.tella.com/v1/videos/vid_123');
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Authorization, 'Bearer tella_pk_test_key');
    return new Response(JSON.stringify({
      video: {
        transcript: {
          status: 'ready',
          text: 'Hello world',
          sentences: [{ text: 'Hello world', startSeconds: 0, endSeconds: 2 }],
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const fileName = await saveTranscript('vid_123');
  const saved = JSON.parse(await readFile(path.join(tempDirectory, fileName), 'utf8')) as {
    status: string;
    text: string;
    sentences: Array<{ text: string }>;
  };

  assert.equal(saved.text, 'Hello world');
  assert.equal(saved.status, 'ready');
  assert.match(fileName, /^transcript-vid_123-[0-9a-f-]+\.json$/);
});