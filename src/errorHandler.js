import { logger } from './logger.js';

export class AppError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const ErrorCodes = {
  SPOTIFY_AUTH_FAILED: 'SPOTIFY_AUTH_FAILED',
  TTS_FAILED: 'TTS_FAILED',
  CLAUDE_API_ERROR: 'CLAUDE_API_ERROR',
  DB_ERROR: 'DB_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
};

export function errorHandler(err, context = {}) {
  logger.error(err.message, {
    code: err.code,
    stack: err.stack,
    ...context,
  });

  if (err instanceof AppError) {
    return {
      error: err.code,
      message: err.message,
      statusCode: err.statusCode,
    };
  }

  return {
    error: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    statusCode: 500,
  };
}