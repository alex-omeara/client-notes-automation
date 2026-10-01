import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendActionPointsToGoogleSheet,
  buildActionPointCellRange,
  buildGoogleSheetRows,
  buildWeekActionPointWrites,
  buildWeekLookupRange,
  findWeekRange,
  listGoogleSpreadsheets,
  parseMarkdownActionPoints,
} from '../src/google-sheets.js';

test('parses markdown action point bullets into clean items', () => {
  const markdown = [
    '# Meeting notes',
    '',
    '- Confirm launch date with the client.',
    '* Send the revised proposal by Friday.',
    '1. Review budget assumptions.',
    '',
    '### Follow-up',
  ].join('\n');

  assert.deepEqual(parseMarkdownActionPoints(markdown), [
    'Confirm launch date with the client.',
    'Send the revised proposal by Friday.',
    'Review budget assumptions.',
  ]);
});

test('builds append payload rows for a Google Sheet', () => {
  const rows = buildGoogleSheetRows('vid_123', [
    'Confirm launch date with the client.',
    'Send the revised proposal by Friday.',
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], 'vid_123');
  assert.equal(rows[0][1].length > 0, true);
  assert.equal(rows[0][2], 'Confirm launch date with the client.');
  assert.equal(rows[1][0], 'vid_123');
  assert.equal(rows[1][2], 'Send the revised proposal by Friday.');
});

test('finds the week row range and supports merged week blocks', () => {
  const values = [
    ['Week', 'Owner'],
    ['2', 'Alicia'],
    ['', ''],
    ['', ''],
    ['3', 'Ben'],
  ];

  const range = findWeekRange(values, 2);
  assert.deepEqual(range, { startRow: 2, endRow: 4 });
});

test('keeps extra action points in the final row of the week block', () => {
  const values = [
    ['Week', 'Owner'],
    ['2', 'Alicia'],
    ['', ''],
    ['', ''],
    ['3', 'Ben'],
  ];

  const range = findWeekRange(values, 2);
  assert.deepEqual(range, { startRow: 2, endRow: 4 });
});

test('reads week numbers from column A on the selected worksheet', () => {
  assert.equal(buildWeekLookupRange('test'), "'test'!A:A");
  assert.equal(buildWeekLookupRange("client's test"), "'client''s test'!A:A");
});

test('requires both named spreadsheet IDs and ignores the legacy ID', async () => {
  const originalMonday = process.env.GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID;
  const originalSunday = process.env.GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID;
  const originalLegacy = process.env.GOOGLE_SHEET_ID;
  delete process.env.GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID;
  process.env.GOOGLE_SHEET_ID = 'legacy-monday-id';
  process.env.GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID = 'sunday-id';

  try {
    await assert.rejects(listGoogleSpreadsheets(), /Both Google spreadsheet IDs must be configured/);
    process.env.GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID = 'monday-id';
    assert.deepEqual(await listGoogleSpreadsheets(), [
      { id: 'monday-id', name: 'Monday Client Notes' },
      { id: 'sunday-id', name: 'Sunday Client Notes' },
    ]);

    process.env.GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID = 'monday-id';
    await assert.rejects(listGoogleSpreadsheets(), /Google spreadsheet IDs must be different/);
  } finally {
    if (originalMonday === undefined) delete process.env.GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID;
    else process.env.GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID = originalMonday;
    if (originalSunday === undefined) delete process.env.GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID;
    else process.env.GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID = originalSunday;
    if (originalLegacy === undefined) delete process.env.GOOGLE_SHEET_ID;
    else process.env.GOOGLE_SHEET_ID = originalLegacy;
  }
});

test('writes one action point per week row and joins overflow in the final row', () => {
  const weekRange = { startRow: 2, endRow: 7 };
  const writes = buildWeekActionPointWrites(weekRange, [
    'Action 1',
    'Action 2',
    'Action 3',
    'Action 4',
    'Action 5',
    'Action 6',
    'Action 7',
    'Action 8',
  ]);

  assert.deepEqual(writes, [
    { rowNumber: 2, text: 'Action 1' },
    { rowNumber: 3, text: 'Action 2' },
    { rowNumber: 4, text: 'Action 3' },
    { rowNumber: 5, text: 'Action 4' },
    { rowNumber: 6, text: 'Action 5' },
    { rowNumber: 7, text: 'Action 6\nAction 7\nAction 8' },
  ]);
  assert.equal(buildActionPointCellRange('test', writes[0].rowNumber), "'test'!L2");
  assert.equal(writes.every((write) => write.rowNumber >= weekRange.startRow && write.rowNumber <= weekRange.endRow), true);
});

test('writes fewer action points without extending beyond the week range', () => {
  assert.deepEqual(buildWeekActionPointWrites({ startRow: 16, endRow: 21 }, ['One', 'Two']), [
    { rowNumber: 16, text: 'One' },
    { rowNumber: 17, text: 'Two' },
  ]);
});

test('allocates action points within a week block of a different size', () => {
  const weekRange = { startRow: 30, endRow: 33 };
  const writes = buildWeekActionPointWrites(weekRange, ['One', 'Two', 'Three', 'Four', 'Five']);

  assert.deepEqual(writes, [
    { rowNumber: 30, text: 'One' },
    { rowNumber: 31, text: 'Two' },
    { rowNumber: 32, text: 'Three' },
    { rowNumber: 33, text: 'Four\nFive' },
  ]);
  assert.equal(writes.every((write) => write.rowNumber >= weekRange.startRow && write.rowNumber <= weekRange.endRow), true);
});

test('uses the downloads mode when the user selects a local fallback', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'client-notes-home-'));
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const count = await appendActionPointsToGoogleSheet('vid_999', '- First action\n- Second action', {
      outputMode: 'downloads',
    });

    const downloadsDirectory = path.join(tempHome, 'Downloads');
    const fileNames = (await import('node:fs/promises')).readdir(downloadsDirectory);
    assert.equal(count, 2);
    const fileList = await fileNames;
    assert.equal(fileList.length > 0, true);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  }
});
