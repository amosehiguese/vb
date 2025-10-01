import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { ephemeralWallets, userSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import { WalletManagementService } from '../services/WalletManagementService';
import { sweepService } from '../services/SweepService';
import { logger } from '../config/logger';
import { createError } from '../utils/errors';
import { HTTP_STATUS } from '../utils/constants';

export class RecoveryController {
  private walletManagementService: WalletManagementService;

  constructor() {
    this.walletManagementService = new WalletManagementService();
  }

  // GET /api/recovery/:sessionId - Check recovery status
  getRecoveryStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      // Get session
      const [session] = await db.select()
        .from(userSessions)
        .where(eq(userSessions.sessionId, sessionId))
        .limit(1);

      if (!session) {
        return next(createError.notFound('Session not found'));
      }

      // Get all ephemeral wallets for this session
      const ephemeralWalletsList = await db.select()
        .from(ephemeralWallets)
        .where(eq(ephemeralWallets.sessionId, sessionId));

      // Check balances
      const walletsWithBalances = await Promise.all(
        ephemeralWalletsList.map(async (wallet) => {
          try {
            const balance = await this.walletManagementService.getWalletBalance(wallet.walletAddress);
            return {
              address: wallet.walletAddress,
              status: wallet.status,
              balance,
              sweepAttempts: wallet.sweepAttempts || 0,
              lastSweepAttempt: wallet.lastSweepAttempt,
              sweepError: wallet.sweepError,
              needsRecovery: balance > 0.001 && wallet.status !== 'swept'
            };
          } catch (error) {
            return {
              address: wallet.walletAddress,
              status: wallet.status,
              balance: 0,
              sweepAttempts: wallet.sweepAttempts || 0,
              error: 'Failed to check balance'
            };
          }
        })
      );

      const needsRecovery = walletsWithBalances.filter(w => w.needsRecovery);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        sessionId,
        vaultAddress: session.walletAddress,
        ephemeralWallets: walletsWithBalances,
        summary: {
          total: ephemeralWalletsList.length,
          swept: ephemeralWalletsList.filter(w => w.status === 'swept').length,
          needsRecovery: needsRecovery.length,
          totalStrandedBalance: needsRecovery.reduce((sum, w) => sum + (w.balance || 0), 0)
        }
      });

    } catch (error) {
      logger.error('Recovery status check failed', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      next(error);
    }
  };

  // POST /api/recovery/:sessionId/sweep - Manually trigger sweep
  triggerManualSweep = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      // Get session
      const [session] = await db.select()
        .from(userSessions)
        .where(eq(userSessions.sessionId, sessionId))
        .limit(1);

      if (!session) {
        return next(createError.notFound('Session not found'));
      }

      // Get all unswept ephemeral wallets
      const unsweptWallets = await db.select()
        .from(ephemeralWallets)
        .where(eq(ephemeralWallets.sessionId, sessionId));

      const walletsToSweep = unsweptWallets.filter(w => w.status !== 'swept');

      if (walletsToSweep.length === 0) {
        res.status(HTTP_STATUS.OK).json({
          success: true,
          message: 'No wallets need sweeping',
          sessionId
        });
        return;
      }

      logger.info('Manual sweep triggered', {
        sessionId,
        walletsCount: walletsToSweep.length
      });

      const results = [];

      for (const wallet of walletsToSweep) {
        try {
          const balance = await this.walletManagementService.getWalletBalance(wallet.walletAddress);

          if (balance < 0.001) {
            // Essentially empty, just mark as swept
            await db.update(ephemeralWallets)
              .set({ status: 'swept' })
              .where(eq(ephemeralWallets.id, wallet.id));

            results.push({
              address: wallet.walletAddress,
              success: true,
              message: 'Wallet empty, marked as swept'
            });
            continue;
          }

          // Decrypt and sweep
          const ephemeralKeypair = Keypair.fromSecretKey(
            this.walletManagementService.decryptPrivateKey(wallet.privateKey)
          );

          const sweepResult = await sweepService.sweepWithRetry(
            ephemeralKeypair,
            session.walletAddress,
            session.contractAddress,
            sessionId
          );

          results.push({
            address: wallet.walletAddress,
            success: sweepResult.success,
            message: sweepResult.success ? 'Swept successfully' : sweepResult.error
          });

        } catch (error) {
          results.push({
            address: wallet.walletAddress,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      res.status(HTTP_STATUS.OK).json({
        success: successCount > 0,
        sessionId,
        summary: {
          total: results.length,
          succeeded: successCount,
          failed: failCount
        },
        results
      });

    } catch (error) {
      logger.error('Manual sweep failed', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      next(error);
    }
  };
}