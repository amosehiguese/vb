import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../config/logger';
import { HTTP_STATUS, ERROR_CODES, TRADING_CONSTANTS } from '../utils/constants';
import { isValidSolanaAddress, isValidTokenSymbol } from '../utils/helpers';

// Custom Zod refinements
const solanaAddressSchema = z.string().refine(isValidSolanaAddress, {
  message: 'Invalid Solana address format'
});

const tokenSymbolSchema = z.string().optional().refine(
  (symbol) => !symbol || isValidTokenSymbol(symbol),
  { message: 'Invalid token symbol format' }
);

const fundingTierSchema = z.string().min(1, "Funding tier name is required")
  .refine(
    (tier) => {
      const validTiers = Object.keys(TRADING_CONSTANTS.FUNDING_TIERS);
      return validTiers.includes(tier.toUpperCase());
    },
    { message: 'Invalid funding tier name' }
  );

// Request validation schemas
export const validateTokenRequestSchema = z.object({
  contractAddress: solanaAddressSchema
});

export const createSessionRequestSchema = z.object({
  contractAddress: solanaAddressSchema,
  tokenSymbol: tokenSymbolSchema,
  fundingTierName: fundingTierSchema
});

// Generic validation middleware factory
function createValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = schema.parse(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorDetails = error.issues.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));

        logger.warn('Input validation failed', {
          path: req.path,
          method: req.method,
          errors: errorDetails,
          body: req.body
        });

        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Invalid input parameters',
          code: ERROR_CODES.INVALID_CONTRACT_ADDRESS,
          details: errorDetails
        });
      }

      logger.error('Validation middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        path: req.path,
        method: req.method
      });

      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Validation error occurred'
      });
    }
  };
}

// Specific validation middlewares
export const validateTokenInput = createValidationMiddleware(validateTokenRequestSchema);
export const validateSessionInput = createValidationMiddleware(createSessionRequestSchema);

// Request sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Sanitize string inputs
    const sanitizeString = (str: string): string => {
      return str.trim().replace(/[<>]/g, '');
    };

    // Recursively sanitize object
    const sanitizeObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return sanitizeString(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      }
      if (obj !== null && typeof obj === 'object') {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitizeObject(value);
        }
        return sanitized;
      }
      return obj;
    };

    req.body = sanitizeObject(req.body);
    next();
  } catch (error) {
    logger.error('Input sanitization error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path
    });
    
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Request processing error'
    });
  }
};

// Rate limiting validation (basic implementation)
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

export const validateRateLimit = (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    
    const clientData = requestCounts.get(clientId);
    
    if (!clientData || now > clientData.resetTime) {
      requestCounts.set(clientId, {
        count: 1,
        resetTime: now + RATE_LIMIT_WINDOW
      });
      return next();
    }
    
    if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
      logger.warn('Rate limit exceeded', {
        clientId,
        count: clientData.count,
        path: req.path
      });
      
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        error: 'Rate limit exceeded',
        code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
      });
    }
    
    clientData.count++;
    next();
  } catch (error) {
    logger.error('Rate limit validation error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    next(); // Don't block requests on rate limit errors
  }
};

// Content type validation
export const validateContentType = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const contentType = req.get('Content-Type');
    
    if (!contentType || !contentType.includes('application/json')) {
      logger.warn('Invalid content type', {
        contentType,
        path: req.path,
        method: req.method
      });
      
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'Content-Type must be application/json'
      });
    }
  }
  
  next();
};

// Request size validation
export const validateRequestSize = (req: Request, res: Response, next: NextFunction) => {
  const maxSize = 1024 * 1024; // 1MB
  const contentLength = parseInt(req.get('Content-Length') || '0', 10);
  
  if (contentLength > maxSize) {
    logger.warn('Request too large', {
      contentLength,
      maxSize,
      path: req.path
    });
    
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: 'Request payload too large'
    });
  }
  
  next();
};

// Combined validation middleware
export const validateRequest = [
  validateContentType,
  validateRequestSize,
  sanitizeInput,
  validateRateLimit
];

// Error response helper
export function createValidationErrorResponse(
  message: string, 
  code?: string, 
  details?: any[]
) {
  return {
    success: false,
    error: message,
    code: code || ERROR_CODES.INVALID_CONTRACT_ADDRESS,
    details: details || [],
    timestamp: new Date().toISOString()
  };
}