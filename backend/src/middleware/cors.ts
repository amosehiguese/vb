import { Request, Response, NextFunction } from 'express';
import { CorsOptions } from 'cors';
import { env, isDevelopment } from '../config/environment';
import { logger } from '../config/logger';

// Allowed origins for different environments
const getAllowedOrigins = (): string[] => {
  const origins: string[] = [];
  
  // Add frontend URL from environment
  if (env.FRONTEND_URL) {
    origins.push(env.FRONTEND_URL);
  }
  
  // Development origins
  if (isDevelopment) {
    origins.push(
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173', // Vite default
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5173'
    );
  }
  
  // Production origins would be added here
  origins.push('https://wubbavolumebot.online');
  
  return origins;
};

// CORS configuration
export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      logger.debug('CORS: Origin allowed', { origin });
      return callback(null, true);
    }
    
    // In development, allow any localhost origin
    if (isDevelopment && origin.startsWith('http://localhost')) {
      logger.debug('CORS: Development localhost allowed', { origin });
      return callback(null, true);
    }
    
    logger.warn('CORS: Origin blocked', { origin, allowedOrigins });
    callback(new Error('Not allowed by CORS'));
  },
  
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'X-API-Key',
    'X-Session-ID'
  ],
  
  exposedHeaders: [
    'X-Total-Count',
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Reset',
    'X-Response-Time'
  ],
  
  credentials: true,
  
  maxAge: 86400, // 24 hours
  
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  
  preflightContinue: false
};

// Custom CORS middleware with logging
export const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.get('Origin') || req.get('Referer');
  
  logger.debug('CORS request', {
    method: req.method,
    origin,
    path: req.path,
    userAgent: req.get('User-Agent')
  });
  
  next();
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Remove powered-by header
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (!isDevelopment) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.mainnet-beta.solana.com https://quote-api.jup.ag https://api.coingecko.com https://api.raydium.io",
    "font-src 'self'",
    "object-src 'none'",
    "media-src 'self'",
    "frame-src 'none'"
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);
  
  next();
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]('HTTP Request', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('Content-Length'),
      referer: req.get('Referer')
    });
  });
  
  // Add response time header
  res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
  
  next();
};

// Health check bypass (no CORS restrictions)
export const healthCheckCors = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health' || req.path === '/status') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  }
  next();
};

// Custom origin validator for dynamic environments
export const validateOrigin = (allowedDomains: string[] = []) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('Origin');
    
    if (!origin) {
      return next();
    }
    
    try {
      const url = new URL(origin);
      const domain = url.hostname;
      
      if (allowedDomains.some(allowed => domain.endsWith(allowed))) {
        return next();
      }
      
      if (isDevelopment && (domain === 'localhost' || domain === '127.0.0.1')) {
        return next();
      }
      
      logger.warn('Origin validation failed', { origin, allowedDomains });
      return res.status(403).json({
        success: false,
        error: 'Origin not allowed'
      });
      
    } catch (error) {
      logger.error('Origin validation error', { 
        origin, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid origin format'
      });
    }
  };
};