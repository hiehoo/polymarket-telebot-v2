/**
 * Redis Client with Connection Pooling
 * Core Redis client implementation with connection pooling, health monitoring, and metrics
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { AppError, handleError, ErrorType } from '@/utils/error-handler';
import {
  redisConfig,
  redisPoolConfig,
  validateRedisConfig,
  getEnvironmentRedisConfig,
} from '@/config/redis';
import type {
  RedisConnectionStatus,
  RedisHealthStatus,
  RedisMetrics,
  RedisResult,
  BatchOperation,
  BatchResult,
  RedisKey,
  RedisValue,
  RedisField,
  RedisScore,
  RedisChannel,
  RedisPattern,
} from '@/types/redis';

export class RedisClient extends EventEmitter {
  private clients: Map<string, Redis> = new Map();
  private primaryClient: Redis | null = null;
  private connectionStatus: RedisConnectionStatus = 'disconnected';
  private healthStatus: RedisHealthStatus | null = null;
  private metrics: RedisMetrics;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private connectionRetryCount = 0;
  private maxConnectionRetries = 10;
  private isShuttingDown = false;

  constructor() {
    super();
    this.metrics = this.initializeMetrics();
    this.setupErrorHandling();
  }

  /**
   * Initialize Redis connections with connection pooling
   */
  async connect(): Promise<void> {
    try {
      validateRedisConfig();
      const config = getEnvironmentRedisConfig();

      logger.info('Initializing Redis connection', {
        url: config.url?.replace(/\/\/.*@/, '//***@'), // Hide password
        poolConfig: redisPoolConfig,
      });

      // Create primary client
      const redisOptions: any = {
        ...redisPoolConfig,
        enableReadyCheck: true,
        maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
        retryDelayOnFailover: config.retryDelayOnFailover || 100,
        lazyConnect: config.lazyConnect || false,
        keepAlive: config.keepAlive || 30000,
        connectTimeout: config.connectTimeout || 10000,
        commandTimeout: config.commandTimeout || 5000,
        enableOfflineQueue: config.enableOfflineQueue !== false,
        ...config.tls,
      };

      // Use URL or individual config
      this.primaryClient = config.url
        ? new Redis(config.url, redisOptions)
        : new Redis({
            host: config.host || 'localhost',
            port: config.port || 6379,
            password: config.password,
            db: config.database || 0,
            ...redisOptions,
          });

      // Setup event handlers
      this.setupClientEvents(this.primaryClient, 'primary');

      // Connect the client
      if (!config.lazyConnect) {
        await this.primaryClient.connect();
      }

      // Create additional pool clients if needed
      await this.createPoolClients();

      // Start health monitoring
      this.startHealthMonitoring();

      logger.info('Redis client connected successfully', {
        clientType: 'primary',
        poolSize: this.clients.size,
      });

    } catch (error) {
      this.handleConnectionError(error);
      throw new AppError(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorType.DATABASE,
        500
      );
    }
  }

  /**
   * Create additional clients for connection pool
   */
  private async createPoolClients(): Promise<void> {
    const poolSize = redisPoolConfig.max - 1; // Primary client already created

    for (let i = 0; i < poolSize; i++) {
      try {
        const config = getEnvironmentRedisConfig();
        const client = new Redis(config, {
          ...redisPoolConfig,
          lazyConnect: true, // Pool clients connect on demand
        });

        this.setupClientEvents(client, `pool-${i}`);
        this.clients.set(`pool-${i}`, client);

        logger.debug('Pool client created', { clientId: `pool-${i}` });

      } catch (error) {
        logger.warn('Failed to create pool client', {
          clientId: `pool-${i}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Setup event handlers for Redis client
   */
  private setupClientEvents(client: Redis, clientType: string): void {
    client.on('connect', () => {
      logger.debug('Redis client connected', { clientType });
      this.updateConnectionStatus('connected');
      this.emit('connect', { clientType });
    });

    client.on('ready', () => {
      logger.info('Redis client ready', { clientType });
      this.updateConnectionStatus('connected');
      this.connectionRetryCount = 0;
      this.emit('ready', { clientType });
    });

    client.on('error', (error) => {
      logger.error('Redis client error', {
        clientType,
        error: error.message,
        stack: error.stack,
      });
      this.handleConnectionError(error);
      this.emit('error', { clientType, error });
    });

    client.on('close', () => {
      logger.warn('Redis client closed', { clientType });
      this.updateConnectionStatus('disconnected');
      this.emit('close', { clientType });
    });

    client.on('reconnecting', (ms: number) => {
      logger.info('Redis client reconnecting', {
        clientType,
        delay: ms,
        attempt: this.connectionRetryCount,
      });
      this.updateConnectionStatus('reconnecting');
      this.emit('reconnecting', { clientType, delay: ms });
    });

    client.on('end', () => {
      logger.info('Redis client ended', { clientType });
      this.updateConnectionStatus('disconnected');
      this.emit('end', { clientType });
    });
  }

  /**
   * Get an available client from the pool
   */
  private getClient(): Redis {
    if (this.primaryClient && this.primaryClient.status === 'ready') {
      return this.primaryClient;
    }

    // Try pool clients
    for (const [clientId, client] of this.clients) {
      if (client.status === 'ready') {
        return client;
      }
    }

    // If no ready clients, return primary and let it handle connection
    if (!this.primaryClient) {
      throw new AppError('No Redis clients available', ErrorType.DATABASE);
    }
    return this.primaryClient;
  }

  /**
   * Execute Redis command with metrics and error handling
   */
  private async executeCommand<T>(
    operation: string,
    command: (client: Redis) => Promise<T>,
    key?: string
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const client = this.getClient();
      const result = await command(client);

      // Update metrics
      const operationTime = Date.now() - startTime;
      this.updateMetrics(operation, operationTime, true);

      logger.debug('Redis command executed', {
        operation,
        key,
        operationTime,
        clientStatus: client.status,
      });

      return result;

    } catch (error) {
      const operationTime = Date.now() - startTime;
      this.updateMetrics(operation, operationTime, false);

      logger.error('Redis command failed', {
        operation,
        key,
        operationTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        // Handle specific Redis errors
        if (error.message.includes('ECONNREFUSED')) {
          throw new AppError('Redis connection refused', ErrorType.DATABASE, 503);
        }
        if (error.message.includes('TIMEOUT')) {
          throw new AppError('Redis operation timeout', ErrorType.DATABASE, 408);
        }
        if (error.message.includes('NOAUTH')) {
          throw new AppError('Redis authentication failed', ErrorType.DATABASE, 401);
        }
      }

      throw error;
    }
  }

  // Add scan method support
  async scan(cursor: string, ...args: any[]): Promise<[string, string[]]> {
    return this.executeCommand('scan', async (client) => {
      if ('scan' in client && typeof client.scan === 'function') {
        return client.scan(cursor, ...args);
      } else {
        // Fallback for older Redis versions or different client implementations
        throw new Error('SCAN command not supported by current Redis client');
      }
    });
  }

  // Add incr method support for rate limiting
  async incr(key: RedisKey): Promise<number> {
    return this.executeCommand('incr', async (client) => {
      if ('incr' in client && typeof client.incr === 'function') {
        return client.incr(key);
      } else {
        // Fallback
        const current = await client.get(key) || '0';
        const newValue = parseInt(current, 10) + 1;
        await client.set(key, newValue.toString());
        return newValue;
      }
    });
  }

  /**
   * Basic Redis operations
   */
  async get(key: RedisKey): Promise<string | null> {
    return this.executeCommand('get', (client) => client.get(key), key);
  }

  async set(key: RedisKey, value: RedisValue, ttl?: number): Promise<string> {
    return this.executeCommand('set', async (client) => {
      if (ttl) {
        return client.setex(key, ttl, value);
      }
      return client.set(key, value);
    }, key);
  }

  async del(key: RedisKey | RedisKey[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    return this.executeCommand('del', (client) => client.del(...keys), keys.join(','));
  }

  async exists(key: RedisKey): Promise<number> {
    return this.executeCommand('exists', (client) => client.exists(key), key);
  }

  async expire(key: RedisKey, seconds: number): Promise<number> {
    return this.executeCommand('expire', (client) => client.expire(key, seconds), key);
  }

  async ttl(key: RedisKey): Promise<number> {
    return this.executeCommand('ttl', (client) => client.ttl(key), key);
  }

  /**
   * Hash operations
   */
  async hget(key: RedisKey, field: RedisField): Promise<string | null> {
    return this.executeCommand('hget', (client) => client.hget(key, field), `${key}:${field}`);
  }

  async hset(key: RedisKey, field: RedisField, value: RedisValue): Promise<number> {
    return this.executeCommand('hset', (client) => client.hset(key, field, value), `${key}:${field}`);
  }

  async hgetall(key: RedisKey): Promise<Record<string, string>> {
    return this.executeCommand('hgetall', (client) => client.hgetall(key), key);
  }

  async hdel(key: RedisKey, field: RedisField | RedisField[]): Promise<number> {
    const fields = Array.isArray(field) ? field : [field];
    return this.executeCommand('hdel', (client) => client.hdel(key, ...fields), key);
  }

  async hexists(key: RedisKey, field: RedisField): Promise<number> {
    return this.executeCommand('hexists', (client) => client.hexists(key, field), `${key}:${field}`);
  }

  /**
   * Set operations
   */
  async sadd(key: RedisKey, member: RedisValue | RedisValue[]): Promise<number> {
    const members = Array.isArray(member) ? member : [member];
    return this.executeCommand('sadd', (client) => client.sadd(key, ...members), key);
  }

  async srem(key: RedisKey, member: RedisValue | RedisValue[]): Promise<number> {
    const members = Array.isArray(member) ? member : [member];
    return this.executeCommand('srem', (client) => client.srem(key, ...members), key);
  }

  async smembers(key: RedisKey): Promise<string[]> {
    return this.executeCommand('smembers', (client) => client.smembers(key), key);
  }

  async sismember(key: RedisKey, member: RedisValue): Promise<number> {
    return this.executeCommand('sismember', (client) => client.sismember(key, member), key);
  }

  /**
   * Sorted set operations
   */
  async zadd(key: RedisKey, score: RedisScore, member: RedisValue): Promise<number> {
    return this.executeCommand('zadd', (client) => client.zadd(key, score, member), key);
  }

  async zrem(key: RedisKey, member: RedisValue): Promise<number> {
    return this.executeCommand('zrem', (client) => client.zrem(key, member), key);
  }

  async zrange(key: RedisKey, start: number, stop: number): Promise<string[]> {
    return this.executeCommand('zrange', (client) => client.zrange(key, start, stop), key);
  }

  async zscore(key: RedisKey, member: RedisValue): Promise<string | null> {
    return this.executeCommand('zscore', (client) => client.zscore(key, member), key);
  }

  /**
   * List operations
   */
  async lpush(key: RedisKey, element: RedisValue | RedisValue[]): Promise<number> {
    const elements = Array.isArray(element) ? element : [element];
    return this.executeCommand('lpush', (client) => client.lpush(key, ...elements), key);
  }

  async rpush(key: RedisKey, element: RedisValue | RedisValue[]): Promise<number> {
    const elements = Array.isArray(element) ? element : [element];
    return this.executeCommand('rpush', (client) => client.rpush(key, ...elements), key);
  }

  async lpop(key: RedisKey): Promise<string | null> {
    return this.executeCommand('lpop', (client) => client.lpop(key), key);
  }

  async rpop(key: RedisKey): Promise<string | null> {
    return this.executeCommand('rpop', (client) => client.rpop(key), key);
  }

  async lrange(key: RedisKey, start: number, stop: number): Promise<string[]> {
    return this.executeCommand('lrange', (client) => client.lrange(key, start, stop), key);
  }

  /**
   * Batch operations
   */
  async batch(operations: BatchOperation[]): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];
    let successful = 0;
    let failed = 0;

    try {
      const client = this.getClient();
      const pipeline = client.pipeline();

      // Add operations to pipeline
      for (const operation of operations) {
        try {
          switch (operation.type) {
            case 'get':
              pipeline.get(operation.key);
              break;
            case 'set':
              if (operation.ttl) {
                pipeline.setex(operation.key, operation.ttl, operation.value!);
              } else {
                pipeline.set(operation.key, operation.value!);
              }
              break;
            case 'del':
              pipeline.del(operation.key);
              break;
            case 'expire':
              pipeline.expire(operation.key, operation.ttl!);
              break;
            case 'hget':
              pipeline.hget(operation.key, operation.field!);
              break;
            case 'hset':
              pipeline.hset(operation.key, operation.field!, operation.value!);
              break;
            case 'publish':
              pipeline.publish(operation.channel!, operation.value!);
              break;
            default:
              throw new Error(`Unsupported operation type: ${(operation as any).type}`);
          }
          results.push({ operation, success: true });
        } catch (error) {
          results.push({
            operation,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          failed++;
        }
      }

      // Execute pipeline
      const pipelineResults = await pipeline.exec();

      // Process results
      pipelineResults?.forEach(([err, result], index) => {
        if (err) {
          results[index].success = false;
          results[index].error = err.message;
          failed++;
        } else {
          successful++;
        }
      });

    } catch (error) {
      logger.error('Batch operation failed', {
        operationsCount: operations.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Mark all operations as failed
      results.forEach((result, index) => {
        if (result.success) {
          result.success = false;
          result.error = 'Batch operation failed';
          failed++;
          successful--;
        }
      });
    }

    const totalTime = Date.now() - startTime;

    logger.info('Batch operation completed', {
      totalOperations: operations.length,
      successful,
      failed,
      totalTime,
    });

    return { successful, failed, results, totalTime };
  }

  /**
   * Health monitoring
   */
  private startHealthMonitoring(): void {
    const interval = parseInt(process.env['REDIS_HEALTH_CHECK_INTERVAL'] || '30000', 10);

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.checkHealth();
      } catch (error) {
        logger.error('Health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }, interval);
  }

  private async checkHealth(): Promise<RedisHealthStatus> {
    const startTime = Date.now();

    try {
      const client = this.getClient();
      const pong = await client.ping();

      if (pong !== 'PONG') {
        throw new Error('Health check failed: Invalid PING response');
      }

      // Get server info
      const info = await client.info('memory,server,stats');
      const parsedInfo = this.parseRedisInfo(info);

      const responseTime = Date.now() - startTime;

      this.healthStatus = {
        status: 'healthy',
        connected: true,
        responseTime,
        memoryUsage: parseInt(parsedInfo.used_memory || '0', 10),
        keyCount: 0, // Would need to scan all databases
        uptime: parseInt(parsedInfo.uptime_in_seconds || '0', 10),
        version: parsedInfo.redis_version || 'unknown',
        errorCount: this.metrics.performance.totalOperations > 0
          ? Math.floor((this.metrics.operations.get + this.metrics.operations.set + this.metrics.operations.del) *
                     (this.metrics.performance.errorRate / 100))
          : 0,
        timestamp: Date.now(),
      };

      return this.healthStatus;

    } catch (error) {
      const responseTime = Date.now() - startTime;

      this.healthStatus = {
        status: 'unhealthy',
        connected: false,
        responseTime,
        memoryUsage: 0,
        keyCount: 0,
        uptime: 0,
        version: 'unknown',
        errorCount: this.metrics.performance.totalOperations,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      };

      throw error;
    }
  }

  private parseRedisInfo(info: string): Record<string, string> {
    const lines = info.split('\r\n');
    const parsed: Record<string, string> = {};

    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          parsed[key.trim()] = value.trim();
        }
      }
    }

    return parsed;
  }

  /**
   * Metrics and monitoring
   */
  private initializeMetrics(): RedisMetrics {
    return {
      operations: {
        get: 0,
        set: 0,
        del: 0,
        hget: 0,
        hset: 0,
        pub: 0,
        sub: 0,
        expire: 0,
      },
      performance: {
        avgResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        totalOperations: 0,
        errorRate: 0,
      },
      memory: {
        used: 0,
        peak: 0,
        limit: 0,
        utilizationPercent: 0,
      },
      connections: {
        active: 1,
        idle: redisPoolConfig.max - 1,
        total: redisPoolConfig.max,
      },
    };
  }

  private updateMetrics(operation: string, responseTime: number, success: boolean): void {
    // Update operation counts
    if (operation in this.metrics.operations) {
      (this.metrics.operations as any)[operation]++;
    }

    // Update performance metrics
    this.metrics.performance.totalOperations++;

    const currentAvg = this.metrics.performance.avgResponseTime;
    const newTotal = this.metrics.performance.totalOperations;
    this.metrics.performance.avgResponseTime = ((currentAvg * (newTotal - 1)) + responseTime) / newTotal;

    this.metrics.performance.minResponseTime = Math.min(this.metrics.performance.minResponseTime, responseTime);
    this.metrics.performance.maxResponseTime = Math.max(this.metrics.performance.maxResponseTime, responseTime);

    if (!success) {
      const errorCount = this.metrics.performance.errorRate * this.metrics.performance.totalOperations;
      this.metrics.performance.errorRate = (errorCount + 1) / this.metrics.performance.totalOperations * 100;
    }
  }

  /**
   * Utility methods
   */
  private updateConnectionStatus(status: RedisConnectionStatus): void {
    const previousStatus = this.connectionStatus;
    this.connectionStatus = status;

    if (previousStatus !== status) {
      logger.info('Redis connection status changed', {
        from: previousStatus,
        to: status,
      });

      this.emit('statusChange', { from: previousStatus, to: status });
    }
  }

  private handleConnectionError(error: any): void {
    this.updateConnectionStatus('error');

    if (this.connectionRetryCount < this.maxConnectionRetries) {
      this.connectionRetryCount++;
      const delay = Math.min(1000 * Math.pow(2, this.connectionRetryCount), 30000);

      logger.warn('Scheduling reconnection attempt', {
        attempt: this.connectionRetryCount,
        maxRetries: this.maxConnectionRetries,
        delay,
      });

      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.connect().catch((err) => {
            logger.error('Reconnection failed', { error: err.message });
          });
        }
      }, delay);
    }
  }

  private setupErrorHandling(): void {
    // Handle process termination
    const gracefulShutdown = () => {
      this.disconnect().catch((error) => {
        logger.error('Error during shutdown', { error: error.message });
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGUSR2', gracefulShutdown); // nodemon restart
  }

  /**
   * Public interface methods
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    const disconnectPromises: Promise<void>[] = [];

    // Disconnect all clients
    if (this.primaryClient) {
      disconnectPromises.push(this.primaryClient.disconnect());
    }

    for (const [clientId, client] of this.clients) {
      disconnectPromises.push(client.disconnect());
    }

    try {
      await Promise.all(disconnectPromises);
      logger.info('Redis clients disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting Redis clients', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    this.clients.clear();
    this.primaryClient = null;
    this.updateConnectionStatus('disconnected');
  }

  isHealthy(): boolean {
    return this.connectionStatus === 'connected' &&
           (this.healthStatus?.status === 'healthy' || this.healthStatus === null);
  }

  getConnectionStatus(): RedisConnectionStatus {
    return this.connectionStatus;
  }

  getHealthStatus(): Promise<RedisHealthStatus> {
    return this.checkHealth();
  }

  getMetrics(): RedisMetrics {
    return { ...this.metrics };
  }

  async flushAll(): Promise<string> {
    return this.executeCommand('flushall', (client) => client.flushall());
  }

  async info(section?: string): Promise<string> {
    return this.executeCommand('info', (client) => client.info(section));
  }
}

// Create and export singleton instance
export const redisClient = new RedisClient();

// Export types and utilities
export { RedisClient };
export type { RedisConnectionStatus, RedisHealthStatus, RedisMetrics };