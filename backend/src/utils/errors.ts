import logger from "../config/logger";

export interface APIError extends Error {
    code?: string;
    statusCode?: number;
    details?: any;
  }
  
  export const createError = {
    validation: (message: string, code?: string): APIError => {
      const error = new Error(message) as APIError;
      error.code = code || 'VALIDATION_ERROR';
      error.statusCode = 400;
      return error;
    },
  
    notFound: (message: string, code?: string): APIError => {
      const error = new Error(message) as APIError;
      error.code = code || 'NOT_FOUND';
      error.statusCode = 404;
      return error;
    },
  
    insufficientBalance: (
      currentBalance: number, 
      requiredBalance: number, 
      action: string,
      additionalDetails?: any
    ): APIError => {
      const shortfall = requiredBalance - currentBalance;
      const error = new Error(
        `Insufficient balance for ${action}: ${currentBalance.toFixed(6)} SOL available, ${requiredBalance.toFixed(6)} SOL required (shortfall: ${shortfall.toFixed(6)} SOL)`
      ) as APIError;
      
      error.code = `INSUFFICIENT_BALANCE_FOR_${action.toUpperCase()}`;
      error.statusCode = 400;
      error.details = {
        currentBalance,
        requiredBalance,
        shortfall,
        action,
        ...additionalDetails
      };
      return error;
    },
  
    invalidSessionStatus: (
      currentStatus: string, 
      requiredStatus: string, 
      action: string
    ): APIError => {
      const error = new Error(
        `Cannot ${action}: Session status is '${currentStatus}', but '${requiredStatus}' is required`
      ) as APIError;
      error.code = 'INVALID_SESSION_STATUS';
      error.statusCode = 400;
      error.details = {
        currentStatus,
        requiredStatus,
        action
      };
      return error;
    },
  
    // Specific error creators for common trading scenarios
    sessionAlreadyPaused: (): APIError => {
      const error = new Error('Session is already paused') as APIError;
      error.code = 'ALREADY_PAUSED';
      error.statusCode = 400;
      error.details = {
        suggestion: 'Use resume to restart trading, or check session status'
      };
      return error;
    },
  
    sessionAlreadyRunning: (): APIError => {
      const error = new Error('Session is already running') as APIError;
      error.code = 'ALREADY_RUNNING';
      error.statusCode = 400;
      error.details = {
        suggestion: 'Use pause to stop trading, or check session status'
      };
      return error;
    },
  
    sessionNotPaused: (currentStatus: string): APIError => {
      const error = new Error(`Cannot resume: Session is ${currentStatus}, not paused`) as APIError;
      error.code = 'SESSION_NOT_PAUSED';
      error.statusCode = 400;
      error.details = {
        currentStatus,
        suggestion: currentStatus === 'trading' ? 'Session is already running' : 'Check session status'
      };
      return error;
    },
  
    balanceTooLowForPause: (currentBalance: number, minRequired: number): APIError => {
      const error = new Error(
        `Balance too low to pause safely: ${currentBalance.toFixed(6)} SOL available, ${minRequired.toFixed(6)} SOL minimum required`
      ) as APIError;
      error.code = 'INSUFFICIENT_BALANCE_FOR_PAUSE';
      error.statusCode = 400;
      error.details = {
        currentBalance,
        minRequired,
        suggestion: 'Consider stopping the session instead of pausing, as resuming would not be possible with this balance.',
        actionCode: 'SUGGEST_STOP_INSTEAD'
      };
      return error;
    },
  
    balanceTooLowForResume: (currentBalance: number, breakdown: any): APIError => {
      const total = breakdown.tradingAmount + breakdown.fees;
      const shortfall = total - currentBalance;
      
      const error = new Error(
        `Insufficient balance to resume trading: ${currentBalance.toFixed(6)} SOL available, ${total.toFixed(6)} SOL required`
      ) as APIError;
      error.code = 'INSUFFICIENT_BALANCE_FOR_RESUME';
      error.statusCode = 400;
      error.details = {
        currentBalance,
        required: total,
        shortfall,
        breakdown,
        suggestion: `Add at least ${shortfall.toFixed(6)} SOL to your wallet before resuming trading.`,
        actionCode: 'ADD_MORE_SOL'
      };
      return error;
    }
  };
  
  // Middleware to format error responses with detailed information
  export const formatErrorResponse = (error: APIError, req: any, res: any, next: any) => {
    const statusCode = error.statusCode || 500;
    
    const response = {
      success: false,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
      ...(error.details && { details: error.details })
    };
  
    // Log error for debugging
    logger.error('API Error Response', {
      statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      path: req.path,
      method: req.method
    });
  
    res.status(statusCode).json(response);
  };
  
  // Helper function to check if error is a specific type
  export const isErrorType = (error: any, errorCode: string): boolean => {
    return error?.code === errorCode;
  };
  
  // Helper function to extract user-friendly message from error
  export const getUserFriendlyMessage = (error: APIError): string => {
    switch (error.code) {
      case 'INSUFFICIENT_BALANCE_FOR_PAUSE':
        return `Your wallet balance is too low to pause safely. Consider stopping the session instead.`;
      
      case 'INSUFFICIENT_BALANCE_FOR_RESUME':
        const details = error.details;
        return `You need ${details?.shortfall?.toFixed(6)} more SOL to resume trading. Please add funds to your wallet.`;
      
      case 'ALREADY_PAUSED':
        return `This session is already paused. Use the resume button to restart trading.`;
      
      case 'ALREADY_RUNNING':
        return `This session is already running. Use the pause button to temporarily stop trading.`;
      
      case 'SESSION_NOT_PAUSED':
        return `Cannot resume: Session is not currently paused.`;
      
      default:
        return error.message || 'An unexpected error occurred';
    }
  };