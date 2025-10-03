import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  SOL_PRICE: z.string().transform(Number).default(212),
  DATABASE_URL: z.string(),
  SOLANA_RPC_URL: z.string().regex(/^https?:\/\/.+/),
  SOLANA_RPC_URL_BACKUP_1: z.string().regex(/^https?:\/\/.+/),
  SOLANA_RPC_URL_BACKUP_2: z.string().regex(/^https?:\/\/.+/),
  JUPITER_API_URL: z.string().regex(/^https?:\/\/.+/).default('https://lite-api.jup.ag'),
  COINGECKO_API_URL: z.string().regex(/^https?:\/\/.+/).default('https://api.coingecko.com/api/v3'),
  RAYDIUM_API_URL: z.string().regex(/^https?:\/\/.+/).default('https://api.raydium.io/v2'),
  FRONTEND_URL: z.string().regex(/^https?:\/\/.+/).optional(),
  TRADE_AMOUNT_USD: z.string().transform(Number).default(0.01),
  MIN_WALLET_DEPOSIT: z.string().transform(Number).default(0.1),
  MIN_PRIVILEGED_WALLET_DEPOSIT: z.string().transform(Number).default(0.005),
  REVENUE_PERCENTAGE: z.string().transform(Number).default(25),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  MAX_PRIVILEGED_WALLETS: z.string().transform(Number).default(3),
  REVENUE_WALLET_ADDRESS: z.string().min(32).max(44),
  WALLET_ENCRYPTION_PASSWORD: z.string().min(8),
  PRIVILEGED_WALLETS: z.string().optional()
});

export type Environment = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';