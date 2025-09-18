import { logger } from '../config/logger';
import { db } from '../config/database';
import { userSessions, transactions, tokens, sessionWallets } from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import axios, { AxiosInstance } from 'axios';
import {
  SessionStatus,
  SessionMetrics,
  AutoTradingState
} from '../types/session';
import {
  TradeResult,
  TradeType,
  DexType,
} from '../types/trading';
import {
  calculateDepletionPercentage,
  delay,
  getRandomNumber,
} from '../utils/helpers';
import {
  DEX_CONFIG,
  API_CONFIG,
  TRADING_CONSTANTS,
  STRATEGY_CONSTANTS,
} from '../utils/constants';
import { WalletManagementService } from './WalletManagementService';
import { TradingService } from './TradingService';
import { Keypair } from "@solana/web3.js";

export class AutoTradingService {
  private walletManagementService: WalletManagementService;
  private tradingService: TradingService;
  private jupiterApi: AxiosInstance;
  private activeSessions: Map<string, { stop: boolean, wallets: Keypair[] }> = new Map();

  constructor() {
    this.walletManagementService = new WalletManagementService();
    this.tradingService = new TradingService();
    this.jupiterApi = axios.create({
      baseURL: DEX_CONFIG.JUPITER.api_url,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  async startAutoTrading(sessionId: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
        logger.warn('Auto-trading already active for session', { sessionId });
        return;
    }
    
    logger.info('Starting auto-trading session with organic strategy', { sessionId });
    
    const wallets = await this.walletManagementService.getWalletsForSession(sessionId);
    if (wallets.length < 2) {
        logger.error('Cannot start trading session, requires at least 2 wallets in the pool.', { sessionId });
        await this.updateSessionStatus(sessionId, SessionStatus.STOPPED);
        return;
    }

    this.activeSessions.set(sessionId, { stop: false, wallets });
    await this.updateSessionStatus(sessionId, SessionStatus.TRADING);

    this.tradingLoop(sessionId);
  }

  private async tradingLoop(sessionId: string) {
    const sessionState = this.activeSessions.get(sessionId);
    if (!sessionState) return;

    let consecutiveFailures = 0;

    while (!sessionState.stop) {
        try {
            const tradeSuccessful = await this.executeOrganicTradeCycle(sessionId, sessionState.wallets);
            
            if(tradeSuccessful) {
                consecutiveFailures = 0;
            } else {
                consecutiveFailures++;
            }

            if (consecutiveFailures >= TRADING_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
                logger.warn('Pausing session due to max consecutive failures', { sessionId });
                await this.stopAutoTrading(sessionId, 'Max consecutive failures reached');
            }

        } catch (error) {
            logger.error('Critical failure in organic trading loop', { sessionId, error });
            consecutiveFailures++;
        }
        
        const randomDelay = getRandomNumber(STRATEGY_CONSTANTS.MIN_TRADE_DELAY_MS, STRATEGY_CONSTANTS.MAX_TRADE_DELAY_MS);
        await delay(randomDelay);
    }
  }

  private async executeOrganicTradeCycle(sessionId: string, wallets: Keypair[]): Promise<boolean> {
    const sessions = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));

    if (sessions.length == 0) {
      return false;
    }

    const session = sessions[0];
    if (!session) { 
        await this.stopAutoTrading(sessionId, 'Session not found'); 
        return false; 
    }

    // Randomly decide whether to perform a BUY or SELL trade in this cycle.
    // A higher chance of buying helps create upward price pressure.
    const tradeType = Math.random() < 0.7 ? TradeType.BUY : TradeType.SELL; // 70% chance of BUY, 30% chance of SELL

    const tokenInfos = (await db.select().from(tokens).where(eq(tokens.contractAddress, session.contractAddress)));
    const tokenInfo = tokenInfos[0];
    const decimals = tokenInfo?.decimals || 9;

    // --- SELL LOGIC ---
    if (tradeType === TradeType.SELL) {
        const sellerWallet = wallets[Math.floor(Math.random() * wallets.length)];
        
        try {
            const sellerTokenBalance = await this.walletManagementService.getTokenBalance(sellerWallet.publicKey.toString(), session.contractAddress, true);
            
            if (sellerTokenBalance < 1) { // Not enough tokens to make a meaningful trade
                logger.warn('Seller wallet has insufficient tokens for a trade, skipping SELL cycle.', { sessionId, seller: sellerWallet.publicKey.toString() });
                return true; // Not a failure, just an empty wallet for now.
            }
            
            const tradePercentage = getRandomNumber(STRATEGY_CONSTANTS.MIN_TRADE_PERCENTAGE, STRATEGY_CONSTANTS.MAX_TRADE_PERCENTAGE) / 100;
            const amountToTradeRaw = Math.floor(sellerTokenBalance * tradePercentage);
            const amountToTradeUI = amountToTradeRaw / Math.pow(10, decimals);

            const sellResult = await this.tradingService.executeTrade({
                sessionId,
                tokenAddress: session.contractAddress,
                walletKeypair: sellerWallet,
                type: TradeType.SELL,
                amount: amountToTradeUI,
                slippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
                dex: DexType.JUPITER,
            });

            await this.handleTradeResult(sessionId, sellResult, sellerWallet.publicKey.toString(), TradeType.SELL);
            
            if (sellResult.success) {
                await this.incrementSessionVolume(sessionId, sellResult.amountOut); // For a SELL, volume is the SOL received
                logger.info('Organic trade executed', { sessionId, type: 'SELL', wallet: sellerWallet.publicKey.toString(), amount: amountToTradeUI });
            } else {
                logger.warn('Organic SELL trade failed', { sessionId, error: sellResult.error });
            }
            return sellResult.success;

        } catch (error) {
            logger.error('Error in organic SELL cycle', { sessionId, seller: sellerWallet.publicKey.toString(), error });
            return false;
        }
    } 
    // --- BUY LOGIC ---
    else {
      const buyerWallet = wallets[Math.floor(Math.random() * wallets.length)];

      try {
          // Check the type of wallet (retail or whale) to determine buy amount
          const buyerWalletRecords = await db.select().from(sessionWallets).where(eq(sessionWallets.walletAddress, buyerWallet.publicKey.toString()));

          if (buyerWalletRecords.length == 0) {
              logger.error("Could not find buyer wallet record in DB", { wallet: buyerWallet.publicKey.toString() });
              return false;
          }
          const buyerWalletRecord = buyerWalletRecords[0];

          const isWhale = buyerWalletRecord.walletType === 'whale';
          
          // Get SOL price to calculate USD equivalent
          const solPrice = await this.tradingService.getTokenPrice('So11111111111111111111111111111111111111112');
          if (solPrice === 0) {
              logger.error("Could not fetch SOL price for buy calculation.", { sessionId });
              return false;
          }

          // Determine USD buy amount based on wallet type
          const usdAmountToBuy = isWhale 
              ? getRandomNumber(STRATEGY_CONSTANTS.MIN_WHALE_BUY_USD, STRATEGY_CONSTANTS.MAX_WHALE_BUY_USD)
              : getRandomNumber(STRATEGY_CONSTANTS.MIN_RETAIL_BUY_USD, STRATEGY_CONSTANTS.MAX_RETAIL_BUY_USD);
          
          const solAmountToBuy = usdAmountToBuy / solPrice;

          // Get the main funding wallet's keypair to send SOL for the purchase
          const mainFundingPrivateKey = this.walletManagementService.decryptPrivateKey(session.privateKey);
          const mainFundingKeypair = Keypair.fromSecretKey(mainFundingPrivateKey);
          const mainWalletSolBalance = await this.walletManagementService.getWalletBalance(mainFundingKeypair.publicKey.toString());

          if (mainWalletSolBalance < solAmountToBuy) {
               logger.warn('Main funding wallet has insufficient SOL for this BUY trade, skipping cycle.', { sessionId, balance: mainWalletSolBalance, needed: solAmountToBuy });
               return true;
          }
          
          // Send calculated SOL amount from the main wallet to the buyer bot wallet
          const fundAmount = solAmountToBuy + TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER; 
          await this.walletManagementService.transferFunds(mainFundingKeypair, buyerWallet.publicKey.toString(), fundAmount);

          // Execute the buy trade from the bot wallet
          const buyResult = await this.tradingService.executeTrade({
              sessionId,
              tokenAddress: session.contractAddress,
              walletKeypair: buyerWallet,
              type: TradeType.BUY,
              amount: solAmountToBuy,
              slippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
              dex: DexType.JUPITER,
          });

          await this.handleTradeResult(sessionId, buyResult, buyerWallet.publicKey.toString(), TradeType.BUY);

          if (buyResult.success) {
              await this.incrementSessionVolume(sessionId, buyResult.amountIn);
              logger.info(`Trade executed`, { sessionId, type: 'BUY', walletType: isWhale ? 'whale' : 'retail', wallet: buyerWallet.publicKey.toString(), amount: `${solAmountToBuy.toFixed(6)} SOL ($${usdAmountToBuy.toFixed(4)})` });
          } else {
               logger.warn('BUY trade failed', { sessionId, error: buyResult.error });
          }
           
          return buyResult.success;

      } catch (error) {
          logger.error('Error in BUY cycle', { sessionId, buyer: buyerWallet.publicKey.toString(), error });
          return false;
      }
    }
  }

