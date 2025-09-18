export interface TokenMetadata {
    symbol: string;
    name: string;
    decimals: number;
    supply: string;
    description?: string;
    image?: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    verified?: boolean;
  }
  
  export interface JupiterTokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    tags?: string[];
    verified?: boolean;
    daily_volume?: number;
  }
  
  export interface CoinGeckoTokenInfo {
    id: string;
    symbol: string;
    name: string;
    platforms: Record<string, string>;
    market_data?: {
      current_price?: { usd: number };
      market_cap?: { usd: number };
      total_volume?: { usd: number };
    };
    description?: { en: string };
    links?: {
      homepage?: string[];
      official_forum_url?: string[];
      twitter_screen_name?: string;
      telegram_channel_identifier?: string;
    };
  }
  
  export interface RaydiumPoolInfo {
    id: string;
    baseMint: string;
    quoteMint: string;
    lpMint: string;
    baseDecimals: number;
    quoteDecimals: number;
    lpDecimals: number;
    version: number;
    programId: string;
    authority: string;
    openOrders: string;
    targetOrders: string;
    baseVault: string;
    quoteVault: string;
    withdrawQueue: string;
    lpVault: string;
    marketVersion: number;
    marketProgramId: string;
    marketId: string;
    marketAuthority: string;
    marketBaseVault: string;
    marketQuoteVault: string;
    marketBids: string;
    marketAsks: string;
    marketEventQueue: string;
    lookupTableAccount?: string;
  }
  
  export interface JupiterPoolInfo {
    address: string;
    tokenMintA: string;
    tokenMintB: string;
    tokenVaultA: string;
    tokenVaultB: string;
    feeRate: number;
    protocolFeeRate: number;
    liquidity: string;
    volume24h: string;
    fees24h: string;
  }
  
  export interface PoolAnalysis {
    address: string;
    dex: 'jupiter' | 'raydium' | 'orca' | 'serum';
    liquidity: number;
    volume24h: number;
    priceUsd: number;
    verified: boolean;
    score: number; // Calculated score for best pool selection
    lastUpdated: Date;
  }
  
  export interface TokenValidationResult {
    valid: boolean;
    exists: boolean;
    tradeable: boolean;
    metadata: TokenMetadata;
    pools: PoolAnalysis[];
    bestPool: PoolAnalysis | null;
    liquidityUsd: number;
    primaryDex: string;
    warnings?: string[];
    errors?: string[];
  }
  
  export interface TokenPriceInfo {
    priceUsd: number;
    priceChange24h: number;
    volume24h: number;
    marketCap: number;
    lastUpdated: Date;
    source: 'jupiter' | 'coingecko' | 'raydium';
  }
  
  export enum TokenValidationError {
    INVALID_ADDRESS = 'INVALID_ADDRESS',
    TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
    NO_POOLS_FOUND = 'NO_POOLS_FOUND',
    INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
    NOT_TRADEABLE = 'NOT_TRADEABLE',
    METADATA_UNAVAILABLE = 'METADATA_UNAVAILABLE',
    NETWORK_ERROR = 'NETWORK_ERROR'
  }