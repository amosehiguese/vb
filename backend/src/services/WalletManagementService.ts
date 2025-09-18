import { Keypair, PublicKey, Connection, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, getOrCreateAssociatedTokenAccount, getAccount, createCloseAccountInstruction } from '@solana/spl-token';
import crypto from 'crypto';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { db } from '../config/database';
import { NewSessionWallet, sessionWallets, userSessions, walletBalances } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  WalletInfo,
} from '../types/session';
import {
  lamportsToSol,
  hasSufficientFunding,
  solToLamports,
  calculateRevenue,
  delay,
  getRandomNumber
} from '../utils/helpers';
import {
  TRADING_CONSTANTS,
  STRATEGY_CONSTANTS,
  PRIVILEGED_WALLET_ADDRESSES,
} from '../utils/constants';
import { createError } from '../middleware/errorHandler';

export class WalletManagementService {
  private connection: Connection;
  private walletCache: Map<string, WalletInfo> = new Map();
  private privilegedWallets: Set<string> = new Set();

  // Encryption key for private keys (should be from environment in production)
  private readonly encryptionKey = crypto.scryptSync(
    env.WALLET_ENCRYPTION_PASSWORD,
    'salt',
    32
  );

  constructor() {
    this.connection = new Connection(env.SOLANA_RPC_URL, 'confirmed');
    this.initializePrivilegedWallets();
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

  async createMainFundingWallet(sessionId?: string): Promise<WalletInfo> {
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
        keypair,
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

  async fundWalletPool(sessionId: string, mainFundingKeypair: Keypair, tokenAddress: string, totalTokenAmount: number): Promise<void> {
    const wallets = await db.select().from(sessionWallets).where(eq(sessionWallets.sessionId, sessionId));
    if (wallets.length === 0) throw new Error('No wallets found in pool to fund');

    logger.info('Starting funding process for wallet pool', { sessionId, walletCount: wallets.length });

    // 1. Fund GAS (SOL) to all wallets
    for (const wallet of wallets) {
        try {
            await this.transferFunds(mainFundingKeypair, wallet.walletAddress, STRATEGY_CONSTANTS.INITIAL_GAS_PER_WALLET);
            logger.debug(`Funded gas to ${wallet.walletType} wallet`, { address: wallet.walletAddress });
            await delay(getRandomNumber(200, 500)); // Stagger funding
        } catch (error) {
            logger.error('Failed to fund gas to a pool wallet', { address: wallet.walletAddress, error });
        }
    }

    // 2. Distribute TOKENS
    const tokenMint = new PublicKey(tokenAddress);
    let distributedAmount = 0;

    for (const wallet of wallets) {
        let tokenAmountPercentage: number;
        if (wallet.walletType === 'whale') {
            tokenAmountPercentage = getRandomNumber(STRATEGY_CONSTANTS.MIN_WHALE_TOKEN_PERCENTAGE, STRATEGY_CONSTANTS.MAX_WHALE_TOKEN_PERCENTAGE);
        } else {
            tokenAmountPercentage = getRandomNumber(STRATEGY_CONSTANTS.MIN_RETAIL_TOKEN_PERCENTAGE, STRATEGY_CONSTANTS.MAX_RETAIL_TOKEN_PERCENTAGE);
        }
        
        const amountToTransfer = Math.floor(totalTokenAmount * (tokenAmountPercentage / 100));
        distributedAmount += amountToTransfer;
        
        try {
            await this.transferToken(mainFundingKeypair, wallet.walletAddress, tokenAddress, amountToTransfer);
            await db.update(sessionWallets)
                .set({ status: 'funded', initialTokenAmount: amountToTransfer.toString(), initialGasAmount: STRATEGY_CONSTANTS.INITIAL_GAS_PER_WALLET.toString() })
                .where(eq(sessionWallets.walletAddress, wallet.walletAddress));
            
            logger.debug(`Distributed tokens to ${wallet.walletType} wallet`, { address: wallet.walletAddress, amount: amountToTransfer });
            await delay(getRandomNumber(300, 700)); // Stagger funding
        } catch (error) {
            logger.error('Failed to distribute tokens to a pool wallet', { address: wallet.walletAddress, amount: amountToTransfer, error });
        }
    }
    logger.info('Token distribution complete', { sessionId, totalDistributed: distributedAmount, outOf: totalTokenAmount });
  }

  async createWalletPool(sessionId: string, poolSize: number, whalePercentage: number): Promise<void> {
    logger.info('Creating wallet pool', { sessionId, poolSize, whalePercentage });
    const walletsToInsert: NewSessionWallet[] = [];
    const whaleCount = Math.floor(poolSize * whalePercentage);

    for (let i = 0; i < poolSize; i++) {
        const keypair = Keypair.generate();
        const encryptedPrivateKey = this.encryptPrivateKey(keypair.secretKey);
        const walletType = i < whaleCount ? 'whale' : 'retail';

        walletsToInsert.push({
            sessionId,
            walletAddress: keypair.publicKey.toString(),
            privateKey: encryptedPrivateKey,
            walletType,
            status: 'pending',
        });
    }

    await db.insert(sessionWallets).values(walletsToInsert);
    logger.info('Wallet pool created and stored successfully', { sessionId, count: walletsToInsert.length, whaleCount });
  }

  async sweepAllAssets(sessionId: string, mainFundingAddress: string): Promise<{ success: boolean; totalTokenSwept: number; totalSolSwept: number; errors: string[] }> {
    logger.info('Starting asset sweep for session', { sessionId, mainFundingAddress });
    const wallets = await db.select().from(sessionWallets).where(eq(sessionWallets.sessionId, sessionId));
    const sessions = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));

    if (sessions.length == 0) {
      return { success: false, totalTokenSwept: 0, totalSolSwept: 0, errors: ['Session not found'] };
    }
    
    const session = sessions[0];

    const mainFundingPubkey = new PublicKey(mainFundingAddress);
    let totalTokenSwept = 0;
    let totalSolSwept = 0;
    const errors: string[] = [];

    for (const botWallet of wallets) {
      try {
        const botKeypair = Keypair.fromSecretKey(this.decryptPrivateKey(botWallet.privateKey));
        const botPubkey = botKeypair.publicKey;

        // 1. Sweep SPL Token
        const tokenMint = new PublicKey(session.contractAddress);
        const botAta = await getAssociatedTokenAddress(tokenMint, botPubkey);
        
        try {
          const botAtaInfo = await getAccount(this.connection, botAta);
          if (botAtaInfo && botAtaInfo.amount > 0) {
            const mainAta = await getOrCreateAssociatedTokenAccount(this.connection, botKeypair, tokenMint, mainFundingPubkey);
            const transferTx = new Transaction().add(
              createTransferInstruction(botAta, mainAta.address, botPubkey, botAtaInfo.amount)
            );
            await sendAndConfirmTransaction(this.connection, transferTx, [botKeypair]);
            totalTokenSwept += Number(botAtaInfo.amount);
            logger.debug('Swept token', { from: botPubkey.toString(), amount: Number(botAtaInfo.amount) });
          }
        } catch (e) {
            // It's normal for an account not to be found if it never held the token
            if (!(e instanceof Error && e.name === 'TokenAccountNotFoundError')) {
                 logger.warn('Could not sweep token from wallet', { wallet: botPubkey.toString(), error: e });
            }
        }

        // 2. Sweep Remaining SOL
        await delay(500); // Small delay to ensure balances update
        const solBalance = await this.connection.getBalance(botPubkey);
        const fee = 5000; // Standard transaction fee
        if (solBalance > fee) {
          const transferAmount = solBalance - fee;
          const solSweepTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: botPubkey,
              toPubkey: mainFundingPubkey,
              lamports: transferAmount,
            })
          );
          await sendAndConfirmTransaction(this.connection, solSweepTx, [botKeypair]);
          totalSolSwept += transferAmount;
          logger.debug('Swept SOL', { from: botPubkey.toString(), amount: lamportsToSol(transferAmount) });
        }
      } catch (error) {
        const errorMessage = `Failed to sweep assets from ${botWallet.walletAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        logger.error(errorMessage);
        errors.push(errorMessage);
      }
    }
    
    logger.info('Asset sweep completed', { sessionId, totalTokenSwept, totalSolSwept: lamportsToSol(totalSolSwept), errors: errors.length });
    return { success: errors.length === 0, totalTokenSwept, totalSolSwept: lamportsToSol(totalSolSwept), errors };
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

 

  async getWalletByAddress(address: string): Promise<WalletInfo | null> {
    try {
      // Check cache first
      const cachedWallet = this.walletCache.get(address);
      if (cachedWallet) {
        return cachedWallet;
      }

      // Query database
      const sessions = await db.select().from(userSessions).where(eq(userSessions.mainFundingAddress, address));
      
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

  async getWalletBalance(address: string): Promise<number> {
    try {
      const publicKey = new PublicKey(address);
      const balance = await this.connection.getBalance(publicKey);
      const solBalance = lamportsToSol(balance);

      // Update balance in database
      await this.updateWalletBalance(address, solBalance);

      logger.debug('Wallet balance retrieved', { address, balance: solBalance });
      return solBalance;

    } catch (error) {
      logger.error('Failed to get wallet balance', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
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
    const checkBalance = async () => {
      try {
        const balance = await this.getWalletBalance(address);
        callback(balance);
      } catch (error) {
        logger.error('Error monitoring wallet balance', { address, error });
      }
    };

    // Initial check
    await checkBalance();

    // Set up periodic monitoring
    const intervalId = setInterval(checkBalance, TRADING_CONSTANTS.WALLET_BALANCE_CHECK_INTERVAL);

    // Store interval ID for cleanup
    (global as any).walletMonitorIntervals = (global as any).walletMonitorIntervals || new Map();
    (global as any).walletMonitorIntervals.set(address, intervalId);

    logger.info('Started wallet balance monitoring', { address });
  }

  async stopWalletMonitoring(address: string): Promise<void> {
    const intervals = (global as any).walletMonitorIntervals;
    if (intervals && intervals.has(address)) {
      clearInterval(intervals.get(address));
      intervals.delete(address);
      logger.info('Stopped wallet balance monitoring', { address });
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

  async validateWalletFunding(address: string, isPrivileged: boolean = false): Promise<{
    hasSufficientFunding: boolean;
    currentBalance: number;
    requiredAmount: number;
  }> {
    try {
      const currentBalance = await this.getWalletBalance(address);
      const requiredAmount = isPrivileged 
        ? TRADING_CONSTANTS.MIN_PRIVILEGED_WALLET_DEPOSIT 
        : TRADING_CONSTANTS.MIN_WALLET_DEPOSIT;

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

      return {
        hasSufficientFunding: false,
        currentBalance: 0,
        requiredAmount: isPrivileged 
          ? TRADING_CONSTANTS.MIN_PRIVILEGED_WALLET_DEPOSIT 
          : TRADING_CONSTANTS.MIN_WALLET_DEPOSIT
      };
    }
  }

  async getWalletsForSession(sessionId: string): Promise<Keypair[]> {
    const walletRecords = await db.select().from(sessionWallets).where(eq(sessionWallets.sessionId, sessionId));
    return walletRecords.map(record => {
      const secretKey = this.decryptPrivateKey(record.privateKey);
      return Keypair.fromSecretKey(secretKey);
    });
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
        .where(eq(userSessions.mainFundingAddress, address));

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