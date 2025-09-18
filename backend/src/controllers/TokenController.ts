import { Request, Response, NextFunction } from 'express';
import { TokenValidationService } from '../services/TokenValidationService';
import { logger } from '../config/logger';
import { HTTP_STATUS } from '../utils/constants';
import { TokenValidationResponse } from '../types/api';

export class TokenController {
  private tokenValidationService: TokenValidationService;

  constructor() {
    this.tokenValidationService = new TokenValidationService();
  }

  validateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { contractAddress } = req.body;
      
      logger.info('Token validation request received', { 
        contractAddress,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Validate token
      const result: TokenValidationResponse = await this.tokenValidationService.validateToken(contractAddress);
      
      // Log result
      logger.info('Token validation completed', { 
        contractAddress,
        valid: result.valid,
        primaryDex: result.primaryDex,
        liquidityUsd: result.liquidityUsd,
        poolsFound: result.pools.length
      });

      // Send response
      res.status(HTTP_STATUS.OK).json(result);

    } catch (error) {
      logger.error('Token validation error', {
        contractAddress: req.body?.contractAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      next(error);
    }
  };

  // Health check endpoint for token validation service
  getTokenValidationHealth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Simple health check - could be enhanced with service-specific checks
      res.status(HTTP_STATUS.OK).json({
        success: true,
        service: 'TokenValidationService',
        status: 'healthy',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      next(error);
    }
  };
}