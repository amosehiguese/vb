import { Keypair, ConnectionConfig, PublicKey, Connection, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, getOrCreateAssociatedTokenAccount, getAccount, createCloseAccountInstruction } from '@solana/spl-token';
import crypto from 'crypto';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { db } from '../config/database';
import { userSessions, walletBalances, ephemeralWallets } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  WalletInfo,
  FundingTierName,
} from '../types/session';
import {
  lamportsToSol,
  hasSufficientFunding,
  solToLamports,
  calculateRevenue,
  delay,
  sanitizeErrorMessage
} from '../utils/helpers';
import {
  TRADING_CONSTANTS,
  PRIVILEGED_WALLET_ADDRESSES,
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';
import fetch from 'node-fetch'; 

export class WalletManagementService {
  private connection: Connection;
  private walletCache: Map<string, WalletInfo> = new Map();
  private privilegedWallets: Set<string> = new Set();

  private walletSubscriptions: Map<string, { subscriptionId: number; callback: (balance: number) => void }> = new Map();
  private subscriptionRetries: Map<string, number> = new Map();
  private isConnected: boolean = true;

  private readonly encryptionKey = crypto.scryptSync(
    env.WALLET_ENCRYPTION_PASSWORD,
    'salt',
    32
  );

  constructor() {
    const connectionConfig: ConnectionConfig = {
      commitment: 'confirmed',
      fetch: fetch as any, 
    };
  
    this.connection = new Connection(env.SOLANA_RPC_URL, connectionConfig);
    this.initializePrivilegedWallets();
    this.setupConnectionMonitoring();
  }

  private initializePrivilegedWallets(): void {
    PRIVILEGED_WALLET_ADDRESSES.forEach(address => {
      this.privilegedWallets.add(address);
    });

    const envPrivilegedWallets = env.PRIVILEGED_WALLETS;
    if (envPrivilegedWallets) {
      envPrivilegedWallets.split(',').forEach(address => {
        this.privilegedWallets.add(address.trim());
      });
    }
  }

  private setupConnectionMonitoring(): void {
    let consecutiveFailures = 0;
    const maxFailures = 5;

    const healthCheck = async () => {
      try {
        // Health check with timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 10000)
        );

        const healthPromise = this.connection.getSlot();
        
        await Promise.race([healthPromise, timeoutPromise]);

        if (!this.isConnected) {
          logger.info('WebSocket connection restored, resubscribing to wallets');
          this.isConnected = true;
          consecutiveFailures = 0;
          await this.resubscribeAllWallets();
        }
      } catch (error) {
        consecutiveFailures++;
        let lastErr = error instanceof Error ? error.message : 'Unknown error'
        if (this.isConnected) {
          logger.warn('WebSocket connection lost, will attempt to resubscribe', {
            consecutiveFailures,
            error: sanitizeErrorMessage(lastErr)
          });
          this.isConnected = false;
        }

        // If too many consecutive failures, try to recreate connection
        if (consecutiveFailures >= maxFailures) {
          logger.error('Too many consecutive connection failures, recreating connection');
          await this.recreateConnection();
          consecutiveFailures = 0;
        }
      }
    };

    // Check connection every 30 seconds instead of more frequent checks
    setInterval(healthCheck, 30000);
  }

  private async recreateConnection(): Promise<void> {
    try {
      // Create new connection
      const connectionConfig: ConnectionConfig = {
        commitment: 'confirmed',
        fetch: fetch as any,
      };

      this.connection = new Connection(env.SOLANA_RPC_URL, connectionConfig);
      this.isConnected = true;
      
      logger.info('Connection recreated successfully');
      
      // Resubscribe to all wallets
      await this.resubscribeAllWallets();
    } catch (error) {
      logger.error('Failed to recreate connection', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async resubscribeAllWallets(): Promise<void> {
    const walletsToResubscribe = Array.from(this.walletSubscriptions.keys());
    
    for (const address of walletsToResubscribe) {
      const subscription = this.walletSubscriptions.get(address);
      if (subscription) {
        logger.info('Resubscribing to wallet', { address });
        // Remove old subscription and create new one
        await this.stopWalletMonitoring(address);
        await this.monitorWalletBalance(address, subscription.callback);
      }
    }
  }

  async createUserWallet(sessionId?: string): Promise<WalletInfo> {
    try {
      logger.info('Creating new user wallet', { sessionId });

      // Generate new keypair
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toString();
      const address = publicKey;

      // Check if this is a privileged wallet
      const isPrivileged = this.privilegedWallets.has(address);
      const minDeposit = isPrivileged 
        ? TRADING_CONSTANTS.MIN_PRIVILEGED_WALLET_DEPOSIT 
        : TRADING_CONSTANTS.MIN_WALLET_DEPOSIT;

      // Encrypt private key for storage
      const encryptedPrivateKey = this.encryptPrivateKey(keypair.secretKey);

      const walletInfo: WalletInfo = {
        publicKey,
        address,
        privateKey: encryptedPrivateKey,
        isPrivileged,
        minDeposit,
        balance: 0
      };

      // Cache wallet info (without private key for security)
      this.walletCache.set(address, {
        ...walletInfo,
        keypair, // Keep keypair in memory for trading
        privateKey: '' // Don't cache encrypted private key
      });

      logger.info('User wallet created successfully', {
        address,
        isPrivileged,
        minDeposit,
        sessionId
      });

      return walletInfo;

    } catch (error) {
      logger.error('Failed to create user wallet', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId
      });
      throw createError.internal('Failed to create wallet');
    }
  }

  async createAndStoreEphemeralWallet(sessionId: string): Promise<Keypair> {
    try {
        const keypair = Keypair.generate();
        const encryptedPrivateKey = this.encryptPrivateKey(keypair.secretKey);

        await db.insert(ephemeralWallets).values({
            sessionId,
            walletAddress: keypair.publicKey.toString(),
            privateKey: encryptedPrivateKey,
            status: 'created',
        });

        logger.info('Created and stored ephemeral wallet', { sessionId, address: keypair.publicKey.toString() });
        return keypair;
    } catch (error) {
        logger.error('Failed to create ephemeral wallet', { sessionId, error });
        throw createError.database('Could not create ephemeral wallet');
    }
  }

  async transferFunds(fromKeypair: Keypair, toAddress: string, amountSol: number): Promise<string> {
    try {
        const toPubkey = new PublicKey(toAddress);
        const lamports = solToLamports(amountSol);

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey,
                lamports,
            })
        );

        const signature = await sendAndConfirmTransaction(this.connection, transaction, [fromKeypair]);
        logger.info('Transferred funds successfully', { from: fromKeypair.publicKey.toString(), to: toAddress, amountSol, signature });
        return signature;
    } catch (error) {
        logger.error('Fund transfer failed', { from: fromKeypair.publicKey.toString(), to: toAddress, amountSol, error });
        throw createError.network('Fund transfer failed');
    }
  }

  async transferToken(fromKeypair: Keypair, toAddress: string, tokenMintAddress: string, amount: number): Promise<string> {
    const fromPublicKey = fromKeypair.publicKey;
    const toPublicKey = new PublicKey(toAddress);
    const mintPublicKey = new PublicKey(tokenMintAddress);

    const fromTokenAccountAddress = await getAssociatedTokenAddress(
      mintPublicKey,
      fromPublicKey
    );

    // Explicitly verify the account exists before trying to use it.
    try {
        await getAccount(this.connection, fromTokenAccountAddress);
    } catch (e) {
        if (e instanceof Error && e.name === 'TokenAccountNotFoundError') {
            logger.error('Source token account NOT FOUND during transfer.', {
                owner: fromPublicKey.toString(),
                mint: tokenMintAddress,
                ataAddress: fromTokenAccountAddress.toString()
            });
        }
        // Re-throw the error to stop the cycle.
        throw e;
    }

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(this.connection, fromKeypair, mintPublicKey, toPublicKey);

    const transaction = new Transaction().add(
      createTransferInstruction(fromTokenAccountAddress, toTokenAccount.address, fromPublicKey, amount)
    );

    const signature = await sendAndConfirmTransaction(this.connection, transaction, [fromKeypair]);
    logger.info('SPL Token transferred', { from: fromPublicKey.toString(), to: toAddress, token: tokenMintAddress, amount, signature });
    return signature;
  }

  async sweepAssets(ephemeralKeypair: Keypair, vaultAddress: string, tokenMintAddress: string): Promise<void> {
    const ephemeralPublicKey = ephemeralKeypair.publicKey;
    const vaultPublicKey = new PublicKey(vaultAddress);
    const mintPublicKey = new PublicKey(tokenMintAddress);

    // Sweep SPL Token and Reclaim Rent 
    try {
        const tokenAta = await getAssociatedTokenAddress(mintPublicKey, ephemeralPublicKey);
        const tokenAccountInfo = await this.connection.getAccountInfo(tokenAta);

        if (tokenAccountInfo) {
            const vaultAta = await getOrCreateAssociatedTokenAccount(this.connection, ephemeralKeypair, mintPublicKey, vaultPublicKey);
            const balance = await this.getTokenBalance(ephemeralPublicKey.toString(), tokenMintAddress, true);

            const transaction = new Transaction();
            // First, transfer any remaining tokens
            if (balance > 0) {
                transaction.add(
                    createTransferInstruction(tokenAta, vaultAta.address, ephemeralPublicKey, balance)
                );
            }

            // Next, close the ephemeral account to reclaim the rent SOL
            transaction.add(
                createCloseAccountInstruction(tokenAta, vaultPublicKey, ephemeralPublicKey)
            );
            
            await sendAndConfirmTransaction(this.connection, transaction, [ephemeralKeypair]);
            logger.info('Swept SPL token and closed ephemeral token account.', { ephemeralAddress: ephemeralPublicKey.toString() });
        }
    } catch (error) {
        logger.warn('Could not sweep SPL token from ephemeral wallet (might be empty or already closed).', { ephemeralAddress: ephemeralPublicKey.toString(), error: error instanceof Error ? error.message : error });
    }

    // Sweep Remaining SOL 
    try {
        // A small delay to ensure the close account transaction is reflected in the balance
        await delay(1500); 
        
        const solBalance = await this.connection.getBalance(ephemeralPublicKey);
        const fee = 5000; // Fee for the sweep transaction itself
        
        if (solBalance > fee) {
            const transferAmount = solBalance - fee;
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: ephemeralPublicKey,
                    toPubkey: vaultPublicKey,
                    lamports: transferAmount,
                })
            );
            await sendAndConfirmTransaction(this.connection, transaction, [ephemeralKeypair]);
            logger.info('Swept remaining SOL from ephemeral wallet', { ephemeralAddress: ephemeralPublicKey.toString(), amount: lamportsToSol(transferAmount) });
        }
    } catch (error) {
        logger.error('Failed to sweep SOL from ephemeral wallet', { ephemeralAddress: ephemeralPublicKey.toString(), error: error instanceof Error ? error.message : error });
    } finally {
        await db.update(ephemeralWallets).set({ status: 'swept' }).where(eq(ephemeralWallets.walletAddress, ephemeralPublicKey.toString()));
    }
  }

  async getWalletByAddress(address: string): Promise<WalletInfo | null> {
    try {
      // Check cache first
      const cachedWallet = this.walletCache.get(address);
      if (cachedWallet) {
        return cachedWallet;
      }

      // Query database
      const sessions = await db.select().from(userSessions).where(eq(userSessions.walletAddress, address));
      
      if (sessions.length === 0) {
        return null;
      }

      const session = sessions[0];
      const isPrivileged = session.isPrivileged || false;
      const minDeposit = isPrivileged 
        ? TRADING_CONSTANTS.MIN_PRIVILEGED_WALLET_DEPOSIT 
        : TRADING_CONSTANTS.MIN_WALLET_DEPOSIT;

      // Decrypt private key
      const decryptedPrivateKey = this.decryptPrivateKey(session.privateKey);
      const keypair = Keypair.fromSecretKey(decryptedPrivateKey);

      const walletInfo: WalletInfo = {
        publicKey: address,
        address,
        privateKey: session.privateKey, // Keep encrypted for external use
        keypair, // Decrypted keypair for internal use
        isPrivileged,
        minDeposit,
        balance: parseFloat(session.currentBalance || '0')
      };

      // Cache wallet (without encrypted private key)
      this.walletCache.set(address, {
        ...walletInfo,
        privateKey: ''
      });

      return walletInfo;

    } catch (error) {
      logger.error('Failed to get wallet by address', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async getWalletBalance(walletAddress: string): Promise<number> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const publicKey = new PublicKey(walletAddress);
        const balance = await this.connection.getBalance(publicKey, 'confirmed');
        
        // Cache the balance
        const balanceInSol = lamportsToSol(balance);
        this.walletCache.set(walletAddress, { 
          ...this.walletCache.get(walletAddress),
          balance: balanceInSol,
          lastUpdated: new Date()
        } as WalletInfo);

        return balanceInSol;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < maxRetries) {
          const delay = 1000 * attempt; // Increasing delay
          logger.warn(`Failed to get wallet balance, retrying in ${delay}ms`, {
            address: walletAddress,
            attempt,
            error: lastError.message
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('Failed to get wallet balance after all retries', {
      address: walletAddress,
      error: lastError?.message
    });

    // Return cached balance if available
    const cached = this.walletCache.get(walletAddress);
    if (cached?.balance !== undefined) {
      logger.warn('Returning cached balance due to RPC failure', {
        address: walletAddress,
        cachedBalance: cached.balance
      });
      return cached.balance;
    }

    throw lastError || new Error('Failed to get wallet balance');
  }

  async getTokenBalance(walletAddress: string, tokenMintAddress: string, rawAmount = false): Promise<number> {
    try {
        const walletPublicKey = new PublicKey(walletAddress);
        const tokenMintPublicKey = new PublicKey(tokenMintAddress);
        const ataAddress = await getAssociatedTokenAddress(tokenMintPublicKey, walletPublicKey);
        const accountInfo = await this.connection.getParsedAccountInfo(ataAddress);

        if (!accountInfo.value) return 0;

        const data = accountInfo.value.data as any;
        const tokenAmount = data.parsed?.info?.tokenAmount;
        
        if (!tokenAmount) return 0;

        return rawAmount ? parseFloat(tokenAmount.amount) : tokenAmount.uiAmount;
    } catch (error) {
        if (error instanceof Error && error.message.includes("could not find account")) {
            return 0;
        }
        logger.error('Failed to get token balance', { walletAddress, tokenMintAddress, error });
        return 0;
    }
  }

  async monitorWalletBalance(address: string, callback: (balance: number) => void): Promise<void> {
    try {
      // Check if already monitoring this address
      if (this.walletSubscriptions.has(address)) {
        logger.warn('Wallet already being monitored, stopping previous subscription', { address });
        await this.stopWalletMonitoring(address);
      }

      const publicKey = new PublicKey(address);

      // Initial balance check
      const initialBalance = await this.getWalletBalance(address);
      callback(initialBalance);

      // Set up WebSocket subscription for real-time updates
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        (accountInfo, context) => {
          try {
            const balance = lamportsToSol(accountInfo.lamports);
            
            // Update cache
            const cachedWallet = this.walletCache.get(address);
            if (cachedWallet) {
              cachedWallet.balance = balance;
            }

            logger.debug('Wallet balance changed via WebSocket', { 
              address, 
              balance, 
              slot: context.slot 
            });

            callback(balance);
            
            // Reset retry counter on successful update
            this.subscriptionRetries.delete(address);
          } catch (error) {
            logger.error('Error processing wallet balance change', { address, error });
          }
        },
        'confirmed'
      );

      // Store subscription info
      this.walletSubscriptions.set(address, { subscriptionId, callback });
      this.subscriptionRetries.delete(address); // Reset retry counter

      logger.info('Started WebSocket wallet balance monitoring', { 
        address, 
        subscriptionId 
      });

    } catch (error) {
      logger.error('Failed to start wallet monitoring', { address, error });
      
      // Implement fallback with exponential backoff
      const retryCount = this.subscriptionRetries.get(address) || 0;
      if (retryCount < 3) {
        this.subscriptionRetries.set(address, retryCount + 1);
        const retryDelay = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
        
        logger.info('Retrying wallet monitoring subscription', { 
          address, 
          retryCount: retryCount + 1, 
          retryDelay 
        });
        
        setTimeout(() => {
          this.monitorWalletBalance(address, callback);
        }, retryDelay);
      } else {
        logger.error('Max retry attempts reached for wallet monitoring', { address });
        // Could implement polling fallback here if needed
        this.fallbackToPolling(address, callback);
      }
    }
  }

  private async fallbackToPolling(address: string, callback: (balance: number) => void): Promise<void> {
    logger.warn('Falling back to polling for wallet monitoring', { address });
    
    const checkBalance = async () => {
      try {
        const balance = await this.getWalletBalance(address);
        callback(balance);
      } catch (error) {
        logger.error('Error in polling fallback', { address, error });
      }
    };

    // Use longer intervals for polling fallback to reduce RPC calls
    const intervalId = setInterval(checkBalance, TRADING_CONSTANTS.WALLET_BALANCE_CHECK_INTERVAL * 3);

    // Store as fallback monitoring
    (global as any).walletMonitorIntervals = (global as any).walletMonitorIntervals || new Map();
    (global as any).walletMonitorIntervals.set(address, intervalId);

    logger.info('Started polling fallback for wallet monitoring', { address });
  }

  async stopWalletMonitoring(address: string): Promise<void> {
    try {
      // Stop WebSocket subscription
      const subscription = this.walletSubscriptions.get(address);
      if (subscription) {
        await this.connection.removeAccountChangeListener(subscription.subscriptionId);
        this.walletSubscriptions.delete(address);
        logger.info('Stopped WebSocket wallet monitoring', { 
          address, 
          subscriptionId: subscription.subscriptionId 
        });
      }

      // Stop polling fallback if exists
      const intervals = (global as any).walletMonitorIntervals;
      if (intervals && intervals.has(address)) {
        clearInterval(intervals.get(address));
        intervals.delete(address);
        logger.info('Stopped polling fallback monitoring', { address });
      }

      // Clean up retry tracking
      this.subscriptionRetries.delete(address);

    } catch (error) {
      logger.error('Error stopping wallet monitoring', { address, error });
    }
  }

  async transferRevenue(sessionWallet: WalletInfo, totalFundedAmount: number): Promise<{ success: boolean; signature?: string; revenueAmount: number }> {
    try {
      const revenueAmount = calculateRevenue(totalFundedAmount, TRADING_CONSTANTS.REVENUE_PERCENTAGE);
      const revenueWalletPubkey = new PublicKey(env.REVENUE_WALLET_ADDRESS);
      
      if (!sessionWallet.keypair) {
        throw new Error('Session wallet keypair not available');
      }

      // Create transfer instruction
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: sessionWallet.keypair.publicKey,
        toPubkey: revenueWalletPubkey,
        lamports: solToLamports(revenueAmount)
      });

      // Create and send transaction
      const transaction = new Transaction().add(transferInstruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [sessionWallet.keypair],
        { commitment: 'confirmed' }
      );

      logger.info('Revenue transferred successfully', {
        revenueAmount,
        signature,
        fromWallet: sessionWallet.address,
        toWallet: env.REVENUE_WALLET_ADDRESS
      });

      return {
        success: true,
        signature,
        revenueAmount
      };

    } catch (error) {
      logger.error('Revenue transfer failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionWallet: sessionWallet.address,
        revenueAmount: calculateRevenue(totalFundedAmount, TRADING_CONSTANTS.REVENUE_PERCENTAGE)
      });

      return {
        success: false,
        revenueAmount: calculateRevenue(totalFundedAmount, TRADING_CONSTANTS.REVENUE_PERCENTAGE)
      };
    }
  }

  async validateWalletFunding(address: string, fundingTier: FundingTierName, isPrivileged: boolean = false): Promise<{
    hasSufficientFunding: boolean;
    currentBalance: number;
    requiredAmount: number;
  }> {
    try {
      const currentBalance = await this.getWalletBalance(address);
      const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
      const requiredAmount = tierConfig.minFunding;

      const hasSufficient = hasSufficientFunding(currentBalance, requiredAmount, isPrivileged);

      logger.info('Wallet funding validation', {
        address,
        currentBalance,
        requiredAmount,
        hasSufficientFunding: hasSufficient,
        isPrivileged
      });

      return {
        hasSufficientFunding: hasSufficient,
        currentBalance,
        requiredAmount
      };

    } catch (error) {
      logger.error('Failed to validate wallet funding', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      const tierConfig = TRADING_CONSTANTS.FUNDING_TIERS[fundingTier.toUpperCase() as keyof typeof TRADING_CONSTANTS.FUNDING_TIERS];
      return {
        hasSufficientFunding: false,
        currentBalance: 0,
        requiredAmount: tierConfig?.minFunding || TRADING_CONSTANTS.MIN_WALLET_DEPOSIT
      };
    }
  }

  async updateWalletBalance(address: string, balance: number): Promise<void> {
    try {
      await db.insert(walletBalances).values({
        walletAddress: address,
        solBalance: balance.toString(),
        lastUpdated: new Date()
      }).onConflictDoUpdate({
        target: walletBalances.walletAddress,
        set: {
          solBalance: balance.toString(),
          lastUpdated: new Date()
        }
      });

      // Update session balance if exists
      await db.update(userSessions)
        .set({ 
          currentBalance: balance.toString(),
          updatedAt: new Date()
        })
        .where(eq(userSessions.walletAddress, address));

      // Update cache
      const cachedWallet = this.walletCache.get(address);
      if (cachedWallet) {
        cachedWallet.balance = balance;
      }

    } catch (error) {
      logger.error('Failed to update wallet balance', {
        address,
        balance,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async isPrivilegedWallet(address: string): Promise<boolean> {
    return this.privilegedWallets.has(address);
  }

  async addPrivilegedWallet(address: string): Promise<void> {
    if (this.privilegedWallets.size >= TRADING_CONSTANTS.MAX_PRIVILEGED_WALLETS) {
      throw createError.validation(
        `Maximum number of privileged wallets (${TRADING_CONSTANTS.MAX_PRIVILEGED_WALLETS}) reached`
      );
    }

    this.privilegedWallets.add(address);
    logger.info('Added privileged wallet', { address });
  }

  async removePrivilegedWallet(address: string): Promise<void> {
    this.privilegedWallets.delete(address);
    logger.info('Removed privileged wallet', { address });
  }

  getPrivilegedWallets(): string[] {
    return Array.from(this.privilegedWallets);
  }

  async detectFundingSource(walletAddress: string): Promise<string | null> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const signatures = await this.connection.getSignaturesForAddress(publicKey, { limit: 10 });

      for (const sigInfo of signatures) {
        const transaction = await this.connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (transaction && transaction.meta && transaction.meta.err === null) {
          const { meta, transaction: txDetails } = transaction;
          const accountKeys = txDetails.message.staticAccountKeys;
          const walletIndex = accountKeys.findIndex(key => key.toString() === walletAddress);

          // Check if this transaction actually deposited SOL into the wallet
          if (walletIndex !== -1 && meta.postBalances[walletIndex] > meta.preBalances[walletIndex]) {
            // The first account key (index 0) is always the fee payer and primary signer.
            // This is the most reliable indicator of the funding source.
            const funderAddress = accountKeys[0].toString();
            return funderAddress;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to detect funding source', {
        walletAddress,
        error: error instanceof Error ? error.message : JSON.stringify(error)
      });
      return null;
    }
  }

  async updateSessionPrivilegeStatus(sessionId: string, walletAddress: string): Promise<void> {
    try {
      const fundingSource = await this.detectFundingSource(walletAddress);
      
      if (fundingSource) {
        const isPrivileged = this.privilegedWallets.has(fundingSource);
        
        // Update session in database
        await db.update(userSessions)
          .set({ 
            isPrivileged,
            updatedAt: new Date()
          })
          .where(eq(userSessions.sessionId, sessionId));
        
        logger.info('Updated session privilege status', {
          sessionId,
          walletAddress,
          fundingSource,
          isPrivileged
        });
      }
    } catch (error) {
      logger.error('Failed to update session privilege status', {
        sessionId,
        walletAddress,
        error
      });
    }
  }

  private encryptPrivateKey(privateKey: Uint8Array): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      cipher.setAAD(Buffer.from('wallet-private-key'));
      
      let encrypted = cipher.update(Buffer.from(privateKey), undefined, 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Combine iv, authTag, and encrypted data
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('Failed to encrypt private key', { error });
      throw createError.internal('Encryption failed');
    }
  }

  public decryptPrivateKey(encryptedPrivateKey: string): Uint8Array {
    try {
      const [ivHex, authTagHex, encrypted] = encryptedPrivateKey.split(':');
      
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted private key format');
      }
      
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAAD(Buffer.from('wallet-private-key'));
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex');
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return new Uint8Array(decrypted);
    } catch (error) {
      logger.error('Failed to decrypt private key', { error });
      throw createError.internal('Decryption failed');
    }
  }

  async cleanup(): Promise<void> {
    // Clear cache
    this.walletCache.clear();
    
    // Stop all monitoring intervals
    const intervals = (global as any).walletMonitorIntervals;
    if (intervals) {
      for (const intervalId of intervals.values()) {
        clearInterval(intervalId);
      }
      intervals.clear();
    }
    
    logger.info('Wallet management service cleaned up');
  }
}