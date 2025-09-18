import { logger } from '../config/logger';
import { db } from '../config/database';
import { userSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  SessionConfig,
  SessionStatus,
  TradingConfiguration,
  SessionValidationResult
} from '../types/session';
import {
  SessionCreationResponse,
  TradingInstruction,
  AutoTradingConfig
} from '../types/api';
import {
  generateSessionId,
} from '../utils/helpers';
import {
  TRADING_CONSTANTS,
  STRATEGY_CONSTANTS,
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';
import { TokenValidationService } from './TokenValidationService';
import { WalletManagementService } from './WalletManagementService';
import { AutoTradingService } from './AutoTradingService';
import { Keypair } from "@solana/web3.js";
import { TradingService } from './TradingService';
import bs58 from 'bs58';

export class SessionManagementService {
  private tokenValidationService: TokenValidationService;
  private walletManagementService: WalletManagementService;
  private autoTradingService: AutoTradingService;
  private tradingService: TradingService;

  constructor() {
    this.tokenValidationService = new TokenValidationService();
    this.walletManagementService = new WalletManagementService();
    this.autoTradingService = new AutoTradingService();
    this.tradingService = new TradingService();
  }

  async createSession(contractAddress: string, tokenSymbol?: string): Promise<SessionCreationResponse> {
    try {
      logger.info('Creating new trading session', { contractAddress, tokenSymbol });

      // Validate token first
      const tokenValidation = await this.tokenValidationService.validateToken(contractAddress);
      
      if (!tokenValidation.valid) {
        throw createError.validation('Token validation failed');
      }

      // Generate unique session ID
      const sessionId = generateSessionId();

      // Create wallet for this session
      const mainFundingWallet = await this.walletManagementService.createMainFundingWallet(sessionId);
      
      const isPrivileged = await this.walletManagementService.isPrivilegedWallet(mainFundingWallet.address);
      const tradingConfig = this.createTradingConfiguration(isPrivileged);


      // Create session data
      const sessionData: SessionConfig = {
        sessionId,
        contractAddress,
        tokenSymbol: tokenSymbol || tokenValidation.token.symbol,
        wallet: mainFundingWallet,
        tradingConfig,
        autoTradingEnabled: true,
        status: SessionStatus.CREATED,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save session to database
      await this.persistSession(sessionData);

      // Pre-create the pool of bot wallets for this session
      await this.walletManagementService.createWalletPool(
        sessionId, 
        STRATEGY_CONSTANTS.WALLET_POOL_SIZE, 
        STRATEGY_CONSTANTS.WHALE_WALLET_PERCENTAGE
      );

      // Start wallet monitoring for funding detection
      await this.startWalletMonitoring(sessionId, mainFundingWallet.address, isPrivileged);

      const decryptedPrivateKey = this.walletManagementService.decryptPrivateKey(mainFundingWallet.privateKey);
      const userFriendlyPrivateKey = bs58.encode(decryptedPrivateKey);


      // Build response
      const response: SessionCreationResponse = {
        success: true,
        sessionId,
        wallet: {
          publicKey: mainFundingWallet.publicKey
        },
        userWallet: {
          address: mainFundingWallet.address,
          privateKey: userFriendlyPrivateKey,
        },
        token: {
          contractAddress,
          symbol: tokenValidation.token.symbol,
          name: tokenValidation.token.name,
          decimals: tokenValidation.token.decimals
        },
        primaryDex: tokenValidation.primaryDex,
        instructions: this.generateTradingInstructions(tradingConfig),
        autoTrading: this.buildAutoTradingConfig(tradingConfig)
      };

      logger.info('Trading session created successfully', {
        sessionId,
        walletAddress: mainFundingWallet.address,
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
      const wallet = await this.walletManagementService.getWalletByAddress(session.mainFundingAddress);
      if (!wallet) {
        logger.warn('Wallet not found for session', { sessionId, walletAddress: session.mainFundingAddress });
        return null;
      }

      const tradingConfig: TradingConfiguration = {
        minDeposit: session.isPrivileged 
          ? TRADING_CONSTANTS.MIN_PRIVILEGED_WALLET_DEPOSIT 
          : TRADING_CONSTANTS.MIN_WALLET_DEPOSIT,
        targetDepletion: parseFloat(session.targetDepletion || '75'),
        revenuePercentage: TRADING_CONSTANTS.REVENUE_PERCENTAGE,
        maxSlippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
        tradeSize: {
          min: session.isPrivileged ? 0.001 : 0.01,
          max: session.isPrivileged ? 0.01 : 0.1
        },
        isPrivileged: session.isPrivileged || false
      };

      return {
        sessionId: session.sessionId,
        contractAddress: session.contractAddress,
        tokenSymbol: session.tokenSymbol || '',
        wallet,
        tradingConfig,
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

  async pauseAndSweepSession(sessionId: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
        const sessions = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));
        if (sessions.length == 0) {
            return { success: false, message: 'Session not found.' };
        }

        const session = sessions[0];

        // 1. Pause the trading loop first
        await this.autoTradingService.stopAutoTrading(sessionId, 'User initiated sweep.');
        await db.update(userSessions).set({ status: SessionStatus.PAUSED }).where(eq(userSessions.sessionId, sessionId));

        logger.info('Session paused, initiating sweep...', { sessionId });

        // 2. Call the sweep function
        const sweepResult = await this.walletManagementService.sweepAllAssets(sessionId, session.mainFundingAddress);

        if (sweepResult.success) {
            return { success: true, message: 'All assets swept back to main wallet successfully.', data: sweepResult };
        } else {
            return { success: false, message: 'Sweep completed with some errors.', data: sweepResult };
        }

    } catch (error) {
        logger.error('Failed during pause and sweep operation', { sessionId, error });
        return { success: false, message: `An unexpected error occurred: ${error instanceof Error ? error.message : 'Unknown'}` };
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

  private createTradingConfiguration(isPrivileged: boolean): TradingConfiguration {
    return {
      minDeposit: isPrivileged 
        ? TRADING_CONSTANTS.MIN_PRIVILEGED_WALLET_DEPOSIT 
        : TRADING_CONSTANTS.MIN_WALLET_DEPOSIT,
      targetDepletion: TRADING_CONSTANTS.TARGET_DEPLETION,
      revenuePercentage: TRADING_CONSTANTS.REVENUE_PERCENTAGE,
      maxSlippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
      tradeSize: {
        min: isPrivileged ? 0.001 : 0.01, // Smaller trades for privileged wallets
        max: isPrivileged ? 0.01 : 0.1
      },
      isPrivileged
    };
  }

  private async persistSession(sessionData: SessionConfig): Promise<void> {
    try {
      await db.insert(userSessions).values({
        sessionId: sessionData.sessionId,
        mainFundingAddress: sessionData.wallet.address,
        privateKey: sessionData.wallet.privateKey,
        contractAddress: sessionData.contractAddress,
        tokenSymbol: sessionData.tokenSymbol,
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

  private async startWalletMonitoring(sessionId: string, walletAddress: string, isPrivileged: boolean): Promise<void> {
    const balanceCheckCallback = async (balance: number) => {
      const sessions = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));
      const session = sessions[0];
      if (session && session.status === SessionStatus.CREATED) {
        const validation = await this.walletManagementService.validateWalletFunding(walletAddress, isPrivileged);
        if (validation.hasSufficientFunding) {
            await this.handleFundingDetected(session, validation.currentBalance);
        }
      }
    };
    await this.walletManagementService.monitorWalletBalance(walletAddress, balanceCheckCallback);
  }

  private async handleFundingDetected(session: any, fundedAmount: number): Promise<void> {
    logger.info('Sufficient funding detected for session', { sessionId: session.sessionId, fundedAmount });
    
    // Stop monitoring this wallet to prevent re-triggering
    await this.walletManagementService.stopWalletMonitoring(session.mainFundingAddress);
    
    await this.updateSessionStatus(session.sessionId, SessionStatus.FUNDED, { balance: fundedAmount, fundedAt: new Date() });
    
    // Decrypt main wallet key to perform distributions
    const mainFundingPrivateKey = this.walletManagementService.decryptPrivateKey(session.privateKey);
    const mainFundingKeypair = Keypair.fromSecretKey(mainFundingPrivateKey);

    // Calculate how many tokens the user's SOL can buy for distribution
    const tokenInfo = await this.tokenValidationService.getTokenMetadata(session.contractAddress);
    const tokenPrice = await this.tradingService.getTokenPrice(session.contractAddress);
    if (tokenPrice === 0) {
      logger.error("Could not get token price, aborting funding distribution", { sessionId: session.sessionId });
      await this.updateSessionStatus(session.sessionId, SessionStatus.STOPPED);
      return;
    }

    // Allocate 99% of SOL to buy the token, keep 1% for gas buffer
    const solForPurchase = fundedAmount * 0.99;
    const totalTokenAmount = (solForPurchase / tokenPrice) * Math.pow(10, tokenInfo.decimals);
    
    logger.info('Distributing funds to wallet pool', { sessionId: session.sessionId });
    await this.updateSessionStatus(session.sessionId, SessionStatus.DISTRIBUTING);
    
    await this.walletManagementService.fundWalletPool(session.sessionId, mainFundingKeypair, session.contractAddress, totalTokenAmount);

    // Finally, start the organic trading loop
    await this.autoTradingService.startAutoTrading(session.sessionId);
  }

  private generateTradingInstructions(tradingConfig: TradingConfiguration): TradingInstruction[] {
    const instructions: TradingInstruction[] = [
      {
        step: 1,
        action: 'Fund Wallet',
        description: `Send at least ${tradingConfig.minDeposit} SOL to the provided wallet address to start trading`,
        minimumAmount: tradingConfig.minDeposit
      },
      {
        step: 2,
        action: 'Automatic Trading',
        description: `The bot will automatically start trading once funding is detected, generating volume until ${tradingConfig.targetDepletion}% depletion`,
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

  private buildAutoTradingConfig(tradingConfig: TradingConfiguration): AutoTradingConfig {
    return {
      enabled: true,
      minDeposit: tradingConfig.minDeposit,
      targetDepletion: tradingConfig.targetDepletion,
      revenuePercentage: tradingConfig.revenuePercentage,
      isPrivileged: tradingConfig.isPrivileged
    };
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up session management service');
  }
}