import { PublicKey } from '@solana/web3.js';
import crypto from 'crypto';
import { SOLANA_CONSTANTS, VALIDATION_CONSTANTS } from './constants';

/**
 * Validates if a string is a valid Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    if (address.length < VALIDATION_CONSTANTS.MIN_CONTRACT_ADDRESS_LENGTH || 
        address.length > VALIDATION_CONSTANTS.SOLANA_ADDRESS_LENGTH) {
      return false;
    }
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts lamports to SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / SOLANA_CONSTANTS.LAMPORTS_PER_SOL;
}

/**
 * Converts SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * SOLANA_CONSTANTS.LAMPORTS_PER_SOL);
}

/**
 * Formats SOL amount to readable string
 */
export function formatSol(sol: number, decimals: number = 4): string {
  return sol.toFixed(decimals);
}

/**
 * Formats USD amount to readable string
 */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * Generates a unique session ID
 */
export function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generates a random string of specified length
 */
export function generateRandomString(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Calculates percentage of total
 */
export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return (value / total) * 100;
}

/**
 * Calculates depletion percentage based on initial and current balance
 */
export function calculateDepletionPercentage(initialBalance: number, currentBalance: number): number {
  if (initialBalance === 0) return 0;
  return calculatePercentage(initialBalance - currentBalance, initialBalance);
}

/**
 * Checks if wallet has sufficient funding
 */
export function hasSufficientFunding(balance: number, minRequired: number, isPrivileged: boolean = false): boolean {
  const minimumDeposit = isPrivileged ? 0.005 : minRequired;
  return balance >= minimumDeposit;
}

/**
 * Calculates trading revenue
 */
export function calculateRevenue(initialAmount: number, revenuePercentage: number): number {
  return (initialAmount * revenuePercentage) / 100;
}

/**
 * Calculates amount available for trading (after revenue deduction)
 */
export function calculateTradingAmount(totalAmount: number, revenuePercentage: number): number {
  const revenue = calculateRevenue(totalAmount, revenuePercentage);
  return totalAmount - revenue;
}

/**
 * Validates token symbol format
 */
export function isValidTokenSymbol(symbol: string): boolean {
  if (!symbol || symbol.length === 0) return false;
  if (symbol.length > VALIDATION_CONSTANTS.MAX_TOKEN_SYMBOL_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(symbol);
}

/**
 * Sanitizes token name
 */
export function sanitizeTokenName(name: string): string {
  if (!name) return '';
  return name.trim().slice(0, VALIDATION_CONSTANTS.MAX_TOKEN_NAME_LENGTH);
}

/**
 * Validates token decimals
 */
export function isValidDecimals(decimals: number): boolean {
  return Number.isInteger(decimals) && 
         decimals >= VALIDATION_CONSTANTS.MIN_TOKEN_DECIMALS && 
         decimals <= VALIDATION_CONSTANTS.MAX_TOKEN_DECIMALS;
}

/**
 * Creates a delay for async operations
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      // Exponential backoff
      await delay(delayMs * Math.pow(2, attempt - 1));
    }
  }
  
  throw lastError!;
}

/**
 * Safely parses JSON with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Truncates address for display
 */
export function truncateAddress(address: string, start: number = 4, end: number = 4): string {
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * Validates pool liquidity meets minimum requirements
 */
export function hasMinimumLiquidity(liquidityUsd: number, minimumUsd: number = 10000): boolean {
  return liquidityUsd >= minimumUsd;
}

/**
 * Calculates pool score for ranking
 */
export function calculatePoolScore(liquidity: number, volume24h: number, verified: boolean = false): number {
  let score = 0;
  
  // Liquidity score (40% weight)
  score += Math.min(liquidity / 100000, 1) * 40;
  
  // Volume score (40% weight)
  score += Math.min(volume24h / 50000, 1) * 40;
  
  // Verification bonus (20% weight)
  if (verified) {
    score += 20;
  }
  
  return Math.round(score);
}

/**
 * Converts timestamp to ISO string safely
 */
export function toISOString(date: Date | string | number): string {
  if (date instanceof Date) {
    return date.toISOString();
  }
  return new Date(date).toISOString();
}

/**
 * Checks if timestamp is within valid range (not too old or in future)
 */
export function isValidTimestamp(timestamp: Date | string | number, maxAgeMs: number = 86400000): boolean {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const age = now.getTime() - date.getTime();
    
    return age >= 0 && age <= maxAgeMs;
  } catch {
    return false;
  }
}