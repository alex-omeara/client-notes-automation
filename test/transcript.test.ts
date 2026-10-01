import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createLogger } from '../src/logger.js';
import { fetchTranscript, saveTranscriptPayload } from '../src/tella-transcript.js';

const tempDirectory = path.resolve(process.cwd(), 'temp');
const originalFetch = globalThis.fetch;
const originalKey = process.env.TELLA_API_KEY;
const originalBaseUrl = process.env.TELLA_API_BASE_URL;
const createdFiles: string[] = [];

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
  await Promise.all(createdFiles.splice(0).map((fileName) => rm(path.join(tempDirectory, fileName), { force: true })));
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

  const transcript = await fetchTranscript('vid_123');
  const fileName = await saveTranscriptPayload('vid_123', transcript);
  createdFiles.push(fileName);
  const saved = JSON.parse(await readFile(path.join(tempDirectory, fileName), 'utf8')) as {
    status: string;
    text: string;
    sentences: Array<{ text: string }>;
  };

  assert.equal(saved.text, 'Hello world');
  assert.equal(saved.status, 'ready');
  assert.match(fileName, /^transcript-vid_123-[0-9a-f-]+\.json$/);
});

test('rejects a full Tella share URL', async () => {
  process.env.TELLA_API_KEY = 'tella_pk_test_key';
  process.env.TELLA_API_BASE_URL = 'https://api.tella.com/v1';

  globalThis.fetch = async () => {
    assert.fail('Tella must not be called when the input is a share URL.');
  };

  await assert.rejects(
    fetchTranscript('https://app.tella.com/video/vid_123'),
    /A Tella video ID is required; share URLs are not accepted\./,
  );
});

test('logs Tella HTTP failure status without exposing upstream response text', async () => {
  process.env.TELLA_API_KEY = 'tella_pk_test_key';
  process.env.TELLA_API_BASE_URL = 'https://api.tella.com/v1';
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const testLogger = createLogger(destination);
  globalThis.fetch = async () => new Response('UPSTREAM_PRIVATE_ERROR_SENTINEL', { status: 503 });

  await assert.rejects(fetchTranscript('vid_failure', testLogger), /status 503/);

  const log = JSON.parse(output) as Record<string, unknown>;
  assert.equal(log.event, 'integration.tella.failed');
  assert.equal(log.failureType, 'http_error');
  assert.equal(log.statusCode, 503);
  assert.equal(output.includes('UPSTREAM_PRIVATE_ERROR_SENTINEL'), false);
  destination.end();
});

test('logs safe Tella network error metadata without exposing its message', async () => {
  process.env.TELLA_API_KEY = 'tella_pk_test_key';
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const testLogger = createLogger(destination);
  globalThis.fetch = async () => {
    throw Object.assign(new Error('PRIVATE_NETWORK_MESSAGE_SENTINEL'), { code: 'ECONNRESET' });
  };

  await assert.rejects(fetchTranscript('vid_network_failure', testLogger), /Tella transcript request failed\./);

  const log = JSON.parse(output) as Record<string, unknown>;
  assert.equal(log.event, 'integration.tella.failed');
  assert.equal(log.failureType, 'network_error');
  assert.equal(log.errorType, 'Error');
  assert.equal(log.errorCode, 'ECONNRESET');
  assert.equal(output.includes('PRIVATE_NETWORK_MESSAGE_SENTINEL'), false);
  destination.end();
});