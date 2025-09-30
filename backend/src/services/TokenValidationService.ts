import { Connection, ConnectionConfig, PublicKey } from '@solana/web3.js';
import axios, { AxiosInstance } from 'axios';
import fetch from 'node-fetch'; 
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { 
  TokenValidationResponse, 
  PoolInfo, 
  BestPoolInfo 
} from '../types/api';
import {
  TokenMetadata,
  JupiterTokenInfo,
  PoolAnalysis,
} from '../types/token';
import {
  isValidSolanaAddress,
  hasMinimumLiquidity,
  calculatePoolScore,
  retry,
  sanitizeErrorMessage,
} from '../utils/helpers';
import { 
  DEX_CONFIG, 
  API_CONFIG, 
  TRADING_CONSTANTS,
  ERROR_CODES 
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';
import { db } from '../config/database';
import { tokens } from '../db/schema';

export class TokenValidationService {
  private connection: Connection;
  private jupiterApi: AxiosInstance;
  private dexScreenerApi: AxiosInstance;

  constructor() {
    const connectionConfig: ConnectionConfig = {
      commitment: 'confirmed',
      fetch: fetch as any,
    };
    
    this.connection = new Connection(env.SOLANA_RPC_URL, connectionConfig);

    this.dexScreenerApi = axios.create({
      baseURL: DEX_CONFIG.DEXSCREENER.api_url,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
    this.jupiterApi = axios.create({
      baseURL: DEX_CONFIG.JUPITER.api_url,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  

  async validateToken(contractAddress: string): Promise<TokenValidationResponse> {
    try {
      logger.info('Starting token validation', { contractAddress });

      // Basic validation
      if (!isValidSolanaAddress(contractAddress)) {
        throw createError.validation('Invalid contract address format');
      }

      // Check if token exists on blockchain
      let tokenExists: boolean;
      try {
        tokenExists = await this.checkTokenExists(contractAddress);
      } catch (error) {
        // If we can't verify existence due to RPC issues, return a specific error
        logger.error('RPC connection failed during token validation', {
          contractAddress,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return {
          success: false,
          valid: false,
          contractAddress,
          token: { symbol: '', name: '', decimals: 0, supply: '0' },
          primaryDex: '',
          liquidityUsd: 0,
          pools: [],
          bestPool: { address: '', dex: '', liquidity: 0, volume24h: 0, priceUsd: 0, reason: '' },
          error: 'Unable to connect to Solana network. Please try again in a moment.'
        };
      }
  
      if (!tokenExists) {
        return this.createErrorResponse(
          contractAddress,
          'Token not found on blockchain',
          ERROR_CODES.TOKEN_NOT_FOUND
        );
      }

      // Get token metadata from multiple sources
      const metadata = await this.getTokenMetadata(contractAddress);
      
      // Find all available pools
      const pools = await this.findAllPools(contractAddress);
      
      if (pools.length === 0) {
        return this.createErrorResponse(
          contractAddress,
          'No trading pools found for this token',
          ERROR_CODES.NO_POOLS_FOUND
        );
      }

      // Select best pool
      const bestPool = this.selectBestPool(pools);
      
      if (!bestPool || !hasMinimumLiquidity(bestPool.liquidity, TRADING_CONSTANTS.MIN_LIQUIDITY_USD)) {
        return this.createErrorResponse(
          contractAddress,
          'Insufficient liquidity for trading',
          ERROR_CODES.INSUFFICIENT_LIQUIDITY
        );
      }

      // Cache token data
      await this.cacheTokenData(contractAddress, metadata, pools, bestPool);

      // Build successful response
      const response: TokenValidationResponse = {
        success: true,
        valid: true,
        contractAddress,
        token: {
          symbol: metadata.symbol,
          name: metadata.name,
          decimals: metadata.decimals,
          supply: metadata.supply
        },
        primaryDex: bestPool.dex,
        liquidityUsd: bestPool.liquidity,
        pools: pools.map(this.mapPoolToApiFormat),
        bestPool: this.mapBestPoolToApiFormat(bestPool)
      };

      logger.info('Token validation completed successfully', {
        contractAddress,
        symbol: metadata.symbol,
        poolsFound: pools.length,
        bestPoolDex: bestPool.dex,
        liquidity: bestPool.liquidity
      });

      return response;

    } catch (error) {
      logger.error('Token validation failed', {
        contractAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof Error && error.message.includes('validation')) {
        throw error;
      }

      return this.createErrorResponse(
        contractAddress,
        'Token validation failed',
        ERROR_CODES.TOKEN_NOT_FOUND
      );
    }
  }

  private async checkTokenExists(contractAddress: string): Promise<boolean> {
    const maxRetries = 3;
    let lastError: Error | null = null;
  
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const publicKey = new PublicKey(contractAddress);
        const accountInfo = await this.connection.getAccountInfo(publicKey);
        
        if (attempt > 1) {
          logger.info('Token existence check succeeded after retry', { 
            contractAddress, 
            attempt,
            exists: accountInfo !== null 
          });
        }
        
        return accountInfo !== null;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < maxRetries) {
          const delay = 1000 * attempt;
          logger.warn(`Token existence check failed, retrying in ${delay}ms`, {
            contractAddress,
            attempt,
            error: sanitizeErrorMessage(lastError), // ← Sanitize here
            nextAttempt: attempt + 1
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  
    // All retries failed
    logger.error('Token existence check failed after all retries', {
      contractAddress,
      error: sanitizeErrorMessage(lastError), // ← And here
      attempts: maxRetries
    });
  
    throw new Error(`Unable to verify token existence after ${maxRetries} attempts: ${sanitizeErrorMessage(lastError)}`);
  }

  private async getTokenMetadata(contractAddress: string): Promise<TokenMetadata> {
    const metadata: Partial<TokenMetadata> = {
      symbol: '',
      name: '',
      decimals: 0,
      supply: '0'
    };

    // Try Jupiter first
    try {
      const jupiterData = await this.getJupiterTokenMetadata(contractAddress);
      if (jupiterData) {
        metadata.symbol = jupiterData.symbol;
        metadata.name = jupiterData.name;
        metadata.decimals = jupiterData.decimals;
        metadata.verified = jupiterData.verified;
      }
    } catch (error) {
      logger.warn('Failed to get Jupiter metadata', { contractAddress, error });
    }

    if (!metadata.symbol || !metadata.name) {
      try {
        const dexScreenerData = await this.getDexScreenerTokenMetadata(contractAddress);
        if (dexScreenerData) {
          metadata.symbol = metadata.symbol || dexScreenerData.symbol;
          metadata.name = metadata.name || dexScreenerData.name;
          metadata.verified = metadata.verified || dexScreenerData.verified;
        }
      } catch (error) {
        logger.warn('Failed to get DexScreener metadata', { contractAddress, error });
      }
    }

    // Get token supply from blockchain
    try {
      const supply = await this.getTokenSupply(contractAddress);
      metadata.supply = supply.toString();
    } catch (error) {
      logger.warn('Failed to get token supply', { contractAddress, error });
    }

    // Validate required fields
    if (!metadata.symbol) metadata.symbol = 'UNKNOWN';
    if (!metadata.name) metadata.name = 'Unknown Token';
    if (!metadata.decimals) metadata.decimals = 9; // Default SOL decimals

    return metadata as TokenMetadata;
  }

  private async getDexScreenerTokenMetadata(contractAddress: string): Promise<TokenMetadata | null> {
    try {
      const response = await retry(async () => {
        return await this.dexScreenerApi.get(
          `${DEX_CONFIG.DEXSCREENER.tokens_endpoint}/${contractAddress}`
        );
      });
  
      const data = response.data;
      if (!data || !Array.isArray(data.pairs) || data.pairs.length === 0) {
        return null;
      }
  
      // Pick first pair as representative metadata (you could also rank/select best pool here)
      const pair = data.pairs[0];
  
      const metadata: TokenMetadata = {
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        name: pair.baseToken?.name || 'Unknown Token',
        decimals: 9, 
        supply: '0', 
        verified: Array.isArray(pair.labels) && pair.labels.includes('verified')
      };
  
      return metadata;
    } catch (error) {
      logger.error('DexScreener API metadata error', { contractAddress, error });
      return null;
    }
  }
  

  private async getJupiterTokenMetadata(contractAddress: string): Promise<JupiterTokenInfo | null> {
    try {
      const response = await retry(async () => {
        return await this.jupiterApi.get(
          `${DEX_CONFIG.JUPITER.tokens_endpoint}/search?query=${contractAddress}`
        );
      });
  
      const tokens: any[] = response.data || [];
      if (!Array.isArray(tokens) || tokens.length === 0) {
        return null;
      }
  
      const token = tokens[0];
  
      const tokenInfo: JupiterTokenInfo = {
        address: token.id,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoURI: token.icon,
        tags: token.tags ?? [],
        verified: Boolean(token.audit?.mintAuthorityDisabled && token.audit?.freezeAuthorityDisabled),
        daily_volume: token.stats24h?.buyVolume + token.stats24h?.sellVolume || 0,
      };
  
      return tokenInfo;
    } catch (error) {
      logger.error('Jupiter API error', { contractAddress, error });
      return null;
    }
  }


  private async getTokenSupply(contractAddress: string): Promise<number> {
    try {
      const publicKey = new PublicKey(contractAddress);
      const supply = await this.connection.getTokenSupply(publicKey);
      return supply.value.uiAmount || 0;
    } catch (error) {
      logger.error('Error getting token supply', { contractAddress, error });
      return 0;
    }
  }

  private async findAllPools(contractAddress: string): Promise<PoolAnalysis[]> {
    const pools: PoolAnalysis[] = [];
  
    try {
      const dexScreenerPools = await this.getDexScreenerPools(contractAddress);
      pools.push(...dexScreenerPools);

      const jupiterPools = await this.getJupiterPools(contractAddress);
      pools.push(...jupiterPools);
    } catch (error) {
      logger.warn('Failed to get pools', { contractAddress, error });
    }
  
    // Calculate scores for ranking
    pools.forEach(pool => {
      pool.score = calculatePoolScore(pool.liquidity, pool.volume24h, pool.verified);
    });
  
    return pools.sort((a, b) => b.score - a.score);
  }

  private async getJupiterPools(contractAddress: string): Promise<PoolAnalysis[]> {
    try {
      const response = await retry(async () => {
        return await this.jupiterApi.get(
          `${DEX_CONFIG.JUPITER.tokens_endpoint}/search?query=${contractAddress}`
        );
      }, API_CONFIG.MAX_RETRIES, API_CONFIG.RETRY_DELAY_MS);
  
      const tokens = response.data || [];
      if (!Array.isArray(tokens) || tokens.length === 0) {
        return [];
      }
  
      const token = tokens[0]; 

      // Liquidity and stats come directly from Jupiter response
      const liquidity = token.liquidity || 0;
      const volume24h =
        (token.stats24h?.buyVolume || 0) + (token.stats24h?.sellVolume || 0);
  
      const pool: PoolAnalysis = {
        address: token.firstPool?.id || token.id,
        dex: 'jupiter',
        liquidity: liquidity,
        volume24h: volume24h,
        priceUsd: token.usdPrice ? parseFloat(token.usdPrice) : 0,
        verified: Boolean(
          token.audit?.mintAuthorityDisabled && token.audit?.freezeAuthorityDisabled
        ),
        score: 0, 
        lastUpdated: new Date(),
      };
  
      return [pool];
    } catch (error) {
      logger.error('Jupiter API error in getJupiterPools', {
        contractAddress,
        error,
      });
      return [];
    }
  }
  

  private async getDexScreenerPools(contractAddress: string): Promise<PoolAnalysis[]> {
    try {
      const response = await retry(async () => {
        return await this.dexScreenerApi.get(
          `${DEX_CONFIG.DEXSCREENER.tokens_endpoint}/${contractAddress}`
        );
      }, API_CONFIG.MAX_RETRIES, API_CONFIG.RETRY_DELAY_MS);
  
      const pairs = response.data.pairs || [];
  
      return pairs.map((pair: any): PoolAnalysis => ({
        address: pair.pairAddress, 
        dex: pair.dexId, 
        liquidity: pair.liquidity?.usd || 0, 
        volume24h: pair.volume?.h24 || 0,   
        priceUsd: pair.priceUsd ? parseFloat(pair.priceUsd) : 0, 
        verified: Array.isArray(pair.labels) && pair.labels.length > 0,
        score: 0,
        lastUpdated: new Date()
      }));
    } catch (error) {
      logger.error('DexScreener API error', { contractAddress, error });
      return [];
    }
  }
  
  private selectBestPool(pools: PoolAnalysis[]): PoolAnalysis | null {
    if (pools.length === 0) return null;

    // Filter pools with minimum liquidity
    const liquidPools = pools.filter(pool => 
      hasMinimumLiquidity(pool.liquidity, TRADING_CONSTANTS.MIN_LIQUIDITY_USD)
    );

    if (liquidPools.length === 0) {
      // If no pools meet minimum liquidity, return the best available
      return pools[0];
    }

    // Return highest scored pool with sufficient liquidity
    return liquidPools[0];
  }

  private async cacheTokenData(
    contractAddress: string,
    metadata: TokenMetadata,
    pools: PoolAnalysis[],
    bestPool: PoolAnalysis
  ): Promise<void> {
    try {
      await db.insert(tokens).values({
        contractAddress,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        supply: metadata.supply,
        verified: metadata.verified || false,
        metadata: metadata,
        poolData: pools,
        bestPoolAddress: bestPool.address,
        primaryDex: bestPool.dex,
        liquidityUsd: bestPool.liquidity.toString(),
        lastValidated: new Date()
      }).onConflictDoUpdate({
        target: tokens.contractAddress,
        set: {
          symbol: metadata.symbol,
          name: metadata.name,
          metadata: metadata,
          poolData: pools,
          bestPoolAddress: bestPool.address,
          primaryDex: bestPool.dex,
          liquidityUsd: bestPool.liquidity.toString(),
          lastValidated: new Date(),
          updatedAt: new Date()
        }
      });
    } catch (error) {
      logger.error('Failed to cache token data', { contractAddress, error });
      // Don't throw - caching is not critical
    }
  }

  private mapPoolToApiFormat(pool: PoolAnalysis): PoolInfo {
    return {
      address: pool.address,
      dex: pool.dex,
      liquidity: pool.liquidity,
      volume24h: pool.volume24h,
      priceUsd: pool.priceUsd,
      verified: pool.verified
    };
  }

  private mapBestPoolToApiFormat(pool: PoolAnalysis): BestPoolInfo {
    return {
      address: pool.address,
      dex: pool.dex,
      liquidity: pool.liquidity,
      volume24h: pool.volume24h,
      priceUsd: pool.priceUsd,
      reason: `Highest liquidity and trading volume on ${pool.dex}`
    };
  }

  private createErrorResponse(
    contractAddress: string,
    message: string,
    code: string
  ): TokenValidationResponse {
    return {
      success: false,
      valid: false,
      contractAddress,
      token: {
        symbol: '',
        name: '',
        decimals: 0,
        supply: '0'
      },
      primaryDex: '',
      liquidityUsd: 0,
      pools: [],
      bestPool: {
        address: '',
        dex: '',
        liquidity: 0,
        volume24h: 0,
        priceUsd: 0,
        reason: ''
      },
      error: message
    };
  }
}