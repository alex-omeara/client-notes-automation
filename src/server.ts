import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from 'express';
import path from 'node:path';
import { generateActionPoints } from './claude-action-points.js';
import {
  appendActionPointsToGoogleSheet,
  listConfiguredGoogleSpreadsheetChoices,
  listGoogleSheetTabs,
  listGoogleSpreadsheets,
} from './google-sheets.js';
import { getSafeErrorMetadata, logger as defaultLogger } from './logger.js';
import type { Logger } from 'pino';
import { fetchTranscript, saveTranscriptPayload } from './tella-transcript.js';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3001);
const frontendDirectory = path.resolve(process.cwd(), 'dist');

export type ServerDependencies = {
  fetchTranscript: typeof fetchTranscript;
  saveTranscriptPayload: typeof saveTranscriptPayload;
  generateActionPoints: typeof generateActionPoints;
  appendActionPointsToGoogleSheet: typeof appendActionPointsToGoogleSheet;
  listConfiguredGoogleSpreadsheetChoices: typeof listConfiguredGoogleSpreadsheetChoices;
  listGoogleSpreadsheets: typeof listGoogleSpreadsheets;
  listGoogleSheetTabs: typeof listGoogleSheetTabs;
};

const defaultDependencies: ServerDependencies = {
  fetchTranscript,
  saveTranscriptPayload,
  generateActionPoints,
  appendActionPointsToGoogleSheet,
  listConfiguredGoogleSpreadsheetChoices,
  listGoogleSpreadsheets,
  listGoogleSheetTabs,
};

