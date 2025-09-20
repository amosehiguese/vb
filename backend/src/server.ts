import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { createApp, setupGracefulShutdown } from './app';
import { logger } from './config/logger';
import { env, isDevelopment } from './config/environment';
import { databaseManager } from './config/database';
import { WalletManagementService } from './services/WalletManagementService';
import { db } from './config/database';
import { ephemeralWallets, userSessions } from './db/schema';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';

async function recoverStrandedFunds() {
  logger.info('Starting recovery process for stranded funds...');
  try {
      const walletService = new WalletManagementService();

      // Find all ephemeral wallets that are not marked as 'swept'
      const strandedWallets = await db.select()
          .from(ephemeralWallets)
          .where(eq(ephemeralWallets.status, 'funded'));

      if (strandedWallets.length === 0) {
          logger.info('No stranded funds found. Recovery process complete.');
          return;
      }

      logger.warn(`Found ${strandedWallets.length} ephemeral wallet(s) with potentially stranded funds. Attempting recovery...`);

      for (const wallet of strandedWallets) {
          try {
              const ephemeralKeypair = Keypair.fromSecretKey(walletService.decryptPrivateKey(wallet.privateKey));
              
              // We need the vault address to sweep funds back to.
              const [session] = await db.select()
              .from(userSessions)
              .where(eq(userSessions.sessionId, wallet.sessionId))
              .limit(1);

              if (session) {
                  logger.info(`Sweeping funds from stranded wallet ${wallet.walletAddress} back to vault ${session.walletAddress}`);
                  await walletService.sweepAssets(ephemeralKeypair, session.walletAddress, session.contractAddress);
              } else {
                   logger.error(`Could not find parent session for stranded wallet. Manual recovery may be needed.`, { sessionId: wallet.sessionId, ephemeralAddress: wallet.walletAddress });
              }
          } catch (recoveryError) {
              logger.error('Failed to recover funds from a specific stranded wallet', {
                  ephemeralWalletId: wallet.id,
                  error: recoveryError
              });
          }
      }
      logger.info('Completed stranded funds recovery process.');
  } catch (error) {
      logger.error('Critical error during the stranded funds recovery process', { error });
  }
}

async function startServer() {
  try {
    // Test database connection on startup
    const dbConnected = await databaseManager.testConnection();
    
    if (!dbConnected) {
      logger.error('Failed to connect to database on startup');
      process.exit(1);
    }

    // Run the fund recovery process on startup
    await recoverStrandedFunds();

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