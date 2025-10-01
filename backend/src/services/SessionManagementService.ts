import { logger } from '../config/logger';
import { db } from '../config/database';
import { userSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  SessionConfig,
  SessionStatus,
  TradingConfiguration,
  SessionValidationResult,
  FundingTierName
} from '../types/session';
import {
  SessionCreationResponse,
  TradingInstruction,
} from '../types/api';
import {
  generateSessionId,
} from '../utils/helpers';
import {
  TRADING_CONSTANTS,
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';
import { TokenValidationService } from './TokenValidationService';
import { WalletManagementService } from './WalletManagementService';
import { AutoTradingService } from './AutoTradingService';
import { eventService } from './EventService';
import { SessionEventType } from '../types/events';

export class SessionManagementService {
  private tokenValidationService: TokenValidationService;
  private walletManagementService: WalletManagementService;
  private autoTradingService: AutoTradingService;

  constructor() {
    this.tokenValidationService = new TokenValidationService();
    this.walletManagementService = new WalletManagementService();
    this.autoTradingService = new AutoTradingService();
  }

  async createSession(contractAddress: string, fundingTierName: string, tokenName: string, primaryDex: string, decimals: number,  tokenSymbol?: string): Promise<SessionCreationResponse> {
    try {
      logger.info('Creating new trading session', { contractAddress, tokenSymbol, fundingTierName, tokenName, primaryDex, decimals });

      // Validate funding tier access
      const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[fundingTierName.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
      if (!tierConfig) {
        throw createError.validation('Invalid funding tier specified');
      }

      // Generate unique session ID
      const sessionId = generateSessionId();

      // Create wallet for this session
      const wallet = await this.walletManagementService.createUserWallet(sessionId);

      // Check if this is a privileged wallet
      const isPrivileged = await this.walletManagementService.isPrivilegedWallet(wallet.address);
      
      // Create trading configuration
      const tradingConfig = this.createTradingConfiguration(tierConfig.name);

      // Create session data
      const sessionData: SessionConfig = {
        sessionId,
        contractAddress,
        tokenSymbol: tokenSymbol || 'Unknown',
        wallet,
        tradingConfig,
        autoTradingEnabled: true,
        fundingTier: tierConfig.name,
        status: SessionStatus.CREATED,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save session to database
      await this.persistSession(sessionData);

      // Start wallet monitoring for funding detection
      await this.startWalletMonitoring(sessionData);

      const instructions = this.generateTradingInstructions(tradingConfig);


      // Build response
      const response: SessionCreationResponse = {
        success: true,
        sessionId,
        wallet: {
          publicKey: wallet.publicKey
        },
        userWallet: {
          address: wallet.address,
          privateKey: Buffer.from(this.walletManagementService.decryptPrivateKey(wallet.privateKey)).toString('hex'),
        },
        fundingTier: tierConfig.name,
        tierConfig: {
          name: tierConfig.name,
          description: tierConfig.description,
          minFunding: tierConfig.minFunding,
          maxFunding: tierConfig.maxFunding
        },
        token: {
          contractAddress,
          symbol: tokenSymbol || "Unknown",
          name: tokenName,
          decimals: decimals
        },
        primaryDex: primaryDex,
        instructions: instructions,
        estimatedTrades: this.estimateTradeCount(tradingConfig),
        createdAt: sessionData.createdAt

      };

      logger.info('Trading session created successfully', {
        sessionId,
        walletAddress: wallet.address,
        contractAddress,
        isPrivileged,
        minDeposit: tradingConfig.minDeposit
      });

      return response;

    } catch (error) {
      logger.error('Failed to create trading session', {
        contractAddress,
        tokenSymbol,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<SessionConfig | null> {
    try {
      const sessions = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));
      
      if (sessions.length === 0) {
        return null;
      }

      const session = sessions[0];
      
      // Get wallet info
      const wallet = await this.walletManagementService.getWalletByAddress(session.walletAddress);
      if (!wallet) {
        logger.warn('Wallet not found for session', { sessionId, walletAddress: session.walletAddress });
        return null;
      }

      const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[session?.fundingTier?.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
      const minBuyUSD = 'minBuyUSD' in tierConfig ? tierConfig.minBuyUSD : 0;
      const tradingConfig: TradingConfiguration = {
        minDeposit: tierConfig.minFunding,
        targetDepletion: TRADING_CONSTANTS.TARGET_DEPLETION,
        revenuePercentage: TRADING_CONSTANTS.REVENUE_PERCENTAGE,
        tradingInterval: TRADING_CONSTANTS.TRADE_INTERVAL_MS,
        maxSlippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
        tradeSize: {
          min: minBuyUSD,
          max: tierConfig.maxBuyUSD
        },
        isPrivileged: session.isPrivileged || false,
        fundingTier: tierConfig.name,
      };

      return {
        sessionId: session.sessionId,
        contractAddress: session.contractAddress,
        tokenSymbol: session.tokenSymbol || '',
        wallet,
        tradingConfig,
        fundingTier: tierConfig.name,
        autoTradingEnabled: session.autoTradingActive || false,
        status: session.status as SessionStatus || SessionStatus.CREATED,
        createdAt: session.createdAt || new Date(),
        updatedAt: session.updatedAt || new Date(),
        fundedAt: session.fundedAt || undefined,
        completedAt: session.completedAt || undefined
      };

    } catch (error) {
      logger.error('Failed to get session', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus, metadata?: any): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date()
      };

      if (status === SessionStatus.FUNDED && metadata?.fundedAt) {
        updateData.fundedAt = metadata.fundedAt;
        updateData.initialBalance = metadata.balance;
        updateData.currentBalance = metadata.balance;
      }

      if (status === SessionStatus.COMPLETED && metadata?.completedAt) {
        updateData.completedAt = metadata.completedAt;
        updateData.autoTradingActive = false;
      }

      await db.update(userSessions)
        .set(updateData)
        .where(eq(userSessions.sessionId, sessionId));

      logger.info('Session status updated', { sessionId, status, metadata });

    } catch (error) {
      logger.error('Failed to update session status', {
        sessionId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async updateSessionBalance(sessionId: string, balance: number): Promise<void> {
    try {
      await db.update(userSessions)
        .set({ 
          currentBalance: balance.toString(),
          updatedAt: new Date()
        })
        .where(eq(userSessions.sessionId, sessionId));

      logger.debug('Session balance updated', { sessionId, balance });

    } catch (error) {
      logger.error('Failed to update session balance', {
        sessionId,
        balance,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async validateSession(sessionId: string): Promise<SessionValidationResult> {
    try {
      const session = await this.getSession(sessionId);
      
      if (!session) {
        return {
          valid: false,
          session: null,
          errors: ['Session not found'],
          canTrade: false,
          fundingRequired: 0
        };
      }

      const errors: string[] = [];
      let canTrade = true;
      let fundingRequired = 0;

      // Check if session is in valid state for trading
      if (session.status === SessionStatus.COMPLETED || session.status === SessionStatus.STOPPED) {
        errors.push('Session is no longer active');
        canTrade = false;
      }

      // Check wallet balance
      const currentBalance = await this.walletManagementService.getWalletBalance(session.wallet.address);
      const validation = await this.walletManagementService.validateWalletFunding(
        session.wallet.address, 
        session.tradingConfig.fundingTier,
        session.tradingConfig.isPrivileged
      );

      if (!validation.hasSufficientFunding) {
        fundingRequired = validation.requiredAmount - validation.currentBalance;
        if (session.status === SessionStatus.CREATED) {
          canTrade = false;
          errors.push(`Insufficient funding. Required: ${validation.requiredAmount} SOL, Current: ${validation.currentBalance} SOL`);
        }
      }

      return {
        valid: true,
        session,
        errors,
        canTrade,
        fundingRequired
      };

    } catch (error) {
      logger.error('Session validation failed', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        valid: false,
        session: null,
        errors: ['Session validation failed'],
        canTrade: false,
        fundingRequired: 0
      };
    }
  }

  private async persistSession(sessionData: SessionConfig): Promise<void> {
    try {
      await db.insert(userSessions).values({
        sessionId: sessionData.sessionId,
        walletAddress: sessionData.wallet.address,
        privateKey: sessionData.wallet.privateKey,
        contractAddress: sessionData.contractAddress,
        tokenSymbol: sessionData.tokenSymbol,
        lastTradeType: null, 
        fundingTier: sessionData.fundingTier,
        status: sessionData.status,
        isPrivileged: sessionData.tradingConfig.isPrivileged,
        autoTradingActive: sessionData.autoTradingEnabled,
        targetDepletion: sessionData.tradingConfig.targetDepletion.toString(),
        createdAt: sessionData.createdAt,
        updatedAt: sessionData.updatedAt
      });

      logger.info('Session persisted to database', { sessionId: sessionData.sessionId });

    } catch (error) {
      logger.error('Failed to persist session', {
        sessionId: sessionData.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw createError.database('Failed to save session');
    }
  }

  private async startWalletMonitoring(sessionData: SessionConfig): Promise<void> {
    try {
      // Start monitoring wallet for funding detection
      await this.walletManagementService.monitorWalletBalance(
        sessionData.wallet.address,
        async (balance: number) => {
          await this.handleFundingDetection(sessionData.sessionId, balance);
        }
      );

      logger.info('Wallet monitoring started', {
        sessionId: sessionData.sessionId,
        walletAddress: sessionData.wallet.address
      });

    } catch (error) {
      logger.error('Failed to start wallet monitoring', {
        sessionId: sessionData.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }


  private async handleFundingDetection(sessionId: string, balance: number): Promise<void> {
    try {
      // Use a database transaction to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Check and update status atomically
        const sessions = await tx.select()
          .from(userSessions)
          .where(eq(userSessions.sessionId, sessionId))
          .limit(1);
        
        if (sessions.length === 0) {
          return { shouldProcess: false, session: null };
        }
        
        const session = sessions[0];
        
        // Only process if status is exactly 'created'
        if (session.status !== SessionStatus.CREATED) {
          logger.debug('Skipping funding detection - session already processed', {
            sessionId,
            currentStatus: session.status,
            balance
          });
          return { shouldProcess: false, session: null };
        }
        
        // Immediately update status to 'processing' to prevent double processing
        await tx.update(userSessions)
          .set({ 
            status: 'processing', // Temporary status
            updatedAt: new Date()
          })
          .where(eq(userSessions.sessionId, sessionId));
        
        return { shouldProcess: true, session };
      });
      
      if (!result.shouldProcess || !result.session) {
        return;
      }

      // Get the full session object
      const session = await this.getSession(sessionId);
      if (!session) return;

      // Detect funding source and update privilege status
      await this.walletManagementService.updateSessionPrivilegeStatus(sessionId, session.wallet.address);

      await eventService.emitSessionEvent({
        sessionId,
        eventType: SessionEventType.FUNDING_DETECTED,
        eventData: {
          balance,
          funderAddress: await this.walletManagementService.detectFundingSource(session.wallet.address),
          timestamp: new Date()
        }
      });
      
      // Get updated session with new privilege status
      const updatedSession = await this.getSession(sessionId);
      if (!updatedSession) return;

      const validation = await this.walletManagementService.validateWalletFunding(
        session.wallet.address,
        session.tradingConfig.fundingTier,
        updatedSession.tradingConfig.isPrivileged
      );

      if (validation.hasSufficientFunding) {
        const totalFundedAmount = validation.currentBalance;

        // Transfer 25% revenue immediately upon funding
        const revenueTransfer = await this.walletManagementService.transferRevenue(
          session.wallet, 
          totalFundedAmount
        );

        if (revenueTransfer.success) {
          // Calculate remaining balance for trading (75% of original)
          const tradingBalance = totalFundedAmount - revenueTransfer.revenueAmount;

          await eventService.emitSessionEvent({
            sessionId,
            eventType: SessionEventType.REVENUE_TRANSFERRED,
            eventData: {
              amount: revenueTransfer.revenueAmount,
              signature: revenueTransfer.signature,
              remainingBalance: tradingBalance
            }
          });

          // Update session to FUNDED status
          await this.updateSessionStatus(sessionId, SessionStatus.FUNDED, {
            fundedAt: new Date(),
            initialBalance: tradingBalance,
            balance: tradingBalance,
            initialFundedAmount: totalFundedAmount,
            revenueTransferred: revenueTransfer.revenueAmount,
            revenueSignature: revenueTransfer.signature
          });

          // Start trading with the remaining 75%
          await this.autoTradingService.startAutoTrading(sessionId);

          await eventService.emitSessionEvent({
            sessionId,
            eventType: SessionEventType.TRADING_STARTED,
            eventData: {
              initialBalance: tradingBalance,
              targetToken: session.contractAddress,
              tokenSymbol: session.tokenSymbol
            }
          });

          logger.info('Funding processed: Revenue transferred, trading started', {
            sessionId,
            totalFunded: totalFundedAmount,
            revenueTransferred: revenueTransfer.revenueAmount,
            tradingBalance,
            revenueSignature: revenueTransfer.signature,
            isPrivileged: updatedSession.tradingConfig.isPrivileged
          });
        } else {
          // If revenue transfer failed, revert status
          await this.updateSessionStatus(sessionId, SessionStatus.CREATED);
          logger.error('Failed to transfer revenue, reverting session status', { sessionId });
        }
      } else {
        // If funding insufficient, revert status
        await this.updateSessionStatus(sessionId, SessionStatus.CREATED);
        logger.debug('Insufficient funding detected, reverting session status', { sessionId, balance });
      }

    } catch (error) {
      // If anything fails, try to revert the session status
      try {
        await this.updateSessionStatus(sessionId, SessionStatus.CREATED);
      } catch (revertError) {
        logger.error('Failed to revert session status after error', { sessionId, revertError });
      }
      
      logger.error('Failed to handle funding detection', { sessionId, error });
    }
  }

  private generateTradingInstructions(tradingConfig: TradingConfiguration): TradingInstruction[] {
    const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[tradingConfig.fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
    
    const instructions: TradingInstruction[] = [
      {
        step: 1,
        action: 'Fund Wallet',
        description: `Send between ${tierConfig.minFunding}-${tierConfig.maxFunding} SOL to the provided wallet address. ${tierConfig.description}`,
        minimumAmount: tierConfig.minFunding
      },
      {
        step: 2,
        action: 'Tier-Based Trading',
        description: `Using ${tradingConfig.fundingTier} tier: Buys will use $${tierConfig.minBuyUSD}-$${tierConfig.maxBuyUSD} per trade, sells will use ${tierConfig.sellPercentageMin}-${tierConfig.sellPercentageMax}% of token balance`,
        minimumAmount: 0
      },
      {
        step: 3,
        action: 'Revenue Collection',
        description: `${tradingConfig.revenuePercentage}% of deposited funds will be retained as service revenue`,
        minimumAmount: 0
      }
    ];
  
    return instructions;
  }

  private createTradingConfiguration(fundingTier: FundingTierName): TradingConfiguration {
    const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
    const isPrivileged = fundingTier === 'micro';

    const minBuyUSD = 'minBuyUSD' in tierConfig ? tierConfig.minBuyUSD : 0;
  
    return {
      minDeposit: tierConfig.minFunding,
      targetDepletion: TRADING_CONSTANTS.TARGET_DEPLETION,
      revenuePercentage: TRADING_CONSTANTS.REVENUE_PERCENTAGE,
      tradingInterval: TRADING_CONSTANTS.TRADE_INTERVAL_MS,
      maxSlippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
      tradeSize: {
        min: minBuyUSD || (tierConfig.minFunding * 0.1), // 10% of min funding if no USD min
        max: tierConfig.maxBuyUSD
      },
      isPrivileged,
      fundingTier
    };
  }

  private estimateTradeCount(tradingConfig: TradingConfiguration): number {
    const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[tradingConfig.fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
    const avgFunding = (tierConfig.minFunding + tierConfig.maxFunding) / 2;
    const avgTradeSize = (tierConfig.minBuyUSD + tierConfig.maxBuyUSD) / 2; // Average USD trade size
    const tradingBalance = avgFunding * 0.75;
    
    return Math.floor(tradingBalance / (avgTradeSize + 0.006)); 
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up session management service');
  }
}