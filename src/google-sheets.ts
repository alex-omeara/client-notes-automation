import { google } from 'googleapis';
import type { Logger } from 'pino';
import { getSafeErrorMetadata, logger } from './logger.js';

const GOOGLE_SHEET_ROW_TARGET_COLUMN = 'L';
const FALLBACK_DOWNLOADS_DIRECTORY = 'Downloads';

type OutputMode = 'google-sheet' | 'downloads';

type GoogleSheetWriteOptions = {
  spreadsheetName?: string;
  sheetName?: string;
  weekNumber?: number;
  outputMode?: OutputMode;
};

export type GoogleSpreadsheet = {
  id: string;
  name: 'Monday Client Notes' | 'Sunday Client Notes';
};

export type GoogleSpreadsheetChoice = {
  name: GoogleSpreadsheet['name'];
};

const GOOGLE_SPREADSHEET_ENV = [
  ['Monday Client Notes', 'GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID'],
  ['Sunday Client Notes', 'GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID'],
] as const;

function createGoogleAuth(): InstanceType<typeof google.auth.OAuth2> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Sheets OAuth is not configured.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export async function listGoogleSpreadsheets(): Promise<GoogleSpreadsheet[]> {
  const spreadsheets = GOOGLE_SPREADSHEET_ENV.map(([name, envName]) => ({
    name,
    id: process.env[envName]?.trim() ?? '',
  }));

  if (spreadsheets.some(({ id }) => !id)) {
    throw new Error('Both Google spreadsheet IDs must be configured.');
  }
  if (new Set(spreadsheets.map(({ id }) => id)).size !== spreadsheets.length) {
    throw new Error('Google spreadsheet IDs must be different.');
  }

  return spreadsheets;
}

export async function listConfiguredGoogleSpreadsheetChoices(): Promise<GoogleSpreadsheetChoice[]> {
  const spreadsheets = await listGoogleSpreadsheets();
  return spreadsheets.map(({ name }) => ({ name }));
}

export async function listGoogleSheetTabs(spreadsheetName: string): Promise<string[]> {
  const configured = await listGoogleSpreadsheets();
  const spreadsheet = configured.find((item) => item.name === spreadsheetName);
  if (!spreadsheet) {
    throw new Error('The selected Google spreadsheet is not configured.');
  }

  const sheets = google.sheets({ version: 'v4', auth: createGoogleAuth() });
  const response = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheet.id,
    fields: 'sheets.properties.title',
  });
  return (response.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => typeof title === 'string');
}

export function parseMarkdownActionPoints(markdown: string): string[] {
  const cleanedLines = markdown.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .map((line) => line
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^#+\s*/, '')
      .replace(/^>\s*/, '')
      .trim())
    .filter((line) => line.length > 0 && !line.startsWith('---'));

  return cleanedLines.filter((line) => !/^(summary|follow-up|notes)$/i.test(line));
}

export function buildGoogleSheetRows(videoId: string, actionPoints: string[]): Array<[string, string, string]> {
  const timestamp = new Date().toISOString();
  return actionPoints.map((point) => [videoId, timestamp, point]);
}

export function findWeekRange(rows: unknown[][], weekNumber: number | string): { startRow: number; endRow: number } | null {
  const target = String(weekNumber).trim().replace(/^week\s+/i, '');

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const firstCell = row[0] === undefined ? '' : String(row[0]).trim();
    if (firstCell !== target) {
      continue;
    }

    let endRow = rowIndex + 1;
    let currentRow = rowIndex + 1;
    while (currentRow < rows.length) {
      const currentCell = rows[currentRow]?.[0];
      if (currentCell !== undefined && String(currentCell).trim() !== '') {
        break;
      }
      endRow = currentRow + 1;
      currentRow += 1;
    }

    return { startRow: rowIndex + 1, endRow };
  }

  return null;
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export function buildWeekLookupRange(sheetName: string): string {
  return `${quoteSheetName(sheetName)}!A:A`;
}