  async stopAutoTrading(sessionId: string, reason?: string): Promise<void> {
    const sessionState = this.activeSessions.get(sessionId);
    if (sessionState) {
        sessionState.stop = true; // This will stop the while loop
        this.activeSessions.delete(sessionId);
        await this.updateSessionStatus(sessionId, SessionStatus.STOPPED);
        logger.info('Auto-trading stopped', { sessionId, reason });

        const session = await this.getSessionFromDatabase(sessionId);
        if (session && session.walletAddress) {
            await this.walletManagementService.stopWalletMonitoring(session.walletAddress);
        }
    }
  }

  async pauseAutoTrading(sessionId: string, reason: string): Promise<void> {
    // This stops the in-memory loop and updates the persistent state to 'paused'.
    await this.stopAutoTrading(sessionId, `Paused: ${reason}`);
    await this.updateSessionStatus(sessionId, SessionStatus.PAUSED);
    logger.info('Auto-trading paused', { sessionId, reason });
  }

  async resumeAutoTrading(sessionId: string): Promise<void> {
      // Resuming is now equivalent to starting the session again.
      // It will check the DB state and continue where it left off.
      logger.info('Attempting to resume auto-trading', { sessionId });
      await this.startAutoTrading(sessionId);
  }

  private async incrementSessionVolume(sessionId: string, solAmount: number) {
    await db.update(userSessions)
      .set({ 
          totalVolume: sql`${userSessions.totalVolume} + ${solAmount}`,
          tradesCount: sql`${userSessions.tradesCount} + 1`,
          updatedAt: new Date(),
       })
      .where(eq(userSessions.sessionId, sessionId));
}

