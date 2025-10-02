import { Connection, ConnectionConfig, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import {
  TradeParams,
  TradeResult,
  TradeType,
  DexType,
  JupiterQuoteResponse,
  RaydiumQuote,
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
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';
import fetch from 'node-fetch'; 
import { Raydium } from '@raydium-io/raydium-sdk-v2';
import { BN } from '@coral-xyz/anchor';
import { Percent } from '@raydium-io/raydium-sdk-v2';
import { userSessions } from '../db/schema';
import { db } from '../config/database';
import { eq } from 'drizzle-orm';

export class TradingService {
  private connection: Connection;
  private jupiterApi: AxiosInstance;
  private raydiumInstance: Raydium | null = null;

  constructor() {
    const connectionConfig: ConnectionConfig = {
      commitment: 'confirmed',
      fetch: fetch as any,
    };
    
    this.connection = new Connection(env.SOLANA_RPC_URL, connectionConfig);
    
    this.jupiterApi = axios.create({
      baseURL: DEX_CONFIG.JUPITER.api_url,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  private async getRaydiumInstance(): Promise<Raydium> {
    if (!this.raydiumInstance) {
      this.raydiumInstance = await Raydium.load({
        connection: this.connection,
        cluster: 'mainnet',
      });
    }
    return this.raydiumInstance;
  }

  private async getSessionFromDatabase(sessionId: string): Promise<any> {
    try {
      const sessions = await db.select()
        .from(userSessions)
        .where(eq(userSessions.sessionId, sessionId))
        .limit(1);
      
      return sessions[0] || null;
    } catch (error) {
      logger.error('Failed to get session from database', { sessionId, error });
      return null;
    }
  }

  private async getRaydiumQuote(tradeParams: TradeParams): Promise<RaydiumQuote | null> {
    try {
      const raydium = await this.getRaydiumInstance();
      
      const poolInfo = await raydium.api.fetchPoolByMints({
        mint1: 'So11111111111111111111111111111111111111112',
        mint2: tradeParams.tokenAddress
      });

      if (!poolInfo) return null;

      const amountIn = tradeParams.type === TradeType.BUY 
        ? solToLamports(tradeParams.amount)
        : Math.floor(tradeParams.amount * Math.pow(10, 9));

      const quote = await raydium.liquidity.computeAmountOut({
        poolInfo: poolInfo as any,
        amountIn: new BN(amountIn),
        mintIn: tradeParams.type === TradeType.BUY 
          ? 'So11111111111111111111111111111111111111112'
          : tradeParams.tokenAddress,
        mintOut: tradeParams.type === TradeType.BUY 
          ? tradeParams.tokenAddress
          : 'So11111111111111111111111111111111111111112',
        slippage: Math.floor(tradeParams.slippage * 100) / 10000 
      });

      return {
        poolInfo,
        amountIn: amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        minAmountOut: quote.minAmountOut.toString(),
        priceImpact: parseFloat(quote.priceImpact.toFixed()),
        venue: 'raydium'
      };

    } catch (error) {
      logger.error('Raydium quote failed', {
        sessionId: tradeParams.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private async convertLegacyToVersionedTx(
    legacyTransaction: Transaction,
    connection: Connection,
    feePayer: PublicKey
  ): Promise<VersionedTransaction> {
    // 1. Fetch the latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');

    // 2. Create a TransactionMessage from the legacy transaction's instructions
    const messageV0 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: legacyTransaction.instructions, // Extract instructions from the legacy tx
    }).compileToV0Message(); // Compile the message into version 0 format

    // 3. Create a new VersionedTransaction
    const versionedTransaction = new VersionedTransaction(messageV0);

    return versionedTransaction;
  }

  private async executeRaydiumSwap(
    tradeParams: TradeParams,
    quote: RaydiumQuote
  ): Promise<any> {
    try {
      const raydium = await this.getRaydiumInstance();
  
      // Build the swap instruction using Raydium SDK
      const swapTx = await raydium.liquidity.swap({
        poolInfo: quote.poolInfo,
        amountIn: new BN(quote.amountIn),
        amountOut: new BN(quote.minAmountOut),
        fixedSide: 'in',
        txVersion: 0, // use 0 for versioned transactions
        feePayer: tradeParams.walletKeypair.publicKey,
        inputMint: tradeParams.tokenAddress,
      });
  
      // Convert TxBuildData into a real Transaction
      const buildResult = await swapTx.builder.build();
  
      // This is the actual VersionedTransaction object that can be signed.
      const transaction: VersionedTransaction = await this.convertLegacyToVersionedTx(buildResult.transaction, this.connection, tradeParams.walletKeypair.publicKey);
  
      // Sign with your wallet Keypair
      transaction.sign([tradeParams.walletKeypair]);
  
      // Send the signed transaction
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: true,
        maxRetries: 2,
      });
  
      const latestBlockhash = await this.connection.getLatestBlockhash();
      await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );
  
      return {
        success: true,
        signature,
        amountOut: lamportsToSol(parseInt(quote.amountOut)),
        priceImpact: quote.priceImpact,
        venue: 'raydium',
      };
    } catch (error) {
      console.error("Raydium swap execution failed:", error); // It's good practice to log the full error
      return {
        success: false,
        amountOut: 0,
        priceImpact: quote.priceImpact,
        error: error instanceof Error ? error.message : 'Raydium swap failed',
        venue: 'raydium',
      };
    }
  }
  
  async executeJupiterTrade(tradeParams: TradeParams): Promise<TradeResult> {
    const startTime = new Date();
  
    try {
      logger.info('Executing trade', {
        sessionId: tradeParams.sessionId,
        type: tradeParams.type,
        amount: tradeParams.amount,
        dex: tradeParams.dex,
        initialSlippage: tradeParams.slippage
      });
  
      // Validate trade parameters
      this.validateTradeParams(tradeParams);
  
      // Try trade with adaptive slippage
      let currentSlippage = tradeParams.slippage;
      let lastError = '';
      
      while (currentSlippage <= TRADING_CONSTANTS.MAX_SLIPPAGE) {
        try {
          logger.debug('Attempting trade with slippage', {
            sessionId: tradeParams.sessionId,
            slippage: currentSlippage
          });
  
          // Get quote with current slippage
          const quote = await this.getJupiterQuote({
            ...tradeParams,
            slippage: currentSlippage
          });
  
          if (!quote) {
            lastError = 'Failed to get quote';
            break; // No point retrying if quote fails
          }
  
          // Execute swap
          const swapResult = await this.executeJupiterSwap({
            ...tradeParams,
            slippage: currentSlippage
          }, quote);
          
          if (swapResult.success && swapResult.signature) {
            // Success! Log if we had to increase slippage
            if (currentSlippage > tradeParams.slippage) {
              logger.info('Trade succeeded with increased slippage', {
                sessionId: tradeParams.sessionId,
                originalSlippage: tradeParams.slippage,
                successfulSlippage: currentSlippage,
                attemptsNeeded: Math.ceil((currentSlippage - tradeParams.slippage) / TRADING_CONSTANTS.SLIPPAGE_INCREMENT) + 1
              });
            }
  
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
            lastError = swapResult.error || 'Swap execution failed';
            
            // Check if we should retry with higher slippage
            if (this.shouldRetryWithHigherSlippage(lastError)) {
              currentSlippage += TRADING_CONSTANTS.SLIPPAGE_INCREMENT;
              
              logger.warn('Trade failed, retrying with higher slippage', {
                sessionId: tradeParams.sessionId,
                error: lastError,
                newSlippage: currentSlippage,
                maxSlippage: TRADING_CONSTANTS.MAX_SLIPPAGE
              });
              
              continue; // Retry with higher slippage
            } else {
              break; // Error not related to slippage, don't retry
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          
          if (this.shouldRetryWithHigherSlippage(lastError)) {
            currentSlippage += TRADING_CONSTANTS.SLIPPAGE_INCREMENT;
            continue;
          } else {
            break;
          }
        }
      }
  
      // All retries failed
      logger.error('Trade failed after all slippage retries', {
        sessionId: tradeParams.sessionId,
        finalSlippage: currentSlippage - TRADING_CONSTANTS.SLIPPAGE_INCREMENT,
        maxSlippage: TRADING_CONSTANTS.MAX_SLIPPAGE,
        lastError
      });
  
      return this.createFailedTradeResult(startTime, lastError, tradeParams.amount);
  
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

  async executeTrade(tradeParams: TradeParams): Promise<TradeResult> {
    try {
      logger.info('Executing trade with venue selection', {
        sessionId: tradeParams.sessionId,
        type: tradeParams.type,
        amount: tradeParams.amount
      });

      // Get session to check preferred venue
      const session = await this.getSessionFromDatabase(tradeParams.sessionId);
      const preferredVenue = session?.preferred_venue || 'jupiter';

      // Try Jupiter first
      try {
        const jupiterResult = await this.executeJupiterTrade(tradeParams);
        if (jupiterResult.success) {
          logger.info('Trade successful on Jupiter', { 
            sessionId: tradeParams.sessionId,
            signature: jupiterResult.signature 
          });
          return jupiterResult;
        }
        
        logger.warn('Jupiter trade failed, trying Raydium fallback', {
          sessionId: tradeParams.sessionId,
          error: jupiterResult.error
        });
      } catch (error) {
        logger.warn('Jupiter trade threw error, trying Raydium fallback', {
          sessionId: tradeParams.sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Try Raydium as fallback
      try {
        const raydiumQuote = await this.getRaydiumQuote(tradeParams);
        if (raydiumQuote) {
          const raydiumResult = await this.executeRaydiumSwap(tradeParams, raydiumQuote);
          if (raydiumResult.success) {
            logger.info('Trade successful on Raydium fallback', {
              sessionId: tradeParams.sessionId,
              signature: raydiumResult.signature
            });
            
            return {
              success: true,
              signature: raydiumResult.signature,
              amountIn: tradeParams.amount,
              amountOut: raydiumResult.amountOut,
              priceImpact: raydiumResult.priceImpact,
              actualSlippage: raydiumResult.priceImpact,
              fees: this.calculateTradingFees(tradeParams.amount),
              timestamp: new Date(),
              venue: 'raydium'
            };
          }
        }
      } catch (error) {
        logger.error('Raydium fallback also failed', {
          sessionId: tradeParams.sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Both venues failed
      return this.createFailedTradeResult(
        new Date(),
        'All trading venues failed',
        tradeParams.amount
      );

    } catch (error) {
      return this.createFailedTradeResult(
        new Date(),
        error instanceof Error ? error.message : 'Unknown error',
        tradeParams.amount
      );
    }
  }

  private shouldRetryWithHigherSlippage(errorMessage: string): boolean {
    const retryableErrors = [
      'NO_ROUTES_FOUND',
      'custom program error: 1',
      'slippage',
      'price impact',
      'insufficient liquidity',
      'bonding curve',
      'Slippage exceeded'
    ];
  
    const lowerError = errorMessage.toLowerCase();
    return retryableErrors.some(error => lowerError.includes(error.toLowerCase()));
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
      const price = priceData?.price || 0

      if (price === 0) {
        logger.warn('Price API returned 0, using fallback', { tokenAddress });
        // Use fallback price source or default value
        return tokenAddress === 'So11111111111111111111111111111111111111112' ? TRADING_CONSTANTS.SOL_PRICE : 0;
      }

      return price;

    } catch (error) {
      logger.error('Failed to get token price', {
        tokenAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return tokenAddress === 'So11111111111111111111111111111111111111112' ? TRADING_CONSTANTS.SOL_PRICE : 0;
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