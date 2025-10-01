export enum SessionEventType {
    // Funding Events
    FUNDING_DETECTED = 'funding_detected',
    REVENUE_TRANSFERRED = 'revenue_transferred',
    
    // Trading Events
    TRADING_STARTED = 'trading_started',
    TRADE_CYCLE_STARTED = 'trade_cycle_started',
    
    // Ephemeral Wallet Events
    EPHEMERAL_CREATED = 'ephemeral_created',
    EPHEMERAL_FUNDED = 'ephemeral_funded',
    
    // Trade Execution Events
    TRADE_EXECUTING = 'trade_executing',
    TRADE_COMPLETED = 'trade_completed',
    TRADE_FAILED = 'trade_failed',
    
    // Sweep Events
    SWEEP_STARTED = 'sweep_started',
    SWEEP_COMPLETED = 'sweep_completed',
    SWEEP_FAILED = 'sweep_failed',
    
    // Balance Events
    BALANCE_UPDATED = 'balance_updated',
    
    // Session State Events
    SESSION_PAUSED = 'session_paused',
    SESSION_RESUMED = 'session_resumed',
    SESSION_STOPPED = 'session_stopped',
    SESSION_COMPLETED = 'session_completed',
    
    // Error Events
    ERROR_OCCURRED = 'error_occurred'
  }
  
  export interface SessionEvent {
    id?: string;
    sessionId: string;
    eventType: SessionEventType;
    eventData?: Record<string, any>;
    status?: 'pending' | 'completed' | 'failed';
    signature?: string;
    errorMessage?: string;
    createdAt?: Date;
  }
  
  // Event Data Interfaces
  export interface FundingDetectedData {
    balance: number;
    funderAddress?: string;
    timestamp: Date;
  }
  
  export interface RevenueTransferredData {
    amount: number;
    signature: string;
    remainingBalance: number;
  }
  
  export interface TradeExecutingData {
    type: 'buy' | 'sell';
    dex: string;
    amountIn: number;
    estimatedOutput: number;
  }
  
  export interface TradeCompletedData {
    type: 'buy' | 'sell';
    signature: string;
    amountIn: number;
    amountOut: number;
    price: number;
    success: boolean;
  }
  
  export interface SweepData {
    fromAddress: string;
    toAddress: string;
    solAmount?: number;
    tokenAmount?: number;
    signature?: string;
    attempt?: number;
  }
  
  export interface BalanceUpdateData {
    currentBalance: number;
    totalTraded: number;
    depletionPercentage: number;
    tradesCount: number;
  }