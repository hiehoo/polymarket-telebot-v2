import logger from './logger';

export enum ErrorType {
  VALIDATION = 'VALIDATION',
  API = 'API',
  WEBSOCKET = 'WEBSOCKET',
  DATABASE = 'DATABASE',
  AUTHENTICATION = 'AUTHENTICATION',
  RATE_LIMIT = 'RATE_LIMIT',
  NOTIFICATION = 'NOTIFICATION',
  UNKNOWN = 'UNKNOWN',
}

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode?: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN,
    statusCode: number | undefined = undefined,
    isOperational: boolean = true,
  ) {
    super(message);
    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.VALIDATION, 400);
  }
}

export class ApiError extends AppError {
  constructor(message: string, statusCode = 500) {
    super(message, ErrorType.API, statusCode);
  }
}

export class WebSocketError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.WEBSOCKET);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.DATABASE, 500);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.AUTHENTICATION, 401);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.RATE_LIMIT, 429);
  }
}

export class NotificationError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.NOTIFICATION, 500);
  }
}

export function handleError(error: Error | AppError): void {
  if (error instanceof AppError) {
    logger.error(`${error.type}: ${error.message}`, {
      type: error.type,
      statusCode: error.statusCode,
      stack: error.stack,
    });
  } else {
    logger.error(`Unhandled error: ${error.message}`, {
      type: ErrorType.UNKNOWN,
      stack: error.stack,
    });
  }
}

export function isOperationalError(error: Error): boolean {
  return error instanceof AppError && error.isOperational;
}