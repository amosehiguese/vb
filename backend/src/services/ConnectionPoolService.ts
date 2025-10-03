import { Connection, ConnectionConfig } from '@solana/web3.js';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import fetch from 'node-fetch';

interface ConnectionMetrics {
  totalRequests: number;
  activeSubscriptions: number;
  failureCount: number;
  lastHealthCheck: Date;
  isHealthy: boolean;
  avgResponseTime: number;
}

interface PooledConnection {
  connection: Connection;
  url: string;
  metrics: ConnectionMetrics;
  weight: number; // For weighted round-robin
}

export class ConnectionPoolService {
  private static instance: ConnectionPoolService;
  private connections: PooledConnection[] = [];
  private currentIndex: number = 0;
  private readonly MAX_SUBSCRIPTIONS_PER_CONNECTION = 800;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly MAX_FAILURES_BEFORE_DISABLE = 5;

  private constructor() {
    this.initializeConnections();
    this.startHealthChecks();
  }

  static getInstance(): ConnectionPoolService {
    if (!ConnectionPoolService.instance) {
      ConnectionPoolService.instance = new ConnectionPoolService();
    }
    return ConnectionPoolService.instance;
  }

  private initializeConnections(): void {
    // Get RPC URLs from environment
    const rpcUrls = this.getRpcEndpoints();

    logger.info('Initializing RPC connection pool', {
      totalEndpoints: rpcUrls.length,
      endpoints: rpcUrls.map(e => ({ url: e.url, weight: e.weight }))
    });

    // Create connections for each endpoint
    rpcUrls.forEach(({ url, weight }) => {
      try {
        const connectionConfig: ConnectionConfig = {
          commitment: 'confirmed',
          fetch: fetch as any,
          wsEndpoint: url.replace('https://', 'wss://').replace('http://', 'ws://'),
        };

        const connection = new Connection(url, connectionConfig);

        this.connections.push({
          connection,
          url,
          weight,
          metrics: {
            totalRequests: 0,
            activeSubscriptions: 0,
            failureCount: 0,
            lastHealthCheck: new Date(),
            isHealthy: true,
            avgResponseTime: 0
          }
        });

        logger.info('RPC connection initialized', { url, weight });
      } catch (error) {
        logger.error('Failed to initialize RPC connection', {
          url,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    if (this.connections.length === 0) {
      throw new Error('No RPC connections could be initialized');
    }

    logger.info('RPC connection pool ready', {
      totalConnections: this.connections.length,
      maxSubscriptionsPerConnection: this.MAX_SUBSCRIPTIONS_PER_CONNECTION,
      totalCapacity: this.connections.length * this.MAX_SUBSCRIPTIONS_PER_CONNECTION
    });
  }

  private getRpcEndpoints(): Array<{ url: string; weight: number }> {
    const endpoints: Array<{ url: string; weight: number }> = [];

    // Primary RPC (highest weight)
    if (env.SOLANA_RPC_URL) {
      endpoints.push({ url: env.SOLANA_RPC_URL, weight: 4 });
    }

    // Backup RPCs (lower weights)
    if (env.SOLANA_RPC_URL_BACKUP_1) {
      endpoints.push({ url: env.SOLANA_RPC_URL_BACKUP_1, weight: 3 });
    }

    if (env.SOLANA_RPC_URL_BACKUP_2) {
      endpoints.push({ url: env.SOLANA_RPC_URL_BACKUP_2, weight: 2 });
    }

    // Public fallback RPCs (lowest weight, only used when all others fail)
    const publicFallbacks = [
        'https://api.mainnet-beta.solana.com',
        'https://solana-api.projectserum.com',
        'https://rpc.ankr.com/solana'
    ];

    for (const fallbackUrl of publicFallbacks) {
        // Only add if not already configured
        if (!endpoints.some(e => e.url === fallbackUrl)) {
        endpoints.push({ url: fallbackUrl, weight: 1 });
        }
    }

    return endpoints;
  }

  /**
   * Get connection using weighted round-robin strategy
   * Connections with higher weights are selected more frequently
   */
  getConnection(preferredUrl?: string): Connection {
    // If specific URL requested and available, return it
    if (preferredUrl) {
      const specific = this.connections.find(c => c.url === preferredUrl && c.metrics.isHealthy);
      if (specific) {
        return specific.connection;
      }
    }

    // Filter to only healthy connections
    const healthyConnections = this.connections.filter(c => c.metrics.isHealthy);

    if (healthyConnections.length === 0) {
      logger.error('No healthy RPC connections available');
      // Fallback to first connection even if unhealthy
      return this.connections[0].connection;
    }

    // Weighted round-robin selection
    const totalWeight = healthyConnections.reduce((sum, c) => sum + c.weight, 0);
    let randomWeight = Math.random() * totalWeight;

    for (const conn of healthyConnections) {
      randomWeight -= conn.weight;
      if (randomWeight <= 0) {
        this.currentIndex = this.connections.indexOf(conn);
        conn.metrics.totalRequests++;
        return conn.connection;
      }
    }

    // Fallback to round-robin
    return this.getConnectionRoundRobin();
  }

  /**
   * Get connection using simple round-robin
   */
  private getConnectionRoundRobin(): Connection {
    const healthyConnections = this.connections.filter(c => c.metrics.isHealthy);
    
    if (healthyConnections.length === 0) {
      return this.connections[0].connection;
    }

    const connection = healthyConnections[this.currentIndex % healthyConnections.length];
    this.currentIndex = (this.currentIndex + 1) % healthyConnections.length;
    connection.metrics.totalRequests++;
    
    return connection.connection;
  }

  /**
   * Get connection with least active subscriptions (for WebSocket subscriptions)
   */
  getConnectionForSubscription(): { connection: Connection; url: string } {
    const availableConnections = this.connections.filter(
      c => c.metrics.isHealthy && 
           c.metrics.activeSubscriptions < this.MAX_SUBSCRIPTIONS_PER_CONNECTION
    );

    if (availableConnections.length === 0) {
      logger.warn('All connections at max subscription capacity or unhealthy');
      // Return connection with least subscriptions, even if at max
      const leastLoaded = this.connections.reduce((min, c) => 
        c.metrics.activeSubscriptions < min.metrics.activeSubscriptions ? c : min
      );
      return { connection: leastLoaded.connection, url: leastLoaded.url };
    }

    // Find connection with least subscriptions
    const optimal = availableConnections.reduce((min, c) =>
      c.metrics.activeSubscriptions < min.metrics.activeSubscriptions ? c : min
    );

    optimal.metrics.activeSubscriptions++;
    
    logger.debug('Selected connection for subscription', {
      url: optimal.url,
      activeSubscriptions: optimal.metrics.activeSubscriptions,
      maxCapacity: this.MAX_SUBSCRIPTIONS_PER_CONNECTION
    });

    return { connection: optimal.connection, url: optimal.url };
  }

  /**
   * Release subscription (decrease counter)
   */
  releaseSubscription(url: string): void {
    const conn = this.connections.find(c => c.url === url);
    if (conn && conn.metrics.activeSubscriptions > 0) {
      conn.metrics.activeSubscriptions--;
    }
  }

  /**
   * Record connection failure
   */
  recordFailure(url: string): void {
    const conn = this.connections.find(c => c.url === url);
    if (conn) {
      conn.metrics.failureCount++;
      
      if (conn.metrics.failureCount >= this.MAX_FAILURES_BEFORE_DISABLE) {
        conn.metrics.isHealthy = false;
        logger.error('Connection marked as unhealthy', {
          url,
          failureCount: conn.metrics.failureCount
        });
      }
    }
  }

  /**
   * Record successful operation (resets failure count)
   */
  recordSuccess(url: string, responseTime?: number): void {
    const conn = this.connections.find(c => c.url === url);
    if (conn) {
      conn.metrics.failureCount = 0;
      
      if (responseTime) {
        // Update rolling average response time
        conn.metrics.avgResponseTime = 
          (conn.metrics.avgResponseTime * 0.9) + (responseTime * 0.1);
      }
    }
  }

  /**
   * Start health check monitoring
   */
  private startHealthChecks(): void {
    setInterval(async () => {
      await this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Check health of all connections
   */
  private async performHealthChecks(): Promise<void> {
    logger.debug('Performing RPC health checks');

    const checks = this.connections.map(async (conn) => {
      try {
        const startTime = Date.now();
        
        // Simple health check - get current slot
        await Promise.race([
          conn.connection.getSlot(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);

        const responseTime = Date.now() - startTime;
        
        // Mark as healthy and reset failure count
        conn.metrics.isHealthy = true;
        conn.metrics.failureCount = 0;
        conn.metrics.lastHealthCheck = new Date();
        conn.metrics.avgResponseTime = 
          (conn.metrics.avgResponseTime * 0.8) + (responseTime * 0.2);

        logger.debug('Health check passed', {
          url: conn.url,
          responseTime,
          avgResponseTime: conn.metrics.avgResponseTime.toFixed(0)
        });

      } catch (error) {
        conn.metrics.failureCount++;
        conn.metrics.lastHealthCheck = new Date();

        if (conn.metrics.failureCount >= this.MAX_FAILURES_BEFORE_DISABLE) {
          conn.metrics.isHealthy = false;
        }

        logger.warn('Health check failed', {
          url: conn.url,
          failureCount: conn.metrics.failureCount,
          isHealthy: conn.metrics.isHealthy,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    await Promise.all(checks);

    // Log summary
    this.logPoolMetrics();
  }

  /**
   * Get pool metrics for monitoring
   */
  getMetrics() {
    return {
      totalConnections: this.connections.length,
      healthyConnections: this.connections.filter(c => c.metrics.isHealthy).length,
      totalSubscriptions: this.connections.reduce((sum, c) => sum + c.metrics.activeSubscriptions, 0),
      maxSubscriptionCapacity: this.connections.length * this.MAX_SUBSCRIPTIONS_PER_CONNECTION,
      connections: this.connections.map(c => ({
        url: c.url,
        weight: c.weight,
        isHealthy: c.metrics.isHealthy,
        activeSubscriptions: c.metrics.activeSubscriptions,
        totalRequests: c.metrics.totalRequests,
        failureCount: c.metrics.failureCount,
        avgResponseTime: Math.round(c.metrics.avgResponseTime),
        lastHealthCheck: c.metrics.lastHealthCheck
      }))
    };
  }

  /**
   * Log pool metrics
   */
  private logPoolMetrics(): void {
    const metrics = this.getMetrics();
    
    logger.info('RPC Connection Pool Metrics', {
      healthy: `${metrics.healthyConnections}/${metrics.totalConnections}`,
      subscriptions: `${metrics.totalSubscriptions}/${metrics.maxSubscriptionCapacity}`,
      utilizationPct: ((metrics.totalSubscriptions / metrics.maxSubscriptionCapacity) * 100).toFixed(1),
      connections: metrics.connections
    });

    // Alert if capacity is critical
    const utilizationPct = (metrics.totalSubscriptions / metrics.maxSubscriptionCapacity) * 100;
    if (utilizationPct > 90) {
      logger.error('⚠️ RPC subscription capacity critical', {
        utilization: `${utilizationPct.toFixed(1)}%`,
        subscriptions: metrics.totalSubscriptions,
        capacity: metrics.maxSubscriptionCapacity
      });
    } else if (utilizationPct > 75) {
      logger.warn('⚠️ RPC subscription capacity high', {
        utilization: `${utilizationPct.toFixed(1)}%`,
        subscriptions: metrics.totalSubscriptions,
        capacity: metrics.maxSubscriptionCapacity
      });
    }
  }

  /**
   * Cleanup all connections
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up RPC connection pool');
    this.connections = [];
  }
}

// Export singleton instance
export const connectionPool = ConnectionPoolService.getInstance();