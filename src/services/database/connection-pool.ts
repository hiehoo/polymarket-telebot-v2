import { Pool, PoolClient } from 'pg';
import { config } from '../../config';
import logger from '../../utils/logger';
import { DatabaseError, isOperationalError } from '../../utils/error-handler';

interface PoolConfig {
  min: number;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  maxUses: number;
  allowExitOnIdle: boolean;
}

interface ConnectionStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
  averageResponseTime: number;
  lastHealthCheck?: Date;
}

interface DatabaseConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

class DatabasePool {
  private pool: Pool | null = null;
  private config: PoolConfig;
  private connectionInfo: DatabaseConnectionInfo;
  private retryAttempts: Map<string, number> = new Map();
  private maxRetryAttempts = 5;
  private baseRetryDelay = 1000;
  private responseTimes: number[] = [];
  private maxResponseTimeHistory = 100;

  constructor(poolConfig?: Partial<PoolConfig>) {
    this.config = {
      min: poolConfig?.min || 2,
      max: poolConfig?.max || 10,
      idleTimeoutMillis: poolConfig?.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: poolConfig?.connectionTimeoutMillis || 5000,
      maxUses: poolConfig?.maxUses || 7500,
      allowExitOnIdle: poolConfig?.allowExitOnIdle || false,
    };

    this.connectionInfo = this.parseDatabaseUrl(config.database.url);
    this.initializePool();
  }

