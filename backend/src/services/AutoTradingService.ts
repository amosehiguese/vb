import { logger } from '../config/logger';
import { db } from '../config/database';
import { userSessions, transactions, tokens } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import axios, { AxiosInstance } from 'axios';
import {
  SessionStatus,
  SessionMetrics,
  AutoTradingState,
  TradingConfiguration,
  FundingTierName
} from '../types/session';
import {
  TradeResult,
  TradeType,
  DexType,
} from '../types/trading';
import {
  calculateDepletionPercentage,
  delay
} from '../utils/helpers';
import {
  DEX_CONFIG,
  API_CONFIG,
  TRADING_CONSTANTS,
} from '../utils/constants';
import { WalletManagementService } from './WalletManagementService';
import { TradingService } from './TradingService';
import { Keypair } from "@solana/web3.js";

export class AutoTradingService {
  private _sessionManagementService: any = null;
  private walletManagementService: WalletManagementService;
  private tradingService: TradingService;
  private jupiterApi: AxiosInstance;
  private activeSessions: Map<string, { stop: boolean }> = new Map();

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

  private get sessionManagementService() {
    if (!this._sessionManagementService) {
      // Import at runtime instead of at module load time
      const { SessionManagementService } = require('./SessionManagementService');
      this._sessionManagementService = new SessionManagementService();
    }
    return this._sessionManagementService;
  }

  // Alternative: Accept SessionManagementService as a parameter when needed
  setSessionManagementService(sessionManagementService: any) {
    this._sessionManagementService = sessionManagementService;
  }

  async startAutoTrading(sessionId: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
        logger.warn('Auto-trading already active for session', { sessionId });
        return;
    }
    
    logger.info('Starting auto-trading session', { sessionId });
    this.activeSessions.set(sessionId, { stop: false });
    await this.updateSessionStatus(sessionId, SessionStatus.TRADING);

