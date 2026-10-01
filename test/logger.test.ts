import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createLogger, getSafeErrorMetadata } from '../src/logger.js';

test('redacts credential fields from structured output', () => {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = createLogger(destination);

  logger.info({
    event: 'test.redaction',
    authorization: 'Bearer secret-token',
    headers: { authorization: 'Bearer nested-secret' },
    apiKey: 'secret-api-key',
    message: 'safe',
  });

  const record = JSON.parse(output) as Record<string, unknown>;
  assert.equal(record.authorization, '[REDACTED]');
  assert.deepEqual(record.headers, { authorization: '[REDACTED]' });
  assert.equal(record.apiKey, '[REDACTED]');
  assert.equal(output.includes('secret-token'), false);
  assert.equal(output.includes('nested-secret'), false);
  assert.equal(output.includes('secret-api-key'), false);
  destination.end();
});

test('extracts safe error metadata without exposing messages, stacks, or payloads', () => {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = createLogger(destination);
  const error = Object.assign(new Error('PRIVATE_ERROR_MESSAGE_SENTINEL'), {
    code: 'ECONNRESET',
    status: 429,
    response: { data: 'PRIVATE_RESPONSE_SENTINEL' },
  });

  logger.error({ event: 'test.error', ...getSafeErrorMetadata(error) });

  const record = JSON.parse(output) as Record<string, unknown>;
  assert.equal(record.errorType, 'Error');
  assert.equal(record.errorCode, 'ECONNRESET');
  assert.equal(record.statusCode, 429);
  assert.equal(output.includes('PRIVATE_ERROR_MESSAGE_SENTINEL'), false);
  assert.equal(output.includes('PRIVATE_RESPONSE_SENTINEL'), false);
  assert.equal(output.includes('stack'), false);
  destination.end();
});
