import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env, isProduction } from './environment';
import { logger } from './logger';
import * as schema from '../db/schema';

class DatabaseManager {
  private static instance: DatabaseManager;
  private pool: Pool;
  public db: ReturnType<typeof drizzle>;

  private constructor() {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: isProduction
    });

    this.db = drizzle(this.pool, { schema });

    this.setupEventListeners();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private setupEventListeners(): void {
    this.pool.on('connect', () => {
      logger.info('Database connection established');
    });

    this.pool.on('error', (err) => {
      logger.error('Database connection error', { error: err.message });
    });

    this.pool.on('remove', () => {
      logger.info('Database connection removed from pool');
    });
  }

  public async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      logger.info('Database connection test successful');
      return true;
    } catch (error) {
      logger.error('Database connection test failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.pool.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error('Error closing database connection pool', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
}

export const databaseManager = DatabaseManager.getInstance();
export const db = databaseManager.db;