  async getTradingState(sessionId: string): Promise<AutoTradingState | null> {
    const session = await this.getSessionFromDatabase(sessionId);
    if (!session) {
        return null;
    }

    const inMemoryState = this.activeSessions.get(sessionId);
    const isLoopRunning = inMemoryState ? !inMemoryState.stop : false;

    return {
        sessionId: session.sessionId,
        // The overall status from the database (e.g., 'trading', 'paused')
        status: session.status as SessionStatus,
        // The specific step the bot is on if actively trading
        tradingStatus: session.tradingStatus, 
        // Is the while() loop currently active in memory?
        isLoopActive: isLoopRunning, 
        // Last known trade from the transactions table
        lastTradeAt: (await this.getLastTrade(sessionId))?.createdAt,
    };
  }

  async getSessionMetrics(sessionId: string): Promise<SessionMetrics | null> {
    try {
        const session = await this.getSessionFromDatabase(sessionId);
        if (!session) return null;

        // Get all confirmed transactions for this session to calculate metrics        
        const confirmedTransactions = await db.select()
          .from(transactions)
          .where(and(eq(transactions.sessionId, sessionId), eq(transactions.status, 'confirmed')))
          .orderBy(desc(transactions.createdAt));


        const totalTrades = confirmedTransactions.length;
        if (totalTrades === 0) {
            // Return initial state if no trades have occurred
            return {
                sessionId, 
                totalTrades: 0, 
                successfulTrades: 0, 
                failedTrades: 0,
                totalVolume: 0, 
                totalFees: 0,
                currentBalance: parseFloat(session.currentBalance || '0'),
                initialBalance: parseFloat(session.initialBalance || '0'),
                depletionPercentage: calculateDepletionPercentage(parseFloat(session.initialBalance || '0'), parseFloat(session.currentBalance || '0')),
                averageTradeSize: 0, tradingDuration: 0,
            };
        }

        const totalVolume = confirmedTransactions.reduce((sum, tx) => sum + parseFloat(tx.solAmount || '0'), 0);
        const averageTradeSize = totalVolume / totalTrades;
        const tradingDuration = session.fundedAt ? Date.now() - new Date(session.fundedAt).getTime() : 0;
        const lastTrade = confirmedTransactions[0];

        return {
            sessionId,
            totalTrades,
            successfulTrades: totalTrades, // We are only querying for confirmed ones
            failedTrades: session.tradesCount ? session.tradesCount - totalTrades : 0, // A more accurate way might be to query failed trades separately
            totalVolume,
            totalFees: totalVolume * TRADING_CONSTANTS.JUPITER_FEE_BPS / 10000, // Using constant for fee calculation
            currentBalance: parseFloat(session.currentBalance || '0'),
            initialBalance: parseFloat(session.initialBalance || '0'),
            depletionPercentage: calculateDepletionPercentage(parseFloat(session.initialBalance || '0'), parseFloat(session.currentBalance || '0')),
            averageTradeSize,
            tradingDuration,
            lastTradeAt: lastTrade?.createdAt ?? undefined,
        };

    } catch (error) {
        logger.error('Failed to get session metrics', { sessionId, error });
        return null;
    }
  }