export function buildActionPointCellRange(sheetName: string, rowNumber: number): string {
  return `${quoteSheetName(sheetName)}!${GOOGLE_SHEET_ROW_TARGET_COLUMN}${rowNumber}`;
}

export function buildWeekActionPointWrites(
  weekRange: { startRow: number; endRow: number },
  actionPoints: string[],
): Array<{ rowNumber: number; text: string }> {
  const rowCount = weekRange.endRow - weekRange.startRow + 1;
  if (rowCount <= 0 || actionPoints.length === 0) {
    return [];
  }

  const writes: Array<{ rowNumber: number; text: string }> = [];
  const individualCount = Math.min(actionPoints.length, rowCount - 1);
  for (let index = 0; index < individualCount; index += 1) {
    writes.push({ rowNumber: weekRange.startRow + index, text: actionPoints[index] });
  }

  const overflow = actionPoints.slice(individualCount);
  if (overflow.length > 0) {
    writes.push({ rowNumber: weekRange.endRow, text: overflow.join('\n') });
  }

  return writes;
}

export async function appendActionPointsToGoogleSheet(
  videoId: string,
  markdown: string,
  options: GoogleSheetWriteOptions = {},
  operationLogger: Logger = logger,
): Promise<number> {
  const actionPoints = parseMarkdownActionPoints(markdown);
  if (actionPoints.length === 0) {
    return 0;
  }

  const spreadsheetName = options.spreadsheetName;
  const sheetName = options.sheetName?.trim();
  const mode = options.outputMode ?? 'google-sheet';

  if (mode === 'downloads') {
    const downloadsDirectory = process.env.HOME ? `${process.env.HOME}/${FALLBACK_DOWNLOADS_DIRECTORY}` : FALLBACK_DOWNLOADS_DIRECTORY;
    const fileName = `${videoId}-action-points-${Date.now()}.txt`;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    await fs.mkdir(downloadsDirectory, { recursive: true });
    const targetPath = path.join(downloadsDirectory, fileName);
    await fs.writeFile(targetPath, `${actionPoints.join('\n')}\n`, 'utf8');
    operationLogger.info({ event: 'output.downloads.saved', itemCount: actionPoints.length });
    return actionPoints.length;
  }

  if (!sheetName || !spreadsheetName) {
    throw new Error('A spreadsheet and worksheet tab must be selected.');
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Sheets OAuth is not configured.');
  }

  const configured = await listGoogleSpreadsheets();
  const selectedSpreadsheet = configured.find((spreadsheet) => spreadsheet.name === spreadsheetName);
  if (!selectedSpreadsheet) {
    throw new Error('The selected Google spreadsheet is not configured.');
  }
  const spreadsheetId = selectedSpreadsheet.id;

  const weekNumber = Number(options.weekNumber ?? 0);

  const sheets = google.sheets({ version: 'v4', auth: createGoogleAuth() });

  const range = buildWeekLookupRange(sheetName);
  let response;
  try {
    response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  } catch (error: unknown) {
    operationLogger.error({
      event: 'integration.google_sheets.failed',
      operation: 'read_rows',
      ...getSafeErrorMetadata(error),
    });
    throw new Error('Google Sheets could not read the target sheet.');
  }
  const rows = (response.data.values ?? []) as unknown[][];
  const weekRange = findWeekRange(rows, weekNumber);

  if (!weekRange) {
    operationLogger.warn({ event: 'output.google_sheets.week_not_found' });
    throw new Error(`No row matching week ${weekNumber} was found in sheet ${sheetName}.`);
  }

  for (const write of buildWeekActionPointWrites(weekRange, actionPoints)) {
    const targetCell = buildActionPointCellRange(sheetName, write.rowNumber);
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: targetCell,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[write.text]],
        },
      });
    } catch (error: unknown) {
      operationLogger.error({
        event: 'integration.google_sheets.failed',
        operation: 'write_rows',
        ...getSafeErrorMetadata(error),
      });
      throw new Error('Google Sheets could not write the action points.');
    }
  }

  operationLogger.info({ event: 'output.google_sheets.updated', itemCount: actionPoints.length });
  return actionPoints.length;
}