    // Start the safe, sequential trading loop.
    this.tradingLoop(sessionId);
  }

  private async tradingLoop(sessionId: string) {
    const sessionState = this.activeSessions.get(sessionId);
    if (!sessionState) return;

    let consecutiveFailures = 0;

    while (!sessionState.stop) {
        try {
            const session = await this.getSessionFromDatabase(sessionId);
            if (session?.status === SessionStatus.PAUSED) {
                await delay(TRADING_CONSTANTS.TRADE_INTERVAL_MS);
                continue;
            }

            const tradeSuccessful = await this.executeTradingCycle(sessionId);
            consecutiveFailures = tradeSuccessful ? 0 : consecutiveFailures + 1;

            if (consecutiveFailures >= TRADING_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
                logger.warn('Pausing session due to max consecutive failures', { sessionId });
                await this.pauseAutoTrading(sessionId, 'Max consecutive failures');
            }
        } catch (error) {
            logger.error('Critical failure in trading loop', { sessionId, error });
            consecutiveFailures++;
        }
        await delay(TRADING_CONSTANTS.TRADE_INTERVAL_MS);
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

  private async updateLastTradeType(sessionId: string, tradeType: TradeType): Promise<void> {
    await db.update(userSessions)
        .set({ lastTradeType: tradeType })
        .where(eq(userSessions.sessionId, sessionId));
  }

  private async executeTradingCycle(sessionId: string): Promise<boolean> {
    let ephemeralKeypair: Keypair | null = null;
    const session = await this.getSessionFromDatabase(sessionId);
    if (!session) { await this.stopAutoTrading(sessionId, 'Session not found'); return false; }

    const vaultWallet = await this.walletManagementService.getWalletByAddress(session.walletAddress);
    if (!vaultWallet || !vaultWallet.keypair) { logger.error('Vault keypair not found', { sessionId }); return false; }

    try {
        // Depletion Check
        const vaultBalance = await this.walletManagementService.getWalletBalance(vaultWallet.address);
        logger.debug('Trading cycle started', {
          sessionId,
          vaultBalance: vaultBalance.toFixed(6),
          sessionStatus: session.status,
          lastTradeType: session.lastTradeType,
          initialBalance: session.initialBalance,
          currentBalance: session.currentBalance
        });

        const initialTradingBalance = parseFloat(session.initialBalance || '0'); 
        if (initialTradingBalance > 0) {
          const currentDepletionPercentage = calculateDepletionPercentage(initialTradingBalance, vaultBalance);
  
          if (currentDepletionPercentage >= TRADING_CONSTANTS.TRADING_BALANCE_DEPLETION_TARGET) {
            logger.info('Target depletion reached - trading balance fully depleted', {
              sessionId,
              initialTradingBalance,
              currentBalance: vaultBalance, 
              depletionPercentage: currentDepletionPercentage.toFixed(2) + '%',
              target: '100%' 
            });
            
            await this.completeSession(sessionId);
            return false;
          }
        }

        // Determine next action based on last trade
        let nextTradeType = await this.determineNextTradeType(sessionId, session);

        if (nextTradeType === TradeType.BUY) {
          // Check if we have enough SOL for minimum buy before creating ephemeral wallet
          const minBuyAmount = 0.001;
          const requiredForBuy = minBuyAmount + TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER + TRADING_CONSTANTS.NETWORK_FEE_BUFFER;
          
          if (vaultBalance < requiredForBuy) {
            logger.warn('Cannot execute BUY: insufficient SOL, forcing SELL instead', {
              sessionId,
              vaultBalance: vaultBalance.toFixed(6),
              required: requiredForBuy.toFixed(6)
            });
            
            // Check if we have tokens to sell
            const vaultTokenBalanceRaw = await this.walletManagementService.getTokenBalance(vaultWallet.address, session.contractAddress, true);
            
            if (vaultTokenBalanceRaw > 0) {
              logger.info('Forcing SELL due to insufficient SOL for BUY', { sessionId });
              nextTradeType = TradeType.SELL;
            } else {
              // No SOL and no tokens - session should complete
              logger.warn('No SOL for buy and no tokens for sell - completing session', { sessionId });
              await this.completeSession(sessionId);
              return false;
            }
          }
        }

        ephemeralKeypair = await this.walletManagementService.createAndStoreEphemeralWallet(sessionId);
        let tradeResult: TradeResult;

        if (nextTradeType === TradeType.BUY) {
          tradeResult = await this.executeBuyCycle(session, vaultWallet, ephemeralKeypair);
        }else { // SELL cycle
            // Get the TOTAL token balance from the vault
            const vaultTokenBalanceRaw = await this.walletManagementService.getTokenBalance(vaultWallet.address, session.contractAddress, true);

            if (vaultTokenBalanceRaw <= 0) {
                logger.warn('Vault has no tokens to sell. Skipping sell cycle and setting state to attempt a buy next.', { sessionId });
                await this.updateLastTradeType(sessionId, TradeType.SELL); // Set to sell so next trade is buy
                return true; // Return true to avoid failure count incrementing
            }
            tradeResult = await this.executeSellCycle(session, vaultWallet, ephemeralKeypair, vaultTokenBalanceRaw);
        }

        // If the trade was successful, update the last trade type for the next cycle
        if (tradeResult.success) {
          await this.updateLastTradeType(sessionId, nextTradeType);
          await this.updateConsecutiveTradeCount(sessionId, nextTradeType);

          const updatedVaultBalance = await this.walletManagementService.getWalletBalance(vaultWallet.address);
          await this._sessionManagementService.updateSessionBalance(sessionId, updatedVaultBalance);
        }
        
        await this.handleTradeResult(sessionId, tradeResult, ephemeralKeypair.publicKey.toString());
        return tradeResult.success;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error('Error in trading cycle, attempting sweep', { 
          sessionId, 
          error: errorMessage,
          stack: errorStack
      });
      return false;
    } finally {
        if (ephemeralKeypair) {
            await this.walletManagementService.sweepAssets(ephemeralKeypair, vaultWallet.address, session.contractAddress);
        }
    }
  }

  private async executeBuyCycle(session: any, vaultWallet: any, ephemeralKeypair: Keypair): Promise<TradeResult> {
    await this.updateTradingStatus(session.sessionId, 'buy_cycle_funding');
    
    const vaultBalance = await this.walletManagementService.getWalletBalance(vaultWallet.address);
    const solPrice = await this.getTokenPrice('So11111111111111111111111111111111111111112');
    if (solPrice === 0) throw new Error('Could not fetch SOL price.');
  
    // Use funding tier from session
    const fundingTier = session.fundingTier || 'standard'; // Default fallback
    let tradeSize = this.calculateBuyTradeSize(vaultBalance, solPrice, session.sessionId, fundingTier);
    
    let totalAmountToSend = tradeSize.solAmount + TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER + TRADING_CONSTANTS.NETWORK_FEE_BUFFER;

    if (vaultBalance < totalAmountToSend) {
      logger.warn('Insufficient vault balance for buy cycle, attempting smaller trade', {
        sessionId: session.sessionId,
        vaultBalance: vaultBalance.toFixed(6),
        required: totalAmountToSend.toFixed(6),
        fundingTier
      });
      
      // Try with minimum possible trade size
      const minimumTradeSize = 0.001; // 0.001 SOL minimum
      const minimumTotalNeeded = minimumTradeSize + TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER + TRADING_CONSTANTS.NETWORK_FEE_BUFFER;
      
      if (vaultBalance < minimumTotalNeeded) {
        throw new Error(`Insufficient vault balance even for minimum trade: ${vaultBalance.toFixed(6)} < ${minimumTotalNeeded.toFixed(6)}`);
      }
      
      // Recalculate with available balance
      const availableForTrade = vaultBalance - TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER - TRADING_CONSTANTS.NETWORK_FEE_BUFFER;
      
      tradeSize = {
        solAmount: Math.max(minimumTradeSize, availableForTrade),
        usdValue: availableForTrade * solPrice,
        percentageUsed: (availableForTrade / vaultBalance) * 100
      };
      
      totalAmountToSend = tradeSize.solAmount + TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER + TRADING_CONSTANTS.NETWORK_FEE_BUFFER;
    }
  
    await this.walletManagementService.transferFunds(
      vaultWallet.keypair, 
      ephemeralKeypair.publicKey.toString(), 
      totalAmountToSend
    );
  
    await this.updateTradingStatus(session.sessionId, 'buy_cycle_executing');
    const tradeResult = await this.tradingService.executeTrade({
      sessionId: session.sessionId, 
      tokenAddress: session.contractAddress,
      walletKeypair: ephemeralKeypair, 
      type: TradeType.BUY,
      amount: tradeSize.solAmount, 
      slippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
      dex: DexType.JUPITER,
    });
  
    logger.info('Tier-based buy cycle executed', {
      sessionId: session.sessionId,
      fundingTier,
      tradeSize: `$${tradeSize.usdValue.toFixed(2)}`,
      solAmount: tradeSize.solAmount.toFixed(6),
      vaultBalanceUsed: `${tradeSize.percentageUsed.toFixed(1)}%`
    });
  
    return tradeResult;
  }

  private calculateBuyTradeSize(vaultBalance: number, solPrice: number, sessionId: string, fundingTier: FundingTierName): {
    solAmount: number;
    usdValue: number;
    percentageUsed: number;
  } {
    const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
    
    // Generate random percentage within tier limits
    const randomPercentage = Math.random() * 
      (tierConfig.buyPercentageMax - tierConfig.buyPercentageMin) + 
      tierConfig.buyPercentageMin;
    
    // Calculate SOL amount based on percentage
    let solAmount = (vaultBalance * randomPercentage) / 100;
    const usdValue = solAmount * solPrice;
    
    // Apply tier-specific USD limits
    const minBuyUSD = 'minBuyUSD' in tierConfig ? tierConfig.minBuyUSD : undefined;
    
    if (minBuyUSD && usdValue < minBuyUSD) {
      solAmount = minBuyUSD / solPrice;
    }
    if (usdValue > tierConfig.maxBuyUSD) {
      solAmount = tierConfig.maxBuyUSD / solPrice;
    }
    
    const finalUsdValue = solAmount * solPrice;
    const actualPercentageUsed = (solAmount / vaultBalance) * 100;
    
    logger.debug('Tier-based buy trade size calculated', {
      sessionId,
      fundingTier,
      vaultBalance: vaultBalance.toFixed(6),
      targetPercentage: randomPercentage.toFixed(1),
      solAmount: solAmount.toFixed(6),
      usdValue: finalUsdValue.toFixed(2),
      actualPercentage: actualPercentageUsed.toFixed(1),
      tierLimits: `${minBuyUSD || 'none'}-${tierConfig.maxBuyUSD} USD`
    });
    
    return {
      solAmount,
      usdValue: finalUsdValue,
      percentageUsed: actualPercentageUsed
    };
  }
  

  private async executeSellCycle(session: any, vaultWallet: any, ephemeralKeypair: Keypair, vaultTokenBalanceRaw: number): Promise<TradeResult> {
    await this.updateTradingStatus(session.sessionId, 'sell_cycle_funding');
    
    const fundingTier = session.fundingTier || 'standard';
    const sellAmount = await this.calculateSellTradeSize(vaultTokenBalanceRaw, session.sessionId, session.contractAddress, fundingTier);
    
    const solForFees = TRADING_CONSTANTS.NETWORK_FEE_BUFFER + TRADING_CONSTANTS.ATA_CREATION_FEE_BUFFER;
    await this.walletManagementService.transferFunds(
      vaultWallet.keypair, 
      ephemeralKeypair.publicKey.toString(), 
      solForFees
    );
  
    await this.walletManagementService.transferToken(
      vaultWallet.keypair, 
      ephemeralKeypair.publicKey.toString(), 
      session.contractAddress, 
      sellAmount.rawAmount
    );
    
    await this.updateTradingStatus(session.sessionId, 'sell_cycle_executing');
    
    const tokenInfo = await this.getTokenInfoFromDB(session.contractAddress); 
    const decimals = tokenInfo?.decimals || 9;
    const tokenAmountToSellUI = sellAmount.rawAmount / Math.pow(10, decimals);
  
    const tradeResult = await this.tradingService.executeTrade({
      sessionId: session.sessionId, 
      tokenAddress: session.contractAddress,
      walletKeypair: ephemeralKeypair, 
      type: TradeType.SELL,
      amount: tokenAmountToSellUI, 
      slippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
      dex: DexType.JUPITER,
    });
  
    logger.info('Tier-based sell cycle executed', {
      sessionId: session.sessionId,
      fundingTier,
      tokenAmount: tokenAmountToSellUI.toFixed(6),
      vaultTokensUsed: `${sellAmount.percentageUsed.toFixed(1)}%`
    });
  
    return tradeResult;
  }

  private async calculateSellTradeSize(vaultTokenBalanceRaw: number, sessionId: string, contractAddress: string, fundingTier: FundingTierName): Promise<{
    rawAmount: number;
    percentageUsed: number;
    estimatedUsdValue: number;
  }> {
    const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
    
    // Generate random percentage within tier limits
    const randomPercentage = Math.random() * 
      (tierConfig.sellPercentageMax - tierConfig.sellPercentageMin) + 
      tierConfig.sellPercentageMin;
    
    const rawAmount = Math.floor((vaultTokenBalanceRaw * randomPercentage) / 100);
    const finalAmount = Math.max(rawAmount, 1);
    const actualPercentageUsed = (finalAmount / vaultTokenBalanceRaw) * 100;
    
    // Get actual token price and calculate USD value
    let estimatedUsdValue = 0;
    try {
      const tokenPrice = await this.getTokenPrice(contractAddress);
      const tokenInfo = await this.getTokenInfoFromDB(contractAddress);
      const decimals = tokenInfo?.decimals || 9;
      const tokenAmountUI = finalAmount / Math.pow(10, decimals);
      estimatedUsdValue = tokenAmountUI * tokenPrice;
    } catch (error) {
      logger.warn('Failed to get token price for sell calculation', { sessionId, contractAddress, error });
      estimatedUsdValue = 0;
    }
    
    logger.debug('Tier-based sell trade size calculated', {
      sessionId,
      fundingTier,
      vaultTokenBalance: vaultTokenBalanceRaw.toString(),
      targetPercentage: randomPercentage.toFixed(1),
      rawAmount: finalAmount.toString(),
      actualPercentage: actualPercentageUsed.toFixed(1),
      estimatedUsdValue: estimatedUsdValue.toFixed(2),
      tierRange: `${tierConfig.sellPercentageMin}-${tierConfig.sellPercentageMax}%`
    });
    
    return {
      rawAmount: finalAmount,
      percentageUsed: actualPercentageUsed,
      estimatedUsdValue
    };
  }

  private async determineNextTradeType(sessionId: string, session: any): Promise<TradeType> {
    try {
      // Get recent trade history for this session
      const recentTrades = await this.getRecentTradeHistory(sessionId, 10);
      const consecutiveCount = this.getConsecutiveTradeCount(recentTrades);
      const lastTradeType = session.lastTradeType;
      
      // Base probability
      let buyProbability = TRADING_CONSTANTS.BUY_BIAS_PERCENTAGE / 100;
      
      if (!lastTradeType && recentTrades.length === 0) {
        // For brand new sessions, use base probability only
        logger.debug('New session detected - using base probability only', {
          sessionId,
          buyProbability: (buyProbability * 100).toFixed(1) + '%'
        });
      }
      else {
        // Adjust based on consecutive trades to avoid long streaks
        if (consecutiveCount.type === TradeType.BUY && consecutiveCount.count >= TRADING_CONSTANTS.MAX_SAME_TYPE_STREAK) {
          buyProbability = 0.2; 
        } else if (consecutiveCount.type === TradeType.SELL && consecutiveCount.count >= TRADING_CONSTANTS.MAX_SAME_TYPE_STREAK) {
          buyProbability = 0.8; 
        }
      }  

      // Add randomness based on vault balance state
      const vaultBalance = await this.walletManagementService.getWalletBalance(session.walletAddress);
      const vaultTokenBalance = await this.walletManagementService.getTokenBalance(session.walletAddress, session.contractAddress, false);
      
      // If we have lots of tokens, increase sell probability
      if (vaultTokenBalance > 0) {
        const tokenRatio = vaultTokenBalance / (vaultBalance + 0.001); // Prevent division by zero
        if (tokenRatio > TRADING_CONSTANTS.VARIANCE_THRESHOLD) {
          buyProbability -= 0.2;
        }
      }
      
      // If very low SOL balance, increase buy probability (to balance)
      if (vaultBalance < 0.01) {
        buyProbability -= 0.2;
      }
      
      // Ensure probability stays within bounds
      buyProbability = Math.max(0.1, Math.min(0.9, buyProbability));
      
      // Generate random number and decide
      const randomValue = Math.random();
      const decidedType = randomValue < buyProbability ? TradeType.BUY : TradeType.SELL;
      
      logger.debug('Trade type decision', {
        sessionId,
        lastTradeType,
        consecutiveCount,
        buyProbability: (buyProbability * 100).toFixed(1) + '%',
        randomValue: randomValue.toFixed(3),
        decidedType,
        vaultBalance: vaultBalance.toFixed(6),
        vaultTokenBalance: vaultTokenBalance.toFixed(6)
      });
      
      return decidedType;
      
    } catch (error) {
      logger.warn('Error in trade type determination, falling back to simple logic', { 
        sessionId, 
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (!session.lastTradeType) {
        // For new sessions, start with BUY
        return TradeType.BUY;
      }

      // Fallback to simple alternating logic if something goes wrong
      return session.lastTradeType === 'buy' ? TradeType.SELL : TradeType.BUY;
    }
  }

  private async getRecentTradeHistory(sessionId: string, limit: number = 10): Promise<Array<{type: string, createdAt: Date}>> {
    try {
      const trades = await db.select({
        type: transactions.type,
        createdAt: transactions.createdAt
      })
      .from(transactions)
      .where(and(
        eq(transactions.sessionId, sessionId),
        eq(transactions.status, 'confirmed')
      ))
      .orderBy(desc(transactions.createdAt))
      .limit(limit);
      
      return trades.map(trade => ({
        type: trade.type,
        createdAt: trade.createdAt || new Date()
      }));
    } catch (error) {
      logger.warn('Failed to get recent trade history', { sessionId, error });
      return [];
    }
  }

  private async updateConsecutiveTradeCount(sessionId: string, tradeType: TradeType): Promise<void> {
    try {
      // Get recent trade history to calculate current streak
      const recentTrades = await this.getRecentTradeHistory(sessionId, 10);
      const consecutiveCount = this.getConsecutiveTradeCount(recentTrades);
      
      // Add the new trade to calculate what the new streak will be
      let newConsecutiveCount = 1;
      if (consecutiveCount.type === tradeType) {
        newConsecutiveCount = consecutiveCount.count + 1;
      }
      
      // Update session with consecutive trade info (optional database tracking)
      await db.update(userSessions)
        .set({ 
          lastTradeType: tradeType,
          updatedAt: new Date()
          // Could add consecutiveTradeCount: newConsecutiveCount if you want to store it
        })
        .where(eq(userSessions.sessionId, sessionId));
      
      // Log streak information for monitoring
      if (newConsecutiveCount >= 3) {
        logger.info('Trade streak detected', {
          sessionId,
          tradeType,
          consecutiveCount: newConsecutiveCount,
          streakWarning: newConsecutiveCount >= TRADING_CONSTANTS.MAX_SAME_TYPE_STREAK ? 'APPROACHING_LIMIT' : 'NORMAL'
        });
      }
      
      logger.debug('Consecutive trade count updated', { 
        sessionId, 
        tradeType, 
        newConsecutiveCount,
        previousStreak: consecutiveCount
      });
      
    } catch (error) {
      logger.warn('Failed to update consecutive trade count', { 
        sessionId, 
        tradeType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  
  private getConsecutiveTradeCount(trades: Array<{type: string, createdAt: Date}>): {type: TradeType | null, count: number} {
    if (trades.length === 0) {
      return { type: null, count: 0 };
    }
    
    const latestType = trades[0].type as TradeType;
    let count = 0;
    
    for (const trade of trades) {
      if (trade.type === latestType) {
        count++;
      } else {
        break;
      }
    }
    
    return { type: latestType, count };
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

  private async updateTradingStatus(sessionId: string, tradingStatus: string): Promise<void> {
      await db.update(userSessions).set({ tradingStatus }).where(eq(userSessions.sessionId, sessionId));
  }

  private async handleTradeResult(sessionId: string, tradeResult: TradeResult, ephemeralAddress: string) {
    try {
        await db.insert(transactions).values({
            sessionId,
            signature: tradeResult.signature || 'N/A',
            type: tradeResult.transaction ? (tradeResult.transaction as any).type : 'unknown',
            tokenAmount: tradeResult.amountOut.toString(),
            solAmount: tradeResult.amountIn.toString(),
            status: tradeResult.success ? 'confirmed' : 'failed',
            errorMessage: tradeResult.error,
            createdAt: tradeResult.timestamp,
            confirmedAt: tradeResult.success ? new Date() : undefined,
            dexUsed: 'jupiter',
            poolAddress: ephemeralAddress // Using ephemeral address for tracking
        });
    } catch (dbError) {
        logger.error('Failed to record trade result in database', { sessionId, dbError });
    }
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