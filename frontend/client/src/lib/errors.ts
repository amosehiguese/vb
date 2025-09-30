export const handleApiError = (error: any, operation: string) => {
    let errorData;
    
    try {
      errorData = typeof error === 'string' ? JSON.parse(error) : error;
    } catch {
      errorData = { message: error.message || 'Unknown error', code: 'UNKNOWN_ERROR' };
    }
  
    const errorCode = errorData?.code;
    const details = errorData?.details;
  
    switch (errorCode) {
      case 'INSUFFICIENT_BALANCE_FOR_PAUSE':
        return {
          title: `❌ Cannot pause session`,
          message: `Your wallet balance (${details?.currentBalance?.toFixed(6)} SOL) is too low to pause safely.`,
          suggestion: `Consider stopping the session instead, as resuming would require more SOL than currently available.`,
          duration: 8000
        };
      
      case 'INSUFFICIENT_BALANCE_FOR_RESUME':
        const shortfall = details?.shortfall?.toFixed(6) || 'some';
        return {
          title: `❌ Cannot resume session`,
          message: `Your wallet needs ${shortfall} more SOL to cover trading and network fees.`,
          suggestion: `Current: ${details?.currentBalance?.toFixed(6)} SOL, Required: ${details?.required?.toFixed(6)} SOL`,
          duration: 8000
        };
      
      case 'ALREADY_PAUSED':
        return {
          title: `⏸️ Session already paused`,
          message: `This session is already paused.`,
          suggestion: `Use the resume button to restart trading.`,
          duration: 5000
        };
      
      case 'ALREADY_RUNNING':
        return {
          title: `▶️ Session already running`,
          message: `This session is already active.`,
          suggestion: `Use the pause button to temporarily stop trading.`,
          duration: 5000
        };
      
      case 'SESSION_NOT_PAUSED':
        return {
          title: `❌ Cannot resume`,
          message: `Session is currently ${details?.currentStatus}, not paused.`,
          suggestion: details?.suggestion || `Check session status before resuming.`,
          duration: 5000
        };
      
      case 'SESSION_NOT_FOUND':
        return {
          title: `❌ Session not found`,
          message: `The requested session could not be found.`,
          suggestion: `Please check the session ID and try again.`,
          duration: 6000
        };
      
      case 'WALLET_NOT_FOUND':
        return {
          title: `❌ Wallet error`,
          message: `Session wallet is not accessible.`,
          suggestion: `Please contact support if this issue persists.`,
          duration: 6000
        };
      
      default:
        return {
          title: `❌ Failed to ${operation}`,
          message: errorData?.message || 'An unexpected error occurred',
          suggestion: `Please try again or contact support if the issue persists.`,
          duration: 5000
        };
    }
  };