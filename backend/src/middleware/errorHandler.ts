import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { HTTP_STATUS, ERROR_CODES } from '../utils/constants';
import { isProduction } from '../config/environment';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
  details?: any;
}

export class CustomError extends Error implements AppError {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;
  public details?: any;

  constructor(
    message: string,
    statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: string = ERROR_CODES.INTERNAL_SERVER_ERROR,
    isOperational: boolean = true,
    details?: any
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
export class ValidationError extends CustomError {
  constructor(message: string, details?: any) {
    super(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_CONTRACT_ADDRESS, true, details);
  }
}

export class NotFoundError extends CustomError {
  constructor(resource: string) {
    super(`${resource} not found`, HTTP_STATUS.NOT_FOUND, ERROR_CODES.TOKEN_NOT_FOUND, true);
  }
}

export class DatabaseError extends CustomError {
  constructor(message: string, details?: any) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.DATABASE_ERROR, true, details);
  }
}

export class NetworkError extends CustomError {
  constructor(message: string, details?: any) {
    super(message, HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.NETWORK_ERROR, true, details);
  }
}

export class TradingError extends CustomError {
  constructor(message: string, details?: any) {
    super(message, HTTP_STATUS.UNPROCESSABLE_ENTITY, ERROR_CODES.TRADE_EXECUTION_FAILED, true, details);
  }
}

export class RateLimitError extends CustomError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMIT_EXCEEDED, true);
  }
}

// Error handling middleware
export const errorHandler = (
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let { statusCode, code, message, details } = error;

  // Default values for unknown errors
  if (!statusCode) {
    statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }
  
  if (!code) {
    code = ERROR_CODES.INTERNAL_SERVER_ERROR;
  }

  // Log error details
  const errorLog = {
    message: error.message,
    stack: error.stack,
    statusCode,
    code,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    query: req.query,
    params: req.params,
    details,
    timestamp: new Date().toISOString()
  };

  // Log based on severity
  if (statusCode >= 500) {
    logger.error('Server error occurred', errorLog);
  } else if (statusCode >= 400) {
    logger.warn('Client error occurred', errorLog);
  } else {
    logger.info('Request completed with error', errorLog);
  }

  // Prepare response
  const errorResponse: any = {
    success: false,
    error: message,
    code,
    timestamp: new Date().toISOString()
  };

  // Add stack trace in development
  if (!isProduction && error.stack) {
    errorResponse.stack = error.stack;
  }

  // Add details if available and not sensitive
  if (details && !isProduction) {
    errorResponse.details = details;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};

// Uncaught exception handlers
export const setupGlobalErrorHandlers = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack
    });
    
    // Graceful shutdown
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString()
    });
    
    // Graceful shutdown
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
};

// Error factory functions
export const createError = {
  validation: (message: string, details?: any) => new ValidationError(message, details),
  notFound: (resource: string) => new NotFoundError(resource),
  database: (message: string, details?: any) => new DatabaseError(message, details),
  network: (message: string, details?: any) => new NetworkError(message, details),
  trading: (message: string, details?: any) => new TradingError(message, details),
  rateLimit: () => new RateLimitError(),
  internal: (message: string, details?: any) => new CustomError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR, false, details)
};

// Error response helpers
export const sendErrorResponse = (
  res: Response,
  error: AppError,
  statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR
) => {
  res.status(statusCode).json({
    success: false,
    error: error.message,
    code: error.code || ERROR_CODES.INTERNAL_SERVER_ERROR,
    timestamp: new Date().toISOString()
  });
};

export const sendSuccessResponse = (
  res: Response,
  data: any,
  statusCode: number = HTTP_STATUS.OK
) => {
  res.status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString()
  });
};