export function createApp(
  dependencies: ServerDependencies = defaultDependencies,
  appLogger: Logger = defaultLogger,
): Express {
  const app = express();
  app.use((request: Request, response: Response, next) => {
    const requestId = randomUUID();
    const requestLogger = appLogger.child({ requestId });
    const startedAt = performance.now();
    response.locals.requestId = requestId;
    response.locals.logger = requestLogger;
    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () => {
      requestLogger.info({
        event: 'http.request.completed',
        method: request.method,
        route: request.route?.path ?? 'unmatched',
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  app.get('/api/google/spreadsheets', async (request: Request, response: Response) => {
    const requestLogger = response.locals.logger as Logger;
    response.setHeader('Cache-Control', 'no-store');
    try {
      const spreadsheets = await dependencies.listConfiguredGoogleSpreadsheetChoices();
      response.json({ spreadsheets });
    } catch (error: unknown) {
      requestLogger.error({ event: 'integration.google_drive.list_failed', ...getSafeErrorMetadata(error) });
      response.status(502).json({ error: 'Unable to load Google spreadsheets.' });
    }
  });

  app.get('/api/google/spreadsheets/:spreadsheetName/tabs', async (request: Request, response: Response) => {
    const requestLogger = response.locals.logger as Logger;
    response.setHeader('Cache-Control', 'no-store');
    const spreadsheetName = Array.isArray(request.params.spreadsheetName)
      ? request.params.spreadsheetName[0] ?? ''
      : request.params.spreadsheetName;
    try {
      const tabs = await dependencies.listGoogleSheetTabs(spreadsheetName);
      response.json({ tabs });
    } catch (error: unknown) {
      requestLogger.error({ event: 'integration.google_sheets.list_tabs_failed', ...getSafeErrorMetadata(error) });
      response.status(502).json({ error: 'Unable to load worksheet tabs.' });
    }
  });

  app.post('/api/transcripts', async (request: Request, response: Response) => {
    const requestLogger = response.locals.logger as Logger;
    const requestId = response.locals.requestId as string;
    const validationError = (message: string, field: string): void => {
      requestLogger.info({ event: 'workflow.validation.failed', field });
      response.status(400).json({ error: message, requestId });
    };
    const videoId = request.body?.videoId;
    const outputMode = request.body?.outputMode ?? 'google-sheet';
    const sheetName = request.body?.sheetName;
    const spreadsheetName = request.body?.spreadsheetName;
    const weekNumberValue = request.body?.weekNumber;

    if (typeof videoId !== 'string' || videoId.trim().length === 0) {
      validationError('A valid Tella video ID is required.', 'videoId');
      return;
    }

    const trimmedVideoId = videoId.trim();
    if (/^https?:\/\//i.test(trimmedVideoId)) {
      validationError('A Tella video ID is required; share URLs are not accepted.', 'videoId');
      return;
    }

    if (outputMode !== 'google-sheet' && outputMode !== 'downloads') {
      validationError('A valid output mode is required.', 'outputMode');
      return;
    }

    let weekNumber: number | undefined;
    if (outputMode === 'google-sheet') {
      if (typeof spreadsheetName !== 'string' || !spreadsheetName.trim()) {
        validationError('A spreadsheet must be selected when using Google Sheets.', 'spreadsheetId');
        return;
      }

      const configuredSpreadsheets = await dependencies.listGoogleSpreadsheets();
      if (!configuredSpreadsheets.some((spreadsheet) => spreadsheet.name === spreadsheetName.trim())) {
        validationError('Select a configured Google spreadsheet.', 'spreadsheetName');
        return;
      }

      if (typeof sheetName !== 'string' || !sheetName.trim()) {
        validationError('A valid sheet name is required when using Google Sheets.', 'sheetName');
        return;
      }

      weekNumber = Number(weekNumberValue);
      if (!Number.isInteger(weekNumber) || weekNumber < 1) {
        validationError('A valid week number is required when using Google Sheets.', 'weekNumber');
        return;
      }
    }

    let currentStage = 'fetch_transcript';
    const runStage = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
      const startedAt = performance.now();
      currentStage = stage;
      requestLogger.info({ event: 'workflow.stage.started', stage });
      try {
        const result = await operation();
        requestLogger.info({
          event: 'workflow.stage.completed',
          stage,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return result;
      } catch (error: unknown) {
        requestLogger.error({
          event: 'workflow.stage.failed',
          stage,
          durationMs: Math.round(performance.now() - startedAt),
          ...getSafeErrorMetadata(error),
        });
        throw error;
      }
    };

    try {
      requestLogger.info({ event: 'workflow.started', outputMode });
      const transcript = await runStage('fetch_transcript', () => dependencies.fetchTranscript(trimmedVideoId, requestLogger));
      const transcriptFileName = await runStage('persist_transcript', () => dependencies.saveTranscriptPayload(trimmedVideoId, transcript, requestLogger));
      const actionPoints = await runStage('generate_action_points', () => dependencies.generateActionPoints(trimmedVideoId, transcript, undefined, requestLogger));
      const rowsAppended = await runStage('write_output', () => dependencies.appendActionPointsToGoogleSheet(
        trimmedVideoId,
        actionPoints.markdownText ?? '',
        {
          outputMode,
          ...(outputMode === 'google-sheet' ? {
            spreadsheetName: (spreadsheetName as string).trim(),
            sheetName: (sheetName as string).trim(),
            weekNumber,
          } : {}),
        },
        requestLogger,
      ));

      requestLogger.info({ event: 'workflow.completed', rowsAppended });
      response.json({
        actionPoints: {
          markdownFileName: actionPoints.markdownFileName,
          jsonFileName: actionPoints.jsonFileName,
        },
        transcriptFileName,
        videoId: trimmedVideoId,
        rowsAppended,
      });
    } catch (error: unknown) {
      requestLogger.error({ event: 'workflow.failed', stage: currentStage, ...getSafeErrorMetadata(error) });
      response.status(502).json({
        error: 'Unable to complete the transcript request.',
        requestId,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(frontendDirectory));
    app.use((request: Request, response: Response, next) => {
      if (request.method === 'GET' && !request.path.startsWith('/api')) {
        response.sendFile(path.join(frontendDirectory, 'index.html'));
        return;
      }
      next();
    });
  }

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const requestLogger = response.locals.logger as Logger | undefined;
    const statusCode = typeof error === 'object' && error !== null && 'status' in error
      && typeof error.status === 'number' && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    requestLogger?.error({ event: 'http.request.failed', ...getSafeErrorMetadata(error), statusCode });
    response.status(statusCode).json({
      error: statusCode === 400 ? 'The request could not be read.' : 'An unexpected server error occurred.',
      requestId: response.locals.requestId,
    });
  };

  app.use(errorHandler);
  return app;
}

const isMainModule = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  createApp().listen(port, () => {
    defaultLogger.info({ event: 'server.started', port });
  });
}