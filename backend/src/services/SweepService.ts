import { Keypair } from '@solana/web3.js';
import { db } from '../config/database';
import { ephemeralWallets, userSessions } from '../db/schema';
import { eq, and, lt, ne } from 'drizzle-orm';
import { logger } from '../config/logger';
import { WalletManagementService } from './WalletManagementService';
import { eventService } from './EventService';
import { SessionEventType } from '../types/events';
import { delay } from '../utils/helpers';

export class SweepService {
  private walletManagementService: WalletManagementService;
  private maxRetries = 3;
  private retryDelays = [10000, 30000, 60000]; // 10s, 30s, 60s

  constructor() {
    this.walletManagementService = new WalletManagementService();
  }

  async sweepWithRetry(
    ephemeralKeypair: Keypair,
    vaultAddress: string,
    tokenMintAddress: string,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    const ephemeralAddress = ephemeralKeypair.publicKey.toString();

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await eventService.emitSessionEvent({
          sessionId,
          eventType: SessionEventType.SWEEP_STARTED,
          eventData: {
            fromAddress: ephemeralAddress,
            toAddress: vaultAddress,
            attempt: attempt + 1,
            maxRetries: this.maxRetries
          }
        });

        // Perform the sweep
        await this.walletManagementService.sweepAssets(
          ephemeralKeypair,
          vaultAddress,
          tokenMintAddress
        );

        // Validate sweep success
        const validationResult = await this.validateSweep(
          ephemeralAddress,
          vaultAddress,
          sessionId
        );

        if (validationResult.success) {
          await eventService.emitSessionEvent({
            sessionId,
            eventType: SessionEventType.SWEEP_COMPLETED,
            eventData: {
              fromAddress: ephemeralAddress,
              toAddress: vaultAddress,
              solAmount: validationResult.solSwept,
              tokenAmount: validationResult.tokenSwept,
              attempt: attempt + 1
            }
          });

          // Mark as swept in database
          await db.update(ephemeralWallets)
            .set({ 
              status: 'swept',
              sweepAttempts: attempt + 1,
              lastSweepAttempt: new Date()
            })
            .where(eq(ephemeralWallets.walletAddress, ephemeralAddress));

          logger.info('Sweep completed successfully', {
            sessionId,
            ephemeralAddress,
            attempt: attempt + 1
          });

          return { success: true };
        } else {
          throw new Error(validationResult.error || 'Sweep validation failed');
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        logger.warn('Sweep attempt failed', {
          sessionId,
          ephemeralAddress,
          attempt: attempt + 1,
          error: errorMessage
        });

        // Update attempt count
        await db.update(ephemeralWallets)
          .set({
            sweepAttempts: attempt + 1,
            lastSweepAttempt: new Date(),
            sweepError: errorMessage
          })
          .where(eq(ephemeralWallets.walletAddress, ephemeralAddress));

        // If not last attempt, wait and retry
        if (attempt < this.maxRetries - 1) {
          const delayMs = this.retryDelays[attempt];
          logger.info('Retrying sweep after delay', {
            sessionId,
            delayMs,
            nextAttempt: attempt + 2
          });
          await delay(delayMs);
        } else {
          // Final attempt failed
          await eventService.emitSessionEvent({
            sessionId,
            eventType: SessionEventType.SWEEP_FAILED,
            status: 'failed',
            eventData: {
              fromAddress: ephemeralAddress,
              toAddress: vaultAddress,
              attempts: this.maxRetries
            },
            errorMessage: errorMessage
          });

          return { success: false, error: errorMessage };
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  private async validateSweep(
    ephemeralAddress: string,
    vaultAddress: string,
    sessionId: string
  ): Promise<{ 
    success: boolean; 
    error?: string; 
    solSwept?: number; 
    tokenSwept?: number;
  }> {
    try {
      // Wait a bit for blockchain settlement
      await delay(3000);

      // Check ephemeral wallet balance (should be near zero)
      const ephemeralBalance = await this.walletManagementService.getWalletBalance(ephemeralAddress);

      // Small amount (< 0.001 SOL) is acceptable due to rent and fees
      if (ephemeralBalance > 0.001) {
        return {
          success: false,
          error: `Ephemeral wallet still has ${ephemeralBalance} SOL`
        };
      }

      logger.debug('Sweep validation passed', {
        sessionId,
        ephemeralAddress,
        remainingBalance: ephemeralBalance
      });

      return {
        success: true,
        solSwept: ephemeralBalance
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      };
    }
  }

  async monitorStrandedWallets(): Promise<void> {
    try {
      logger.debug('Running stranded wallet monitoring check');

      // Find ephemeral wallets that are not swept and older than 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const strandedWallets = await db.select()
        .from(ephemeralWallets)
        .where(
          and(
            ne(ephemeralWallets.status, 'swept'),
            lt(ephemeralWallets.createdAt, fiveMinutesAgo)
          )
        );

      if (strandedWallets.length === 0) {
        return;
      }

      logger.warn(`Found ${strandedWallets.length} potentially stranded ephemeral wallets`);

      for (const wallet of strandedWallets) {
        try {
          // Get session info
          const [session] = await db.select()
            .from(userSessions)
            .where(eq(userSessions.sessionId, wallet.sessionId))
            .limit(1);

          if (!session) {
            logger.error('Cannot recover: session not found', {
              walletAddress: wallet.walletAddress,
              sessionId: wallet.sessionId
            });
            continue;
          }

          // Check if wallet actually has funds
          const balance = await this.walletManagementService.getWalletBalance(wallet.walletAddress);
          
          if (balance < 0.001) {
            // Wallet is essentially empty, just mark as swept
            await db.update(ephemeralWallets)
              .set({ status: 'swept' })
              .where(eq(ephemeralWallets.id, wallet.id));
            continue;
          }

          logger.info('Attempting recovery of stranded wallet', {
            walletAddress: wallet.walletAddress,
            sessionId: wallet.sessionId,
            balance
          });

          // Decrypt and recover
          const ephemeralKeypair = Keypair.fromSecretKey(
            this.walletManagementService.decryptPrivateKey(wallet.privateKey)
          );

          await this.sweepWithRetry(
            ephemeralKeypair,
            session.walletAddress,
            session.contractAddress,
            session.sessionId
          );

          // Small delay between recoveries to avoid rate limits
          await delay(2000);

        } catch (error) {
          logger.error('Failed to recover stranded wallet', {
            walletId: wallet.id,
            walletAddress: wallet.walletAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

    } catch (error) {
      logger.error('Stranded wallet monitoring failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const sweepService = new SweepService();