  private async getLastTrade(sessionId: string): Promise<{ createdAt: Date | null}> {
    const [lastTrade] = await db.select({ createdAt: transactions.createdAt })
        .from(transactions)
        .where(eq(transactions.sessionId, sessionId))
        .orderBy(desc(transactions.createdAt))
        .limit(1);
    return lastTrade;
  }


  private async getTokenInfoFromDB(contractAddress: string): Promise<{decimals: number | null}> {
    const [token] = await db.select({ decimals: tokens.decimals }).from(tokens).where(eq(tokens.contractAddress, contractAddress)).limit(1);
    return token;
  }

  async getTokenPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await this.jupiterApi.get(DEX_CONFIG.JUPITER.price_endpoint, {
        params: {
          ids: tokenAddress
        }
      });

      const priceData = response.data[tokenAddress]; 
      return priceData?.usdPrice || 0;

    } catch (error) {
      logger.error('Failed to get token price', {
        tokenAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  private async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const updateData: Partial<typeof userSessions.$inferInsert> = { status, updatedAt: new Date() };
    if (status === SessionStatus.COMPLETED) {
        updateData.completedAt = new Date();
    }
    await db.update(userSessions).set(updateData).where(eq(userSessions.sessionId, sessionId));
  }

  private async handleTradeResult(sessionId: string, tradeResult: TradeResult, tradeWallet: string, type: TradeType) {
    await db.insert(transactions).values({
       sessionId,
       tradeWalletAddress: tradeWallet,
       signature: tradeResult.signature || 'N/A',
       type,
       tokenAmount: (type === TradeType.SELL ? tradeResult.amountIn : tradeResult.amountOut).toString(),
       solAmount: (type === TradeType.SELL ? tradeResult.amountOut : tradeResult.amountIn).toString(),
       status: tradeResult.success ? 'confirmed' : 'failed',
       errorMessage: tradeResult.error,
       createdAt: tradeResult.timestamp,
       confirmedAt: tradeResult.success ? new Date() : undefined,
       dexUsed: 'jupiter',
   });
  }

  private calculateTradeSize(currentBalance: number, isPrivileged: boolean): number {
    // Calculate trade size as percentage of available balance
    const minTradeSize = isPrivileged ? 0.001 : 0.01;
    const maxTradeSize = isPrivileged ? 0.01 : 0.1;
    
    // Use 3-7% of current balance for each trade
    const tradePercentage = 0.03 + (Math.random() * 0.04);
    const calculatedSize = currentBalance * tradePercentage;
    
    // Ensure within bounds
    return Math.max(minTradeSize, Math.min(maxTradeSize, calculatedSize));
  }

  private async completeSession(sessionId: string): Promise<void> {
    try {
      await this.stopAutoTrading(sessionId, 'Target depletion reached');
      await this.updateSessionStatus(sessionId, SessionStatus.COMPLETED);

      logger.info('Trading session completed', { sessionId });

    } catch (error) {
      logger.error('Failed to complete session', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getSessionFromDatabase(sessionId: string): Promise<any> {
    try {
      const sessions = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));
      return sessions.length > 0 ? sessions[0] : null;
    } catch (error) {
      logger.error('Failed to get session from database', { sessionId, error });
      return null;
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up auto-trading service, stopping active sessions...');
    const activeSessionIds = Array.from(this.activeSessions.keys());
    
    for (const sessionId of activeSessionIds) {
        await this.stopAutoTrading(sessionId, 'Service shutdown');
    }
    
    this.activeSessions.clear();
    logger.info('All active trading loops have been signaled to stop.');
  }
}