import EventEmitter from 'events';
import logger from '@/utils/logger';
import { ApiError, DatabaseError, handleError } from '@/utils/error-handler';
import {
  DataAccessQuery,
  DataAccessResult,
  NormalizedMarketData,
  NormalizedTransaction,
  NormalizedPosition,
  ProcessingEvent,
  NotificationTrigger,
  CacheOptions,
  HealthCheckResult,
  ProcessingMetrics,
} from '@/types/data-processing';
import {
  PolymarketCondition,
  PolymarketUser,
} from '@/types/polymarket';
import {
  polymarketCacheConfig,
  polymarketMonitoringConfig,
} from '@/config/polymarket';
import databasePool from '@/services/database/connection-pool';
import DataProcessor from '@/services/data-processor';
import PolymarketRestClient from '@/services/polymarket/rest-client';

export class DataAccessLayer extends EventEmitter {
  private dataProcessor: DataProcessor;
  private restClient: PolymarketRestClient;
  private cache: Map<string, { value: any; expires: number; tags: string[] }> = new Map();
  private metrics: ProcessingMetrics;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private connectionStats = {
    database: { connected: true, lastCheck: new Date(), responseTime: 0 },
    redis: { connected: true, lastCheck: new Date(), responseTime: 0 },
    processor: { running: true, lastCheck: new Date(), queueSize: 0 },
  };

  constructor(dataProcessor: DataProcessor, restClient: PolymarketRestClient) {
    super();

    this.dataProcessor = dataProcessor;
    this.restClient = restClient;

    this.metrics = {
      processedMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      uptime: 0,
      memoryUsage: 0,
      bufferUtilization: 0,
      connectionStatus: 'connected',
      errorRate: 0,
    };

    this.setupEventListeners();
    this.setupHealthChecks();
    this.startMetricsCollection();
    this.startCacheCleanup();
  }

  private setupEventListeners(): void {
    // Listen to data processor events
    this.dataProcessor.on('metrics', (metrics: ProcessingMetrics) => {
      this.metrics = metrics;
      this.emit('metrics', metrics);
    });

    this.dataProcessor.on('notificationTrigger', (trigger: NotificationTrigger) => {
      this.emit('notificationTrigger', trigger);
    });

    this.dataProcessor.on('batchProcessed', (data: any) => {
      this.connectionStats.processor = {
        running: true,
        lastCheck: new Date(),
        queueSize: data.queueSize,
      };
    });

    this.dataProcessor.on('batchError', (data: any) => {
      this.connectionStats.processor.running = false;
      logger.error('Data processor batch error', { error: data.error });
    });

    // Listen to REST client events
    this.restClient.on('stats', (stats: any) => {
      this.connectionStats.database.connected = stats.requestsMade > 0;
      this.connectionStats.database.lastCheck = new Date();
      this.connectionStats.database.responseTime = stats.averageResponseTime;
    });

    // Database pool events
    databasePool.on('connect', () => {
      this.connectionStats.database.connected = true;
      this.connectionStats.database.lastCheck = new Date();
    });

    databasePool.on('error', (error: any) => {
      this.connectionStats.database.connected = false;
      logger.error('Database connection error', { error: error.message });
    });
  }

  private setupHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        this.emit('healthCheck', health);

