import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type SafeErrorMetadata = {
  errorType?: string;
  errorCode?: string | number;
  statusCode?: number;
};

export function getSafeErrorMetadata(error: unknown): SafeErrorMetadata {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return { errorType: 'UnknownError' };
  }

  const fields = error as Record<string, unknown>;
  const metadata: SafeErrorMetadata = {};
  try {
    const name = error instanceof Error ? error.name : undefined;
    if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
      metadata.errorType = name;
    }
  } catch {
    // Ignore untrusted property access and retain only metadata already collected.
  }

  for (const key of ['status', 'statusCode', 'api_error_status']) {
    try {
      const value = fields[key];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
        metadata.statusCode = value;
        break;
      }
    } catch {
      // Ignore untrusted property access and continue with other known fields.
    }
  }

  try {
    const code = fields.code;
    if (typeof code === 'number' && Number.isInteger(code)) {
      metadata.errorCode = code;
    } else if (typeof code === 'string' && /^(?:E[A-Z0-9_]{2,63}|ERR_[A-Z0-9_]{1,60})$/.test(code)) {
      metadata.errorCode = code;
    }
  } catch {
    // Ignore untrusted property access.
  }

  if (!metadata.errorType) {
    metadata.errorType = 'UnknownError';
  }
  return metadata;
}

export function createLogger(destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'client-notes-automation',
      environment: process.env.NODE_ENV ?? 'development',
    },
    redact: {
      paths: [
        'authorization',
        'headers.authorization',
        'req.headers.authorization',
        'token',
        'apiKey',
        'password',
      ],
      censor: '[REDACTED]',
    },
  };
  if (destination) {
    return pino(options, destination);
  }

  if (process.env.NODE_ENV !== 'production') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: Boolean(process.stdout.isTTY),
        singleLine: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageKey: 'event',
      },
    };
  }

  return pino(options);
}

export const logger = createLogger();