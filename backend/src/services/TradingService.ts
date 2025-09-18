import { Connection, VersionedTransaction } from '@solana/web3.js';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import {
  TradeParams,
  TradeResult,
  TradeType,
  DexType,
  JupiterQuoteResponse,
} from '../types/trading';
import {
  solToLamports,
  lamportsToSol,
  retry,
} from '../utils/helpers';
import {
  DEX_CONFIG,
  API_CONFIG,
  TRADING_CONSTANTS,
  SOLANA_CONSTANTS
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';

export class TradingService {
  private connection: Connection;
  private jupiterApi: AxiosInstance;

  constructor() {
    this.connection = new Connection(env.SOLANA_RPC_URL, SOLANA_CONSTANTS.CONFIRMATION_COMMITMENT);
    
    this.jupiterApi = axios.create({
      baseURL: DEX_CONFIG.JUPITER.api_url,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  async executeTrade(tradeParams: TradeParams): Promise<TradeResult> {
    const startTime = new Date();

    try {
      logger.info('Executing trade', {
        sessionId: tradeParams.sessionId,
        type: tradeParams.type,
        amount: tradeParams.amount,
        dex: tradeParams.dex,
        slippage: tradeParams.slippage
      });

      // Validate trade parameters
      this.validateTradeParams(tradeParams);

      // Get quote from Jupiter
      const quote = await this.getJupiterQuote(tradeParams);
      if (!quote) {
        return this.createFailedTradeResult(startTime, 'Failed to get quote', tradeParams.amount);
      }

      // Execute swap
      const swapResult = await this.executeJupiterSwap(tradeParams, quote);
      
      if (swapResult.success && swapResult.signature) {
        return {
          success: true,
          signature: swapResult.signature,
          amountIn: tradeParams.amount,
          amountOut: swapResult.amountOut,
          priceImpact: swapResult.priceImpact,
          actualSlippage: this.calculateActualSlippage(tradeParams.amount, swapResult.amountOut, quote),
          fees: this.calculateTradingFees(tradeParams.amount),
          timestamp: startTime
        };
      } else {
        return this.createFailedTradeResult(startTime, swapResult.error || 'Swap execution failed', tradeParams.amount);
      }

    } catch (error) {
      logger.error('Trade execution failed', {
        sessionId: tradeParams.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        tradeParams: {
          type: tradeParams.type,
          amount: tradeParams.amount,
          dex: tradeParams.dex
        }
      });

      return this.createFailedTradeResult(
        startTime, 
        error instanceof Error ? error.message : 'Unknown error',
        tradeParams.amount
      );
    }
  }

  async validateTradeability(tokenAddress: string, dex: DexType = DexType.JUPITER): Promise<boolean> {
    try {
      logger.debug('Validating token tradeability', { tokenAddress, dex });

      // Try to get a small quote to validate tradeability
      const testQuote = await this.getJupiterQuote({
        sessionId: 'test',
        tokenAddress,
        walletKeypair: null as any,
        type: TradeType.BUY,
        amount: 0.001, // Very small test amount
        slippage: TRADING_CONSTANTS.DEFAULT_SLIPPAGE,
        dex
      });

      const tradeable = testQuote !== null;

      logger.debug('Token tradeability check completed', { 
        tokenAddress, 
        tradeable,
        dex 
      });

      return tradeable;

    } catch (error) {
      logger.warn('Token tradeability validation failed', {
        tokenAddress,
        dex,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  private validateTradeParams(tradeParams: TradeParams): void {
    if (!tradeParams.sessionId) {
      throw createError.validation('Session ID is required');
    }

    if (!tradeParams.tokenAddress) {
      throw createError.validation('Token address is required');
    }

    if (!tradeParams.walletKeypair) {
      throw createError.validation('Wallet keypair is required');
    }

    if (tradeParams.amount <= 0) {
      throw createError.validation('Trade amount must be positive');
    }

    if (tradeParams.slippage < 0 || tradeParams.slippage > TRADING_CONSTANTS.MAX_SLIPPAGE) {
      throw createError.validation(`Slippage must be between 0 and ${TRADING_CONSTANTS.MAX_SLIPPAGE}%`);
    }
  }

  private async getJupiterQuote(tradeParams: TradeParams): Promise<JupiterQuoteResponse | null> {
    try {
      const { type, tokenAddress, amount, slippage } = tradeParams;

      // Define SOL mint address
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      
      // Set input and output mints based on trade type
      const inputMint = type === TradeType.BUY ? SOL_MINT : tokenAddress;
      const outputMint = type === TradeType.BUY ? tokenAddress : SOL_MINT;
      
      // Convert amount to lamports for SOL trades
      const amountLamports = type === TradeType.BUY 
        ? solToLamports(amount)
        : Math.floor(amount * Math.pow(10, 9)); // Assume 9 decimals for tokens

      const quoteParams = {
        inputMint,
        outputMint,
        amount: amountLamports.toString(),
        slippageBps: Math.floor(slippage * 100), // Convert percentage to basis points
        onlyDirectRoutes: false,
        asLegacyTransaction: false
      };

      logger.debug('Requesting Jupiter quote', {
        sessionId: tradeParams.sessionId,
        quoteParams
      });

      const response = await retry(async () => {
        return await this.jupiterApi.get(DEX_CONFIG.JUPITER.quote_endpoint, {
          params: quoteParams
        });
      }, API_CONFIG.MAX_RETRIES, API_CONFIG.RETRY_DELAY_MS);

      if (!response.data) {
        logger.warn('Empty quote response from Jupiter', { sessionId: tradeParams.sessionId });
        return null;
      }

      const quote: JupiterQuoteResponse = response.data;

      logger.debug('Jupiter quote received', {
        sessionId: tradeParams.sessionId,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
        priceImpact: quote.priceImpactPct
      });

      return quote;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('Jupiter quote API error', {
          sessionId: tradeParams.sessionId,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
      } else {
        logger.error('Jupiter quote error', {
          sessionId: tradeParams.sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      return null;
    }
  }

  private async executeJupiterSwap(
    tradeParams: TradeParams, 
    quote: JupiterQuoteResponse
  ): Promise<{ success: boolean; signature?: string; amountOut: number; priceImpact: number; error?: string }> {
    try {
      logger.debug('Executing Jupiter swap', {
        sessionId: tradeParams.sessionId,
        quote: {
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          priceImpact: quote.priceImpactPct
        }
      });

      // Get swap transaction from Jupiter
      const swapResponse = await retry(async () => {
        return await this.jupiterApi.post(DEX_CONFIG.JUPITER.swap_endpoint, {
          quoteResponse: quote,
          userPublicKey: tradeParams.walletKeypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto'
        });
      }, API_CONFIG.MAX_RETRIES, API_CONFIG.RETRY_DELAY_MS);

      if (!swapResponse.data || !swapResponse.data.swapTransaction) {
        return {
          success: false,
          amountOut: 0,
          priceImpact: parseFloat(quote.priceImpactPct),
          error: 'Failed to get swap transaction from Jupiter'
        };
      }

      // Deserialize and sign transaction
      const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      
      // Sign transaction
      transaction.sign([tradeParams.walletKeypair]);

      // Send transaction
      const signature = await retry(async () => {
        // Serialize the transaction
        const rawTransaction = transaction.serialize();
        
        // Send the raw transaction
        const txid = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
          maxRetries: 2
        });
        
        // Confirm the transaction
        const latestBlockHash = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: txid
        });

        return txid;
      }, 2, 2000);

      const amountOut = lamportsToSol(parseInt(quote.outAmount));
      const priceImpact = parseFloat(quote.priceImpactPct);

      logger.info('Jupiter swap executed successfully', {
        sessionId: tradeParams.sessionId,
        signature,
        amountOut,
        priceImpact
      });

      return {
        success: true,
        signature,
        amountOut,
        priceImpact
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown swap error';
      
      logger.error('Jupiter swap execution failed', {
        sessionId: tradeParams.sessionId,
        error: errorMessage
      });

      return {
        success: false,
        amountOut: 0,
        priceImpact: parseFloat(quote.priceImpactPct),
        error: errorMessage
      };
    }
  }

  private calculateActualSlippage(
    expectedAmount: number, 
    actualAmount: number, 
    quote: JupiterQuoteResponse
  ): number {
    try {
      const expectedOut = lamportsToSol(parseInt(quote.outAmount));
      const slippage = Math.abs((expectedOut - actualAmount) / expectedOut) * 100;
      return Math.min(slippage, TRADING_CONSTANTS.MAX_SLIPPAGE);
    } catch {
      return 0;
    }
  }

  private calculateTradingFees(tradeAmount: number): number {
    // Jupiter typically charges ~0.25% in fees
    return tradeAmount * 0.0025;
  }

  private createFailedTradeResult(
    timestamp: Date, 
    error: string, 
    amountIn: number
  ): TradeResult {
    return {
      success: false,
      error,
      amountIn,
      amountOut: 0,
      priceImpact: 0,
      actualSlippage: 0,
      fees: 0,
      timestamp
    };
  }

  async getTokenPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await this.jupiterApi.get(DEX_CONFIG.JUPITER.price_endpoint, {
        params: {
          ids: tokenAddress
        }
      });

      const priceData = response.data?.data?.[tokenAddress];
      return priceData?.price || 0;

    } catch (error) {
      logger.error('Failed to get token price', {
        tokenAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  async estimateTradeImpact(tradeParams: TradeParams): Promise<{
    priceImpact: number;
    estimatedOutput: number;
    minimumOutput: number;
  }> {
    try {
      const quote = await this.getJupiterQuote(tradeParams);
      
      if (!quote) {
        return {
          priceImpact: 0,
          estimatedOutput: 0,
          minimumOutput: 0
        };
      }

      const estimatedOutput = lamportsToSol(parseInt(quote.outAmount));
      const priceImpact = parseFloat(quote.priceImpactPct);
      const minimumOutput = estimatedOutput * (1 - tradeParams.slippage / 100);

      return {
        priceImpact,
        estimatedOutput,
        minimumOutput
      };

    } catch (error) {
      logger.error('Failed to estimate trade impact', {
        sessionId: tradeParams.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        priceImpact: 0,
        estimatedOutput: 0,
        minimumOutput: 0
      };
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Trading service cleaned up');
  }
}