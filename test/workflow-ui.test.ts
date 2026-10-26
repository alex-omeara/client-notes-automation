import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkflowUiState } from '../src/workflow-ui.js';

const validDownloadsOptions = {
  status: 'ready' as const,
  videoId: 'video-123',
  outputMode: 'downloads' as const,
  sheetsLoading: false,
  spreadsheetName: '',
  sheetName: '',
};

test('hides workflow controls and disables generation while processing', () => {
  const state = getWorkflowUiState({
    ...validDownloadsOptions,
    status: 'processing',
  });

  assert.equal(state.isProcessing, true);
  assert.equal(state.showControls, false);
  assert.equal(state.generateDisabled, true);
});

test('enables generation when the video ID and selected output are ready', () => {
  const state = getWorkflowUiState(validDownloadsOptions);

  assert.equal(state.showControls, true);
  assert.equal(state.generateDisabled, false);
});

test('disables generation until the video ID and spreadsheet selection are ready', () => {
  const missingVideo = getWorkflowUiState({
    ...validDownloadsOptions,
    videoId: '',
  });
  const missingWorksheet = getWorkflowUiState({
    ...validDownloadsOptions,
    outputMode: 'google-sheet',
    spreadsheetName: 'Client notes',
    sheetName: '',
  });

  assert.equal(missingVideo.generateDisabled, true);
  assert.equal(missingWorksheet.generateDisabled, true);
});
