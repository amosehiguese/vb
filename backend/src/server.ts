import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { createApp, setupGracefulShutdown } from './app';
import { logger } from './config/logger';
import { env, isDevelopment } from './config/environment';
import { databaseManager } from './config/database';


async function startServer() {
  try {
    // Test database connection on startup
    const dbConnected = await databaseManager.testConnection();
    
    if (!dbConnected) {
      logger.error('Failed to connect to database on startup');
      process.exit(1);
    }


    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(env.PORT, () => {
      logger.info('WubbaVolumeBot backend server started', {
        port: env.PORT,
        environment: env.NODE_ENV,
        nodeVersion: process.version,
        pid: process.pid,
        timestamp: new Date().toISOString()
      });

      if (isDevelopment) {
        logger.info('Development mode enabled', {
          frontendUrl: env.FRONTEND_URL || 'http://localhost:3000',
          logLevel: env.LOG_LEVEL,
          minWalletDeposit: env.MIN_WALLET_DEPOSIT,
          minPrivilegedDeposit: env.MIN_PRIVILEGED_WALLET_DEPOSIT
        });
      }
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${env.PORT} is already in use`);
      } else {
        logger.error('Server error', { error: error.message });
      }
      process.exit(1);
    });

    // Set up graceful shutdown
    setupGracefulShutdown(server);

    // Log successful startup
    logger.info('Server initialization completed successfully');

  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  logger.error('Critical startup error', { 
    error: error instanceof Error ? error.message : 'Unknown error' 
  });
  process.exit(1);
});