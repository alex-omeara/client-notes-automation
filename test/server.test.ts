import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createLogger } from '../src/logger.js';
import { createApp, type ServerDependencies } from '../src/server.js';

const sensitiveMarker = 'PRIVATE_TRANSCRIPT_SENTINEL';

async function withServer(
  dependencies: ServerDependencies,
  run: (url: string, getRecords: () => Array<Record<string, unknown>>) => Promise<void>,
): Promise<void> {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const server = createApp(dependencies, createLogger(destination)).listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`, () => lines.map((line) => JSON.parse(line) as Record<string, unknown>));
  } finally {
    server.close();
    await once(server, 'close');
    destination.end();
  }
}

function fakeDependencies(overrides: Partial<ServerDependencies> = {}): ServerDependencies {
  return {
    fetchTranscript: async () => ({ text: sensitiveMarker }),
    saveTranscriptPayload: async () => 'private-filename.json',
    generateActionPoints: async () => ({
      markdownFileName: 'private-action-points.md',
      jsonFileName: 'private-action-points.json',
      markdownText: 'PRIVATE_ACTION_POINT_SENTINEL',
    }),
    appendActionPointsToGoogleSheet: async () => 1,
    listConfiguredGoogleSpreadsheetChoices: async () => [
      { name: 'Monday Client Notes' },
      { name: 'Sunday Client Notes' },
    ],
    listGoogleSpreadsheets: async () => [
      { id: 'monday-id', name: 'Monday Client Notes' },
      { id: 'sunday-id', name: 'Sunday Client Notes' },
    ],
    listGoogleSheetTabs: async (spreadsheetName: string) => {
      assert.equal(['Monday Client Notes', 'Sunday Client Notes'].includes(spreadsheetName), true);
      return ['test', 'Archive'];
    },
    ...overrides,
  } as ServerDependencies;
}

test('lists the two available note spreadsheets and selected spreadsheet tabs', async () => {
  await withServer(fakeDependencies(), async (url) => {
    const spreadsheetResponse = await fetch(`${url}/api/google/spreadsheets`);
    const spreadsheetPayload = await spreadsheetResponse.json() as { spreadsheets: Array<{ id: string; name: string }> };
    assert.equal(spreadsheetResponse.status, 200);
      assert.equal(spreadsheetResponse.headers.get('cache-control'), 'no-store');
    assert.deepEqual(spreadsheetPayload.spreadsheets.map(({ name }) => name), [
      'Monday Client Notes',
      'Sunday Client Notes',
    ]);
    assert.equal(JSON.stringify(spreadsheetPayload).includes('monday-id'), false);

    const tabsResponse = await fetch(`${url}/api/google/spreadsheets/Monday%20Client%20Notes/tabs`);
    const tabsPayload = await tabsResponse.json() as { tabs: string[] };
    assert.equal(tabsResponse.status, 200);
      assert.equal(tabsResponse.headers.get('cache-control'), 'no-store');
    assert.deepEqual(tabsPayload.tabs, ['test', 'Archive']);
  });
});

test('returns and logs a request ID without logging transcript or generated text', async () => {
  await withServer(fakeDependencies(), async (url, getRecords) => {
    const response = await fetch(`${url}/api/transcripts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        videoId: 'private-video-id',
        outputMode: 'downloads',
      }),
    });
    const payload = await response.json() as { requestId?: string };
    const requestId = response.headers.get('x-request-id');
    const records = getRecords();

    assert.equal(response.status, 200);
    assert.ok(requestId);
    assert.equal(payload.requestId, undefined);
    assert.equal(records.length > 0, true);
    assert.equal(records.every((record) => record.requestId === requestId), true);
    assert.equal(records.some((record) => record.event === 'workflow.stage.completed'), true);
    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes(sensitiveMarker), false);
    assert.equal(serialized.includes('PRIVATE_ACTION_POINT_SENTINEL'), false);
    assert.equal(serialized.includes('private-video-id'), false);
    assert.equal(serialized.includes('private-filename'), false);
  });
});

test('returns a generic correlated failure without exposing provider messages', async () => {
  await withServer(fakeDependencies({
    fetchTranscript: async () => {
      throw new Error('UPSTREAM_PRIVATE_ERROR_SENTINEL');
    },
  }), async (url, getRecords) => {
    const response = await fetch(`${url}/api/transcripts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        videoId: 'private-video-id',
        outputMode: 'downloads',
      }),
    });
    const payload = await response.json() as { error: string; requestId: string };
    const requestId = response.headers.get('x-request-id');
    const records = getRecords();

    assert.equal(response.status, 502);
    assert.equal(payload.error, 'Unable to complete the transcript request.');
    assert.equal(payload.requestId, requestId);
    assert.equal(JSON.stringify(records).includes('UPSTREAM_PRIVATE_ERROR_SENTINEL'), false);
    const stageFailure = records.find((record) => record.event === 'workflow.stage.failed');
    const workflowFailure = records.find((record) => record.event === 'workflow.failed');
    assert.equal(stageFailure?.errorType, 'Error');
    assert.equal(workflowFailure?.errorType, 'Error');
    assert.equal(JSON.stringify(records).includes('stack'), false);
  });
});

test('includes request IDs in validation errors without logging request values', async () => {
  await withServer(fakeDependencies(), async (url, getRecords) => {
    const response = await fetch(`${url}/api/transcripts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoId: 'PRIVATE_INVALID_INPUT' }),
    });
    const payload = await response.json() as { error: string; requestId: string };
    const requestId = response.headers.get('x-request-id');
    const records = getRecords();

    assert.equal(response.status, 400);
    assert.match(payload.error, /spreadsheet must be selected/);
    assert.equal(payload.requestId, requestId);
    assert.equal(JSON.stringify(records).includes('PRIVATE_INVALID_INPUT'), false);
  });
});
