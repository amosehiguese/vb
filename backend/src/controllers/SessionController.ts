import { Request, Response, NextFunction } from 'express';
import { SessionManagementService } from '../services/SessionManagementService';
import { AutoTradingService } from '../services/AutoTradingService';
import { logger } from '../config/logger';
import { HTTP_STATUS, TRADING_CONSTANTS } from '../utils/constants';
import { SessionCreationResponse } from '../types/api';
import { SessionStatus } from '../types/session'
import { createError } from '../middleware/errorHandler';

export class SessionController {
  private sessionManagementService: SessionManagementService;
  private autoTradingService: AutoTradingService;

  constructor() {
    this.sessionManagementService = new SessionManagementService();
    this.autoTradingService = new AutoTradingService();
  }

  createSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { contractAddress, tokenSymbol, fundingTierName } = req.body;

      logger.info('Session creation request received', { 
        contractAddress,
        tokenSymbol,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Create session
      const result: SessionCreationResponse = await this.sessionManagementService.createSession(
        contractAddress, 
        fundingTierName,
        tokenSymbol,
      );
      
      // Log successful creation
      logger.info('Session created successfully', { 
        sessionId: result.sessionId,
        contractAddress,
        walletAddress: result.userWallet.address,
        tokenSymbol: result.token.symbol,
        primaryDex: result.primaryDex,
      });

      // Send response
      res.status(HTTP_STATUS.CREATED).json(result);

    } catch (error) {
      logger.error('Session creation error', {
        contractAddress: req.body?.contractAddress,
        tokenSymbol: req.body?.tokenSymbol,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      next(error);
    }
  };

  getSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      logger.debug('Session retrieval request', { sessionId });

      // Get session data
      const session = await this.sessionManagementService.getSession(sessionId);
      
      if (!session) {
        logger.warn('Session not found', { sessionId });
        return next(createError.notFound('Session not found'));
      }

      // Get trading state
      const tradingState = await this.autoTradingService.getTradingState(sessionId);
      
      // Get session metrics
      const metrics = await this.autoTradingService.getSessionMetrics(sessionId);

      // Build response
      const response = {
        success: true,
        session: {
          sessionId: session.sessionId,
          contractAddress: session.contractAddress,
          tokenSymbol: session.tokenSymbol,
          status: session.status,
          walletAddress: session.wallet.address,
          balance: session.wallet.balance || 0,
          isPrivileged: session.tradingConfig.isPrivileged,
          autoTradingEnabled: session.autoTradingEnabled,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          fundedAt: session.fundedAt,
          completedAt: session.completedAt
        },
        trading: {
          // 'isLoopActive' now tells us if the bot is running its cycle.
          isActive: tradingState?.isLoopActive || false,
          // 'isPaused' is determined by the session's persistent status in the DB.
          isPaused: tradingState?.status === SessionStatus.PAUSED,
          // The specific step the bot is on.
          tradingStatus: tradingState?.tradingStatus || 'idle',
          lastTradeAt: tradingState?.lastTradeAt
        },
        metrics: metrics || {
          totalTrades: 0,
          successfulTrades: 0,
          failedTrades: 0,
          totalVolume: 0,
          currentBalance: session.wallet.balance || 0,
          initialBalance: 0,
          depletionPercentage: 0,
          averageTradeSize: 0,
          tradingDuration: 0
        }
      };

      res.status(HTTP_STATUS.OK).json(response);

    } catch (error) {
      logger.error('Session retrieval error', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      next(error);
    }
  };

  getSessionMetrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      logger.debug('Session metrics request', { sessionId });

      // Get session metrics
      const metrics = await this.autoTradingService.getSessionMetrics(sessionId);
      
      if (!metrics) {
        logger.warn('Session metrics not found', { sessionId });
        return next(createError.notFound('Session not found or no metrics available'));
      }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        sessionId,
        metrics
      });

    } catch (error) {
      logger.error('Session metrics retrieval error', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      next(error);
    }
  };

  pauseSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const reason  = 'Manual pause';
      
      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      logger.info('Session pause request', { sessionId, reason });

      // Pause auto-trading
      await this.autoTradingService.pauseAutoTrading(sessionId, reason);

      logger.info('Session paused successfully', { sessionId, reason });

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Session paused successfully',
        sessionId,
        reason: reason
      });

    } catch (error) {
      logger.error('Session pause error', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      next(error);
    }
  };

  resumeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      logger.info('Session resume request', { sessionId });

      // Resume auto-trading
      await this.autoTradingService.resumeAutoTrading(sessionId);

      logger.info('Session resumed successfully', { sessionId });

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Session resumed successfully',
        sessionId
      });

    } catch (error) {
      logger.error('Session resume error', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      next(error);
    }
  };

  stopSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const reason = 'Manual stop';
      
      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      logger.info('Session stop request', { sessionId, reason });

      // Stop auto-trading
      await this.autoTradingService.stopAutoTrading(sessionId, reason);

      logger.info('Session stopped successfully', { sessionId, reason });

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Session stopped successfully',
        sessionId,
        reason: reason
      });

    } catch (error) {
      logger.error('Session stop error', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      next(error);
    }
  };

  validateSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      logger.debug('Session validation request', { sessionId });

      // Validate session
      const validation = await this.sessionManagementService.validateSession(sessionId);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        sessionId,
        validation
      });

    } catch (error) {
      logger.error('Session validation error', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      next(error);
    }
  };

  // Health check for session service
  getSessionServiceHealth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(HTTP_STATUS.OK).json({
        success: true,
        service: 'SessionManagementService',
        status: 'healthy',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      next(error);
    }
  };
}