        if (health.status === 'unhealthy') {
          logger.error('System health check failed', { health });
        } else if (health.status === 'degraded') {
          logger.warn('System health check degraded', { health });
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Health check failed', { error: errorMessage });
      }
    }, polymarketMonitoringConfig.healthCheck.interval);
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      this.updateMetrics();
      this.emit('metrics', this.metrics);
    }, polymarketMonitoringConfig.metrics.interval);
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      this.cleanupCache();
    }, 300000); // Every 5 minutes
  }

  private updateMetrics(): void {
    const memUsage = process.memoryUsage();

    this.metrics.processedMessages = this.dataProcessor.getStats().totalProcessed;
    this.metrics.failedMessages = this.dataProcessor.getStats().processingErrors;
    this.metrics.averageProcessingTime = this.dataProcessor.getStats().averageProcessingTime;
    this.metrics.uptime = process.uptime();
    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB
    this.metrics.bufferUtilization = (this.dataProcessor.getStats().queueSize / 10000) * 100; // Assume 10k buffer
    this.metrics.errorRate = this.dataProcessor.getStats().totalProcessed > 0
      ? (this.dataProcessor.getStats().processingErrors / this.dataProcessor.getStats().totalProcessed) * 100
      : 0;
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cache cleanup completed', {
        cleanedCount,
        remainingCount: this.cache.size,
      });
    }
  }

  // Cache implementation

  private async getFromCache<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  private async setCache<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const expires = Date.now() + (options?.ttl || 300) * 1000;
    this.cache.set(key, {
      value,
      expires,
      tags: options?.tags || [],
    });

    // Clean up if cache gets too large
    if (this.cache.size > 10000) {
      this.cleanupCache();
    }
  }

  private async deleteCache(key: string): Promise<void> {
    this.cache.delete(key);
  }

  private async clearCacheByPattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  private async clearCacheByTag(tag: string): Promise<void> {
    for (const [key, item] of this.cache.entries()) {
      if (item.tags.includes(tag)) {
        this.cache.delete(key);
      }
    }
  }

  getCacheStats(): { hits: number; misses: number; hitRate: number; size: number } {
    // Mock stats - in real implementation, these would be tracked
    return {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: this.cache.size,
    };
  }

  // Market data access methods

  async getMarketData(params: {
    conditionId?: string;
    symbol?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
    includeHistory?: boolean;
  }): Promise<DataAccessResult<NormalizedMarketData>> {
    const startTime = Date.now();
    const cacheKey = `marketData:${JSON.stringify(params)}`;

    try {
      // Check cache first
      const cached = await this.getFromCache<DataAccessResult<NormalizedMarketData>>(cacheKey);
      if (cached) {
        return {
          ...cached,
          metadata: {
            ...cached.metadata,
            queryTime: Date.now() - startTime,
            cacheHit: true,
          },
        };
      }

      let data: NormalizedMarketData[];
      let total: number;

      if (params.conditionId) {
        // Get specific condition data
        data = await this.getConditionMarketData(params.conditionId, params);
        total = data.length;
      } else {
        // Get all market data with filters
        const query = this.buildMarketDataQuery(params);
        const result = await databasePool.query<any[]>(query.text, query.params);
        data = result.map(this.mapRowToMarketData);
        total = data.length;
      }

      // Apply pagination
      if (params.limit || params.offset) {
        const limit = params.limit || 50;
        const offset = params.offset || 0;
        data = data.slice(offset, offset + limit);
      }

      // Include historical data if requested
      if (params.includeHistory && data.length > 0) {
        const historicalData = await this.getHistoricalMarketData(data[0].conditionId, params);
        // Merge with current data - implementation depends on requirements
      }

      const result: DataAccessResult<NormalizedMarketData> = {
        data,
        total,
        hasMore: (params.offset || 0) + data.length < total,
        metadata: {
          queryTime: Date.now() - startTime,
          cacheHit: false,
          source: 'database',
        },
      };

      // Cache result
      await this.setCache(cacheKey, result, {
        ttl: polymarketCacheConfig.marketData.ttl,
        tags: polymarketCacheConfig.marketData.tags,
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to get market data: ${errorMessage}`);
    }
  }

  private async getConditionMarketData(conditionId: string, params: any): Promise<NormalizedMarketData[]> {
    const query = `
      SELECT * FROM polymarket_market_data
      WHERE condition_id = $1
      ${params.startTime ? 'AND timestamp >= $2' : ''}
      ${params.endTime ? (params.startTime ? 'AND timestamp >= $3' : 'AND timestamp >= $2') : ''}
      ORDER BY timestamp DESC
      ${params.limit ? `LIMIT ${params.limit}` : ''}
      ${params.offset ? `OFFSET ${params.offset}` : ''}
    `;

    const queryParams = [conditionId];
    if (params.startTime) queryParams.push(params.startTime);
    if (params.endTime) queryParams.push(params.endTime);

    const result = await databasePool.query<any[]>(query, queryParams);
    return result.map(this.mapRowToMarketData);
  }

  private buildMarketDataQuery(params: any): { text: string; params: any[] } {
    let query = 'SELECT * FROM polymarket_market_data WHERE 1=1';
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (params.symbol) {
      query += ` AND symbol = $${paramIndex++}`;
      queryParams.push(params.symbol);
    }

    if (params.startTime) {
      query += ` AND timestamp >= $${paramIndex++}`;
      queryParams.push(params.startTime);
    }

    if (params.endTime) {
      query += ` AND timestamp <= $${paramIndex++}`;
      queryParams.push(params.endTime);
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    return { text: query, params: queryParams };
  }

  private async getHistoricalMarketData(conditionId: string, params: any): Promise<any[]> {
    // Implementation would fetch historical price data
    // This could be from a separate historical data table or API
    return [];
  }

  private mapRowToMarketData(row: any): NormalizedMarketData {
    return {
      conditionId: row.condition_id,
      symbol: row.symbol,
      question: row.question,
      outcomes: JSON.parse(row.outcomes),
      marketData: {
        currentPrice: row.current_price,
        probability: row.probability,
        volume24h: row.volume_24h,
        priceChange24h: row.price_change_24h,
        liquidity: row.liquidity,
        timestamp: row.timestamp,
      },
      metadata: JSON.parse(row.metadata),
    };
  }

  // Transaction data access methods

  async getTransactions(params: {
    user?: string;
    conditionId?: string;
    type?: string[];
    outcome?: string;
    minValue?: number;
    maxValue?: number;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<DataAccessResult<NormalizedTransaction>> {
    const startTime = Date.now();
    const cacheKey = `transactions:${JSON.stringify(params)}`;

    try {
      // Check cache first
      const cached = await this.getFromCache<DataAccessResult<NormalizedTransaction>>(cacheKey);
      if (cached) {
        return {
          ...cached,
          metadata: {
            ...cached.metadata,
            queryTime: Date.now() - startTime,
            cacheHit: true,
          },
        };
      }

      const query = this.buildTransactionQuery(params);
      const result = await databasePool.query<any[]>(query.text, query.params);
      const data = result.map(this.mapRowToTransaction);

      // Apply sorting if specified
      if (params.sortBy) {
        data.sort((a, b) => {
          const aValue = (a as any)[params.sortBy!];
          const bValue = (b as any)[params.sortBy!];

          if (params.sortOrder === 'desc') {
            return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
          } else {
            return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
          }
        });
      }

      const queryResult: DataAccessResult<NormalizedTransaction> = {
        data,
        total: data.length,
        hasMore: (params.offset || 0) + data.length < data.length,
        metadata: {
          queryTime: Date.now() - startTime,
          cacheHit: false,
          source: 'database',
        },
      };

      // Cache result
      await this.setCache(cacheKey, queryResult, {
        ttl: polymarketCacheConfig.transactions.ttl,
        tags: polymarketCacheConfig.transactions.tags,
      });

      return queryResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to get transactions: ${errorMessage}`);
    }
  }

  private buildTransactionQuery(params: any): { text: string; params: any[] } {
    let query = 'SELECT * FROM polymarket_transactions WHERE 1=1';
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (params.user) {
      query += ` AND user_address = $${paramIndex++}`;
      queryParams.push(params.user);
    }

    if (params.conditionId) {
      query += ` AND condition_id = $${paramIndex++}`;
      queryParams.push(params.conditionId);
    }

    if (params.type && params.type.length > 0) {
      query += ` AND type = ANY($${paramIndex++})`;
      queryParams.push(params.type);
    }

    if (params.outcome) {
      query += ` AND outcome = $${paramIndex++}`;
      queryParams.push(params.outcome);
    }

    if (params.minValue) {
      query += ` AND value >= $${paramIndex++}`;
      queryParams.push(params.minValue);
    }

    if (params.maxValue) {
      query += ` AND value <= $${paramIndex++}`;
      queryParams.push(params.maxValue);
    }

    if (params.startTime) {
      query += ` AND timestamp >= $${paramIndex++}`;
      queryParams.push(params.startTime);
    }

    if (params.endTime) {
      query += ` AND timestamp <= $${paramIndex++}`;
      queryParams.push(params.endTime);
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    return { text: query, params: queryParams };
  }

  private mapRowToTransaction(row: any): NormalizedTransaction {
    return {
      id: row.id,
      user: row.user_address,
      type: row.type,
      conditionId: row.condition_id,
      outcome: row.outcome,
      amount: row.amount,
      price: row.price,
      value: row.value,
      fee: row.fee,
      timestamp: row.timestamp,
      hash: row.hash,
      blockNumber: row.block_number,
      gasUsed: row.gas_used,
      metadata: JSON.parse(row.metadata),
    };
  }

  // Position data access methods

  async getPositions(params: {
    user?: string;
    conditionId?: string;
    side?: string;
    status?: string[];
    minSize?: number;
    maxSize?: number;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
    includeSettled?: boolean;
  }): Promise<DataAccessResult<NormalizedPosition>> {
    const startTime = Date.now();
    const cacheKey = `positions:${JSON.stringify(params)}`;

    try {
      // Check cache first
      const cached = await this.getFromCache<DataAccessResult<NormalizedPosition>>(cacheKey);
      if (cached) {
        return {
          ...cached,
          metadata: {
            ...cached.metadata,
            queryTime: Date.now() - startTime,
            cacheHit: true,
          },
        };
      }

      const query = this.buildPositionQuery(params);
      const result = await databasePool.query<any[]>(query.text, query.params);
      const data = result.map(this.mapRowToPosition);

      const queryResult: DataAccessResult<NormalizedPosition> = {
        data,
        total: data.length,
        hasMore: (params.offset || 0) + data.length < data.length,
        metadata: {
          queryTime: Date.now() - startTime,
          cacheHit: false,
          source: 'database',
        },
      };

      // Cache result
      await this.setCache(cacheKey, queryResult, {
        ttl: polymarketCacheConfig.userPositions.ttl,
        tags: polymarketCacheConfig.userPositions.tags,
      });

      return queryResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to get positions: ${errorMessage}`);
    }
  }

  private buildPositionQuery(params: any): { text: string; params: any[] } {
    let query = 'SELECT * FROM polymarket_positions WHERE 1=1';
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (params.user) {
      query += ` AND user_address = $${paramIndex++}`;
      queryParams.push(params.user);
    }

    if (params.conditionId) {
      query += ` AND condition_id = $${paramIndex++}`;
      queryParams.push(params.conditionId);
    }

    if (params.side) {
      query += ` AND side = $${paramIndex++}`;
      queryParams.push(params.side);
    }

    if (params.status && params.status.length > 0) {
      query += ` AND status = ANY($${paramIndex++})`;
      queryParams.push(params.status);
    }

    if (params.minSize) {
      query += ` AND size >= $${paramIndex++}`;
      queryParams.push(params.minSize);
    }

    if (params.maxSize) {
      query += ` AND size <= $${paramIndex++}`;
      queryParams.push(params.maxSize);
    }

    if (params.startTime) {
      query += ` AND created_at >= $${paramIndex++}`;
      queryParams.push(params.startTime);
    }

    if (params.endTime) {
      query += ` AND updated_at <= $${paramIndex++}`;
      queryParams.push(params.endTime);
    }

    if (!params.includeSettled) {
      query += ' AND status != \'SETTLED\'';
    }

    query += ' ORDER BY updated_at DESC';

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    return { text: query, params: queryParams };
  }

  private mapRowToPosition(row: any): NormalizedPosition {
    return {
      id: row.id,
      user: row.user_address,
      conditionId: row.condition_id,
      outcome: row.outcome,
      side: row.side,
      size: row.size,
      averagePrice: row.average_price,
      currentPrice: row.current_price,
      unrealizedPnl: row.unrealized_pnl,
      realizedPnl: row.realized_pnl,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      payouts: row.payouts ? JSON.parse(row.payouts) : undefined,
      metadata: JSON.parse(row.metadata),
    };
  }

  // Condition data access methods

  async getConditions(params: {
    category?: string;
    tags?: string[];
    status?: string[];
    searchText?: string;
    limit?: number;
    offset?: number;
  }): Promise<DataAccessResult<PolymarketCondition>> {
    const startTime = Date.now();
    const cacheKey = `conditions:${JSON.stringify(params)}`;

    try {
      // Check cache first
      const cached = await this.getFromCache<DataAccessResult<PolymarketCondition>>(cacheKey);
      if (cached) {
        return {
          ...cached,
          metadata: {
            ...cached.metadata,
            queryTime: Date.now() - startTime,
            cacheHit: true,
          },
        };
      }

      // Try to get from REST API first for fresh data
      let data: PolymarketCondition[];
      try {
        data = await this.restClient.getConditions({
          limit: params.limit,
          offset: params.offset,
          category: params.category,
          status: params.status?.[0], // API might not support array
        });
      } catch (apiError) {
        // Fallback to database if API fails
        logger.warn('REST API failed, falling back to database', {
          error: apiError instanceof Error ? apiError.message : String(apiError),
        });

        const query = this.buildConditionQuery(params);
        const result = await databasePool.query<any[]>(query.text, query.params);
        data = result.map(this.mapRowToCondition);
      }

      const queryResult: DataAccessResult<PolymarketCondition> = {
        data,
        total: data.length,
        hasMore: (params.offset || 0) + data.length < data.length,
        metadata: {
          queryTime: Date.now() - startTime,
          cacheHit: false,
          source: 'api',
        },
      };

      // Cache result
      await this.setCache(cacheKey, queryResult, {
        ttl: polymarketCacheConfig.conditions.ttl,
        tags: polymarketCacheConfig.conditions.tags,
      });

      return queryResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to get conditions: ${errorMessage}`);
    }
  }

  private buildConditionQuery(params: any): { text: string; params: any[] } {
    let query = 'SELECT * FROM polymarket_conditions WHERE 1=1';
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (params.category) {
      query += ` AND category = $${paramIndex++}`;
      queryParams.push(params.category);
    }

    if (params.status && params.status.length > 0) {
      query += ` AND status = ANY($${paramIndex++})`;
      queryParams.push(params.status);
    }

    if (params.searchText) {
      query += ` AND (question ILIKE $${paramIndex++} OR description ILIKE $${paramIndex++})`;
      queryParams.push(`%${params.searchText}%`, `%${params.searchText}%`);
    }

    query += ' ORDER BY created_at DESC';

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      queryParams.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      queryParams.push(params.offset);
    }

    return { text: query, params: queryParams };
  }

  private mapRowToCondition(row: any): PolymarketCondition {
    return {
      id: row.id,
      question: row.question,
      description: row.description,
      outcomes: JSON.parse(row.outcomes),
      endTime: row.end_time,
      resolveTime: row.resolve_time,
      status: row.status,
      category: row.category,
      tags: row.tags ? JSON.parse(row.tags) : [],
      volume: row.volume,
      liquidity: row.liquidity,
      outcomesWithPrices: row.outcomes_with_prices ? JSON.parse(row.outcomes_with_prices) : undefined,
      resolution: row.resolution ? JSON.parse(row.resolution) : undefined,
    };
  }

  // User data access methods

  async getUser(walletAddress: string): Promise<PolymarketUser | null> {
    const cacheKey = `user:${walletAddress}`;

    try {
      // Check cache first
      const cached = await this.getFromCache<PolymarketUser>(cacheKey);
      if (cached) {
        return cached;
      }

      // Try REST API first
      let user: PolymarketUser;
      try {
        user = await this.restClient.getUser(walletAddress);
      } catch (apiError) {
        // Fallback to database
        logger.warn('REST API failed for user, falling back to database', {
          walletAddress,
          error: apiError instanceof Error ? apiError.message : String(apiError),
        });

        const result = await databasePool.query<any[]>(
          'SELECT * FROM polymarket_users WHERE address = $1',
          [walletAddress]
        );

        if (result.length === 0) {
          return null;
        }

        user = this.mapRowToUser(result[0]);
      }

      // Cache result
      await this.setCache(cacheKey, user, {
        ttl: polymarketCacheConfig.userPositions.ttl,
        tags: polymarketCacheConfig.userPositions.tags,
      });

      return user;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to get user ${walletAddress}: ${errorMessage}`);
    }
  }

  private mapRowToUser(row: any): PolymarketUser {
    return {
      address: row.address,
      username: row.username,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      totalVolume: row.total_volume,
      totalProfit: row.total_profit,
      winRate: row.win_rate,
      activePositions: row.active_positions,
      settledPositions: row.settled_positions,
    };
  }

  // Health check method

  async checkHealth(): Promise<HealthCheckResult> {
    const timestamp = new Date();
    const errors: string[] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    try {
      // Check database health
      const dbHealth = await databasePool.healthCheck();
      this.connectionStats.database.connected = dbHealth.status === 'healthy';
      this.connectionStats.database.responseTime = dbHealth.details.connectivity?.responseTime || 0;

      if (dbHealth.status !== 'healthy') {
        errors.push(`Database: ${dbHealth.status}`);
        overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
      }

      // Check data processor health
      const processorStats = await this.dataProcessor.getStats();
      this.connectionStats.processor.running = processorStats.queueSize >= 0;
      this.connectionStats.processor.queueSize = processorStats.queueSize;

      if (processorStats.queueSize > 1000) {
        errors.push(`Processor queue too large: ${processorStats.queueSize}`);
        overallStatus = 'degraded';
      }

      // Check memory usage
      const memUsage = process.memoryUsage();
      const memUsageMB = memUsage.heapUsed / 1024 / 1024;
      if (memUsageMB > 500) { // 500MB threshold
        errors.push(`High memory usage: ${memUsageMB.toFixed(2)}MB`);
        overallStatus = 'degraded';
      }

      if (memUsageMB > 1000) { // 1GB threshold
        errors.push(`Critical memory usage: ${memUsageMB.toFixed(2)}MB`);
        overallStatus = 'unhealthy';
      }

      // Check error rate
      const errorRate = this.metrics.errorRate;
      if (errorRate > 5) { // 5% threshold
        errors.push(`High error rate: ${errorRate.toFixed(2)}%`);
        overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
      }

      if (errorRate > 15) { // 15% threshold
        errors.push(`Critical error rate: ${errorRate.toFixed(2)}%`);
        overallStatus = 'unhealthy';
      }

      return {
        status: overallStatus,
        timestamp,
        components: {
          websocket: {
            status: 'connected', // Would need WebSocket client instance
            latency: 0,
          },
          restApi: {
            status: this.connectionStats.database.connected ? 'online' : 'error',
            lastRequest: this.connectionStats.database.lastCheck,
            responseTime: this.connectionStats.database.responseTime,
          },
          database: {
            status: dbHealth.status === 'healthy' ? 'connected' : 'error',
            responseTime: dbHealth.details.connectivity?.responseTime,
          },
          redis: {
            status: 'connected', // Would need Redis client instance
            responseTime: this.connectionStats.redis.responseTime,
          },
          processor: {
            status: this.connectionStats.processor.running ? 'running' : 'stalled',
            queueSize: this.connectionStats.processor.queueSize,
            processingRate: this.metrics.processedMessages / this.metrics.uptime || 0,
          },
        },
        metrics: this.metrics,
        errors,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'unhealthy',
        timestamp,
        components: {
          websocket: { status: 'error' },
          restApi: { status: 'error' },
          database: { status: 'error' },
          redis: { status: 'error' },
          processor: { status: 'error', queueSize: 0, processingRate: 0 },
        },
        metrics: this.metrics,
        errors: [`Health check failed: ${errorMessage}`],
      };
    }
  }

  // Utility methods

  async query<T>(dataAccessQuery: DataAccessQuery): Promise<DataAccessResult<T>> {
    switch (dataAccessQuery.type) {
      case 'market-data':
        return (await this.getMarketData(dataAccessQuery.filters)) as DataAccessResult<T>;
      case 'transactions':
        return (await this.getTransactions(dataAccessQuery.filters)) as DataAccessResult<T>;
      case 'positions':
        return (await this.getPositions(dataAccessQuery.filters)) as DataAccessResult<T>;
      case 'conditions':
        return (await this.getConditions(dataAccessQuery.filters)) as DataAccessResult<T>;
      default:
        throw new Error(`Unsupported query type: ${dataAccessQuery.type}`);
    }
  }

  getMetrics(): ProcessingMetrics {
    return { ...this.metrics };
  }

  getConnectionStats(): any {
    return { ...this.connectionStats };
  }

  async clearCache(pattern?: string): Promise<void> {
    if (pattern) {
      await this.clearCacheByPattern(pattern);
    } else {
      this.cache.clear();
    }

    logger.info('Cache cleared', { pattern });
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down data access layer...');

    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Shutdown data processor
    await this.dataProcessor.shutdown();

    // Clear cache
    this.cache.clear();

    logger.info('Data access layer shutdown complete');
    this.emit('shutdown');
  }
}

export default DataAccessLayer;