  private parseDatabaseUrl(url: string): DatabaseConnectionInfo {
    try {
      // Log the URL being parsed (mask password for security)
      const maskedUrl = url.replace(/:[^:@]+@/, ':***@');
      logger.info('Parsing database URL', { url: maskedUrl, envDatabaseUrl: process.env['DATABASE_URL'] ? 'set' : 'not set' });

      // Parse PostgreSQL connection URL with proper regex
      const pgUrlRegex = /^(postgres(?:ql)?:\/\/)?(?:([^:]+):([^@]+)@)?([^:]+)(?::(\d+))?(?:\/([^?]+))?(?:\?(.+))?$/;
      const match = url.match(pgUrlRegex);

      if (!match) {
        throw new DatabaseError(`Invalid database URL format: ${url}`);
      }

      const [, , user = 'postgres', password = '', host = 'localhost', port = '5432', database = 'polymarket_bot', queryParams] = match;

      // Check for SSL requirements in query params
      const params = new URLSearchParams(queryParams || '');
      const ssl = params.get('sslmode') === 'require' || url.includes('sslmode=require');

      return {
        host,
        port: parseInt(port, 10),
        database: database || 'polymarket_bot',
        user,
        password,
        ssl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse database URL:', { url, error: errorMessage });
      throw new DatabaseError(`Database URL parsing failed: ${errorMessage}`);
    }
  }

  private async initializePool(): Promise<void> {
    try {
      this.pool = new Pool({
        host: this.connectionInfo.host,
        port: this.connectionInfo.port,
        database: this.connectionInfo.database,
        user: this.connectionInfo.user,
        password: this.connectionInfo.password,
        max: this.config.max,
        min: this.config.min,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
        maxUses: this.config.maxUses,
        allowExitOnIdle: this.config.allowExitOnIdle,
        ssl: this.connectionInfo.ssl ? {
          rejectUnauthorized: true,
          cert: process.env['DB_SSL_CERT'],
          key: process.env['DB_SSL_KEY'],
          ca: process.env['DB_SSL_CA'],
        } : false,
        application_name: 'polymarket-telebot',
        ...this.getAdvancedConfig(),
      });

      // Test connection
      await this.testConnection();

      logger.info('Database pool initialized successfully', {
        config: {
          min: this.config.min,
          max: this.config.max,
          host: this.connectionInfo.host,
          port: this.connectionInfo.port,
          database: this.connectionInfo.database,
          user: this.connectionInfo.user,
          ssl: this.connectionInfo.ssl,
        },
      });

      // Setup pool event handlers
      this.setupPoolEventHandlers();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to initialize database pool:', {
        error: errorMessage,
        stack: errorStack,
        host: this.connectionInfo.host,
        port: this.connectionInfo.port,
        database: this.connectionInfo.database,
      });
      throw new DatabaseError(`Pool initialization failed: ${errorMessage}`);
    }
  }

  private setupPoolEventHandlers(): void {
    if (!this.pool) return;

    this.pool.on('error', (error: any) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Database pool error:', {
        error: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString(),
      });

      // Don't throw here to prevent unhandled rejections
      // The error is logged and pool will attempt recovery
    });

    this.pool.on('connect', (client: any) => {
      logger.debug('New database connection established', {
        totalCount: this.pool!.totalCount,
        idleCount: this.pool!.idleCount,
        waitingCount: this.pool!.waitingCount,
        processId: (client as any).processID,
      });
    });

    this.pool.on('acquire', (client: any) => {
      logger.debug('Database connection acquired', {
        totalCount: this.pool!.totalCount,
        idleCount: this.pool!.idleCount,
        waitingCount: this.pool!.waitingCount,
        processId: (client as any).processID,
      });
    });

    this.pool.on('remove', (client: any) => {
      logger.debug('Database connection removed', {
        totalCount: this.pool!.totalCount,
        idleCount: this.pool!.idleCount,
        waitingCount: this.pool!.waitingCount,
        processId: (client as any).processID,
      });
    });
  }

  private getAdvancedConfig(): Record<string, any> {
    return {
      // Performance optimization
      statement_timeout: 15000, // 15 seconds
      query_timeout: 5000, // 5 seconds
      parseInputDatesAsUTC: false,
      // Security settings
      fallback_application_name: 'polymarket-telebot',
      // Connection security
      maxPreparedStatements: 100,
      // Additional options
      keepAlive: true,
      keepAliveInitialDelayMillis: 1000,
      // PostgreSQL-specific optimizations
      idle_in_transaction_session_timeout: 60000,
      lock_timeout: 30000,
    };
  }

  private async testConnection(): Promise<void> {
    if (!this.pool) {
      throw new DatabaseError('Pool not initialized for connection test');
    }

    try {
      const result = await this.pool.query('SELECT NOW() as current_time, version() as version');
      logger.info('Database connection test successful', {
        currentTime: result.rows[0].current_time,
        version: result.rows[0].version.split(' ')[1],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Connection test failed: ${errorMessage}`);
    }
  }

  private calculateExponentialBackoff(attempt: number): number {
    return Math.min(
      this.baseRetryDelay * Math.pow(2, attempt),
      30000 // Max 30 seconds
    );
  }

  private updateResponseTime(duration: number): void {
    this.responseTimes.push(duration);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }
  }

  private getAverageResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    return Math.round(
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
    );
  }

  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    const queryId = `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (!this.pool) {
        throw new DatabaseError('Database pool not initialized');
      }

      // Log query start
      logger.debug('Starting database query', {
        queryId,
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params?.length || 0,
      });

      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      this.updateResponseTime(duration);

      logger.debug(`Database query completed in ${duration}ms`, {
        queryId,
        duration,
        resultCount: Array.isArray(result.rows) ? result.rows.length : 0,
        rowCount: result.rowCount,
      });

      return result.rows as T[];
    } catch (error) {
      const duration = Date.now() - start;
      const errorKey = `query_${text.substring(0, 50)}`;

      logger.error('Database query failed:', {
        queryId,
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params?.length || 0,
        duration,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        code: (error as any).code,
        severity: (error as any).severity,
      });

      // Check if we should retry
      if (this.shouldRetry(error) && (this.retryAttempts.get(errorKey) || 0) < this.maxRetryAttempts) {
        const currentAttempts = this.retryAttempts.get(errorKey) || 0;
        this.retryAttempts.set(errorKey, currentAttempts + 1);

        const delay = this.calculateExponentialBackoff(currentAttempts);
        logger.warn(`Retrying database query in ${delay}ms`, {
          queryId,
          attempt: currentAttempts + 1,
          maxAttempts: this.maxRetryAttempts,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.query<T>(text, params);
      }

      // Reset retry attempts for successful queries or max attempts reached
      this.retryAttempts.delete(errorKey);

      if (isOperationalError(error as Error)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Query failed: ${errorMessage}`);
    }
  }

  private shouldRetry(error: any): boolean {
    // Retry on connection errors and timeouts
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      '08006', // connection_failure
      '08001', // sqlclient_unable_to_establish_sqlconnection
      '08004', // server_rejected_connection
      '57P03', // cannot_connect_now
    ];

    return retryableCodes.includes(error.code) ||
      (typeof error.message === 'string' && (
        error.message.includes('timeout') ||
        error.message.includes('connection') ||
        error.message.includes('ECONNRESET')
      ));
  }

  async getClient(): Promise<PoolClient> {
    const start = Date.now();
    const clientKey = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (!this.pool) {
        throw new DatabaseError('Database pool not initialized');
      }

      logger.debug('Acquiring database client', { clientKey });
      const client = await this.pool.connect();
      const duration = Date.now() - start;

      logger.debug('Database client acquired successfully', {
        clientKey,
        duration,
        processId: (client as any).processID,
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
      });

      return client;
    } catch (error) {
      const duration = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to acquire database client:', {
        clientKey,
        duration,
        error: errorMessage,
        stack: errorStack,
        totalCount: this.pool?.totalCount || 0,
        idleCount: this.pool?.idleCount || 0,
        waitingCount: this.pool?.waitingCount || 0,
      });

      throw new DatabaseError(`Failed to acquire database client: ${errorMessage}`);
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const start = Date.now();
    let client: PoolClient | null = null;

    try {
      if (!this.pool) {
        throw new DatabaseError('Database pool not initialized');
      }

      logger.debug('Starting database transaction', { transactionId });
      client = await this.getClient();

      await client.query('BEGIN');
      logger.debug('Transaction started', {
        transactionId,
        processId: (client as any).processID
      });

      const result = await callback(client);

      await client.query('COMMIT');
      const duration = Date.now() - start;

      logger.info('Database transaction completed successfully', {
        transactionId,
        duration,
        processId: (client as any).processID,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      if (client) {
        try {
          await client.query('ROLLBACK');
          logger.warn('Database transaction rolled back', {
            transactionId,
            duration,
            error: errorMessage,
            processId: (client as any).processID,
          });
        } catch (rollbackError) {
          const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          logger.error('Failed to rollback transaction:', {
            transactionId,
            rollbackError: rollbackErrorMessage,
            originalError: errorMessage,
          });
        }
      }

      logger.error('Database transaction failed:', {
        transactionId,
        duration,
        error: errorMessage,
        stack: errorStack,
      });

      throw new DatabaseError(`Transaction failed: ${errorMessage}`);
    } finally {
      if (client) {
        client.release();
        logger.debug('Database client released from transaction', {
          transactionId,
          processId: (client as any).processID,
        });
      }
    }
  }

  getStats(): ConnectionStats {
    if (!this.pool) {
      return {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        activeCount: 0,
        averageResponseTime: 0,
      };
    }

    const activeCount = this.pool.totalCount - this.pool.idleCount;
    const averageResponseTime = this.getAverageResponseTime();

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      activeCount,
      averageResponseTime,
    };
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const startTime = Date.now();
    let status: 'healthy' | 'unhealthy' = 'healthy';
    const details: any = {};

    try {
      // Test basic connectivity
      const result = await this.query('SELECT NOW() as current_time, 1 as test_value');
      const responseTime = Date.now() - startTime;

      details.connectivity = {
        status: 'ok',
        responseTime,
        timestamp: result[0]?.current_time || undefined,
      };

      // Check pool statistics
      const stats = this.getStats();
      details.pool = {
        ...stats,
        utilizationPercent: stats.totalCount > 0 ? Math.round((stats.activeCount / stats.totalCount) * 100) : 0,
      };

      // Check if any connections are waiting (might indicate pool exhaustion)
      if (stats.waitingCount > 0) {
        status = 'unhealthy';
        details.pool.status = 'exhausted';
      }

      // Check response time thresholds
      if (responseTime > 1000) {
        status = 'unhealthy';
        details.connectivity.status = 'slow';
      }

      // Update last health check timestamp
      this.updateResponseTime(responseTime);

      return { status, details };
    } catch (error) {
      status = 'unhealthy';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      details.error = {
        message: errorMessage,
        code: (error as any).code,
        responseTime: Date.now() - startTime,
      };

      logger.error('Database health check failed:', {
        error: errorMessage,
        stack: errorStack,
        responseTime: Date.now() - startTime,
      });

      return { status, details };
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      const startTime = Date.now();

      try {
        logger.info('Closing database pool...', {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount,
        });

        await this.pool.end();
        const duration = Date.now() - startTime;

        logger.info('Database pool closed successfully', {
          duration,
          finalStats: this.getStats(),
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        logger.error('Error closing database pool:', {
          duration,
          error: errorMessage,
          stack: errorStack,
        });
        throw new DatabaseError(`Pool close failed: ${errorMessage}`);
      } finally {
        this.pool = null;
        this.responseTimes = [];
        this.retryAttempts.clear();
      }
    }
  }
}

// Singleton instance
const databasePool = new DatabasePool();

export default databasePool;
export { DatabasePool, type PoolConfig, type ConnectionStats, type DatabaseConnectionInfo };

// Utility functions for convenience
export const query = <T = any>(text: string, params?: any[]): Promise<T[]> => {
  return databasePool.query<T>(text, params);
};

export const getClient = (): Promise<PoolClient> => {
  return databasePool.getClient();
};

export const transaction = <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  return databasePool.transaction<T>(callback);
};

export const getDatabaseStats = (): ConnectionStats => {
  return databasePool.getStats();
};

export const checkDatabaseHealth = () => {
  return databasePool.healthCheck();
};

export const closeDatabasePool = (): Promise<void> => {
  return databasePool.close();
};