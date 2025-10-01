import express from 'express';
import { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { apiRoutes } from './routes/api';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './config/logger';
import { env, isDevelopment, isProduction } from './config/environment';
import { databaseManager } from './config/database';
import { Server as HTTPServer, createServer } from 'http';
import { setupWebSocket } from './config/websocket';

export const createApp = () => {
  const app = express();

  // Trust proxy for accurate client IPs (important for rate limiting)
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: isDevelopment ? false : undefined
  }));

  // Compression middleware
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProduction ? 100 : 1000, // Limit each IP to 100 requests per windowMs in production
    message: {
      success: false,
      error: 'Too many requests from this IP, please try again later',
      retryAfter: 15 * 60 // 15 minutes in seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health' || req.path === '/api/health';
    }
  });

  app.use(limiter);

  // CORS configuration
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://localhost:3000'
      ];

      if (isDevelopment) {
        // Allow all origins in development
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn('CORS origin blocked', { origin, allowedOrigins });
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With',
      'Accept',
      'Origin'
    ],
    credentials: true,
    optionsSuccessStatus: 200 // For legacy browser support
  }));

  // Body parsing middleware
  app.use(express.json({ 
    limit: '10mb',
    strict: true,
    type: 'application/json'
  }));

  app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb',
    parameterLimit: 1000
  }));

  // Request logging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      contentLength: req.get('Content-Length'),
      origin: req.get('Origin')
    });

    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      logger.info('HTTP Response', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('Content-Length')
      });
    });

    next();
  });

  // Health check endpoint (before API routes)
  app.get('/health', async (req, res) => {
    try {
      // Test database connection
      const dbHealthy = await databaseManager.testConnection();
      
      const health = {
        status: 'ok',
        service: 'wubbavolumebot-backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: env.NODE_ENV,
        database: dbHealthy ? 'connected' : 'disconnected',
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024)
        }
      };

      if (!dbHealthy) {
        res.status(503).json({
          ...health,
          status: 'degraded',
          message: 'Database connection issue'
        });
        return;
      }

      res.json(health);

    } catch (error) {
      logger.error('Health check failed', { error });
      res.status(503).json({
        status: 'error',
        service: 'wubbavolumebot-backend',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  });

  // API routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      success: true,
      service: 'WubbaVolumeBot Backend API',
      version: '1.0.0',
      environment: env.NODE_ENV,
      documentation: '/api/docs',
      health: '/health',
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler for undefined routes
  app.use((req, res) => {
    logger.warn('Route not found', { 
      method: req.method, 
      path: req.originalUrl,
      ip: req.ip
    });
    
    res.status(404).json({
      success: false,
      error: 'Route not found',
      path: req.originalUrl,
      method: req.method,
      availableRoutes: [
        'GET /',
        'GET /health',
        'GET /api/docs',
        'POST /api/validate-token',
        'POST /api/create-session',
        'GET /api/session/:sessionId'
      ]
    });
  });

  // Error handling middleware (must be last)
  app.use(errorHandler);

  return app;
};

export const createServerWithWebSocket = (app: Express): HTTPServer  => {
  const httpServer = createServer(app);
  setupWebSocket(httpServer);
  return httpServer;
}

// Graceful shutdown handler
export const setupGracefulShutdown = (server: any) => {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);

    // Stop accepting new connections
    server.close(async (err: any) => {
      if (err) {
        logger.error('Error during server shutdown', { error: err.message });
        process.exit(1);
      }

      try {
        // Close database connections
        await databaseManager.close();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        process.exit(1);
      }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions and rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { 
      reason: reason instanceof Error ? reason.message : reason,
      promise: promise.toString()
    });
    process.exit(1);
  });
};