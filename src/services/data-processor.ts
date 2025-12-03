import EventEmitter from 'events';
import { config } from '@/config';
import logger from '@/utils/logger';
import { ApiError, WebSocketError, handleError } from '@/utils/error-handler';
import {
  ProcessingEvent,
  ProcessingMetrics,
  DataProcessorStats,
  NormalizedMarketData,
  NormalizedTransaction,
  NormalizedPosition,
  DataProcessingError,
  NotificationTrigger,
  EventProcessor,
  DataTransformer,
  QueueManager,
  RetryPolicy,
} from '@/types/data-processing';
import {
  polymarketDataProcessingConfig,
  polymarketEventFilters,
  polymarketNotificationRules,
  polymarketDebugConfig,
} from '@/config/polymarket';
import {
  PolymarketPosition,
  PolymarketTransaction,
  PolymarketCondition,
  PolymarketMarketData,
  PolymarketEvent,
} from '@/types/polymarket';
import databasePool from '@/services/database/connection-pool';

export class DataProcessor extends EventEmitter implements QueueManager, EventProcessor {
  private config = polymarketDataProcessingConfig;
  private metrics: ProcessingMetrics;
  private stats: DataProcessorStats;
  private queue: ProcessingEvent[] = [];
  private processing = false;
  private batchTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private transformers: Map<string, DataTransformer> = new Map();
  private processors: Map<string, EventProcessor> = new Map();
  private retryPolicy: RetryPolicy;
  private lastBatchProcessedAt: Date | null = null;
  private throughputTracker: number[] = [];
  private errorTracker: Map<string, number> = new Map();
  private notificationTriggers: NotificationTrigger[] = [];

  constructor() {
    super();

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

    this.stats = {
      totalProcessed: 0,
      processingErrors: 0,
      averageProcessingTime: 0,
      queueSize: 0,
      batchSize: this.config.batchSize,
    };

    this.retryPolicy = {
      maxRetries: this.config.maxRetries,
      baseDelay: this.config.retryDelay,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitter: true,
      retryableErrors: ['network', 'timeout', 'temporary', 'rate_limit'],
    };

    this.setupTransformers();
    this.setupProcessors();
    this.setupMetricsCollection();
    this.setupBatchProcessing();
  }

  private setupTransformers(): void {
    // Market data transformer
    this.transformers.set('marketData', {
      name: 'marketData',
      async transform(data: PolymarketMarketData): Promise<NormalizedMarketData> {
        return {
          conditionId: data.conditionId,
          symbol: data.conditionId, // Use conditionId as symbol for now
          question: '', // Will be filled by condition lookup
          outcomes: [{
            name: 'YES',
            price: data.price,
            probability: data.probability,
            volume24h: data.volume24h,
            priceChange24h: data.priceChange24h,
          }, {
            name: 'NO',
            price: 1 - data.price,
            probability: 1 - data.probability,
            volume24h: data.volume24h,
            priceChange24h: -(data.priceChange24h || 0),
          }],
          marketData: {
            currentPrice: data.price,
            probability: data.probability,
            volume24h: data.volume24h || 0,
            priceChange24h: data.priceChange24h || 0,
            liquidity: data.liquidity || 0,
            timestamp: new Date(data.timestamp),
          },
          metadata: {
            category: undefined,
            tags: [],
            endTime: new Date(), // Will be filled by condition lookup
            status: 'ACTIVE',
            source: 'polymarket',
            lastUpdated: new Date(data.timestamp),
          },
        };
      },
      validate(data: PolymarketMarketData): boolean {
        return !!(data.conditionId &&
                  typeof data.price === 'number' &&
                  data.price >= 0 &&
                  data.price <= 1);
      },
      getSchema(): any {
        return {
          conditionId: 'string',
          price: 'number',
          probability: 'number',
          timestamp: 'string',
        };
      },
    });

    // Transaction transformer
    this.transformers.set('transaction', {
      name: 'transaction',
      async transform(data: PolymarketTransaction): Promise<NormalizedTransaction> {
        return {
          id: data.id,
          user: data.user,
          type: data.type,
          conditionId: data.conditionId,
          outcome: data.outcome,
          amount: data.amount,
          price: data.price,
          value: data.amount * data.price,
          fee: data.fee,
          timestamp: new Date(data.timestamp),
          hash: data.hash,
          blockNumber: data.blockNumber,
          gasUsed: data.gasUsed,
          metadata: {
            source: 'polymarket',
            processedAt: new Date(),
          },
        };
      },
      validate(data: PolymarketTransaction): boolean {
        return !!(data.id &&
                  data.user &&
                  data.type &&
                  data.conditionId &&
                  typeof data.amount === 'number' &&
                  typeof data.price === 'number');
      },
      getSchema(): any {
        return {
          id: 'string',
          user: 'string',
          type: 'string',
          conditionId: 'string',
          amount: 'number',
          price: 'number',
          timestamp: 'string',
        };
      },
    });

    // Position transformer
    this.transformers.set('position', {
      name: 'position',
      async transform(data: PolymarketPosition): Promise<NormalizedPosition> {
        const currentPrice = data.price || 0;
        const unrealizedPnl = data.side === 'YES'
          ? data.size * (currentPrice - data.price)
          : data.size * (data.price - currentPrice);

        return {
          id: data.id,
          user: data.user,
          conditionId: data.conditionId,
          outcome: data.outcome,
          side: data.side,
          size: data.size,
          averagePrice: data.price,
          currentPrice,
          unrealizedPnl,
          realizedPnl: data.payouts ? Object.values(data.payouts).reduce((sum, payout) => sum + payout, 0) : 0,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
          status: data.status,
          payouts: data.payouts,
          metadata: {
            source: 'polymarket',
            lastUpdated: new Date(data.updatedAt),
          },
        };
      },
      validate(data: PolymarketPosition): boolean {
        return !!(data.id &&
                  data.user &&
                  data.conditionId &&
                  typeof data.size === 'number' &&
                  typeof data.price === 'number');
      },
      getSchema(): any {
        return {
          id: 'string',
          user: 'string',
          conditionId: 'string',
          size: 'number',
          price: 'number',
          status: 'string',
        };
      },
    });
  }

  private setupProcessors(): void {
    // Market data processor
    this.processors.set('PRICE_UPDATE', {
      async process(event: ProcessingEvent): Promise<void> {
        if (!event.data.marketData) return;

        const transformer = this.transformers.get('marketData');
        if (!transformer) {
          throw new Error('Market data transformer not found');
        }

        const normalizedData = await transformer.transform(event.data.marketData);

        // Store in database
        await this.storeMarketData(normalizedData);

        // Check for price change notifications
        await this.checkPriceChangeNotifications(normalizedData);

        // Emit processed event
        this.emit('marketDataProcessed', {
          original: event,
          normalized: normalizedData,
        });
      },
      canProcess(event: ProcessingEvent): boolean {
        return event.type === 'PRICE_UPDATE' && !!event.data.marketData;
      },
      getPriority(): number {
        return 1; // Low priority
      },
    });

    // Transaction processor
    this.processors.set('TRANSACTION', {
      async process(event: ProcessingEvent): Promise<void> {
        if (!event.data.transaction) return;

        const transformer = this.transformers.get('transaction');
        if (!transformer) {
          throw new Error('Transaction transformer not found');
        }

        const normalizedData = await transformer.transform(event.data.transaction);

        // Store in database
        await this.storeTransaction(normalizedData);

        // Check for high value transaction notifications
        await this.checkHighValueTransactionNotifications(normalizedData);

        // Emit processed event
        this.emit('transactionProcessed', {
          original: event,
          normalized: normalizedData,
        });
      },
      canProcess(event: ProcessingEvent): boolean {
        return event.type === 'TRANSACTION' && !!event.data.transaction;
      },
      getPriority(): number {
        return 2; // Medium priority
      },
    });

    // Position update processor
    this.processors.set('POSITION_UPDATE', {
      async process(event: ProcessingEvent): Promise<void> {
        if (!event.data.position) return;

        const transformer = this.transformers.get('position');
        if (!transformer) {
          throw new Error('Position transformer not found');
        }

        const normalizedData = await transformer.transform(event.data.position);

        // Store in database
        await this.storePosition(normalizedData);

        // Check for position update notifications
        await this.checkPositionUpdateNotifications(normalizedData);

        // Emit processed event
        this.emit('positionProcessed', {
          original: event,
          normalized: normalizedData,
        });
      },
      canProcess(event: ProcessingEvent): boolean {
        return event.type === 'POSITION_UPDATE' && !!event.data.position;
      },
      getPriority(): number {
        return 2; // Medium priority
      },
    });

    // Resolution processor
    this.processors.set('RESOLUTION', {
      async process(event: ProcessingEvent): Promise<void> {
        if (!event.data.condition) return;

        const condition = event.data.condition;

        // Update condition in database
        await this.updateConditionResolution(condition);

        // Check for resolution notifications
        await this.checkResolutionNotifications(condition);

        // Emit processed event
        this.emit('resolutionProcessed', {
          original: event,
          condition,
        });
      },
      canProcess(event: ProcessingEvent): boolean {
        return event.type === 'RESOLUTION' && !!event.data.condition;
      },
      getPriority(): number {
        return 3; // High priority
      },
    });
  }

  private setupMetricsCollection(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    this.metricsTimer = setInterval(() => {
      this.updateMetrics();
      this.emit('metrics', this.metrics);
    }, this.config.metricsInterval);
  }

  private setupBatchProcessing(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }

    this.batchTimer = setInterval(() => {
      if (this.queue.length > 0 && !this.processing) {
        this.processBatch();
      }
    }, this.config.processingInterval);
  }

  private updateMetrics(): void {
    const now = Date.now();
    const memUsage = process.memoryUsage();

    this.metrics.processedMessages = this.stats.totalProcessed;
    this.metrics.failedMessages = this.stats.processingErrors;
    this.metrics.averageProcessingTime = this.stats.averageProcessingTime;
    this.metrics.uptime = process.uptime();
    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB
    this.metrics.bufferUtilization = (this.queue.length / this.config.bufferSize) * 100;
    this.metrics.errorRate = this.stats.totalProcessed > 0
      ? (this.stats.processingErrors / this.stats.totalProcessed) * 100
      : 0;

    // Update throughput (events per second)
    this.throughputTracker.push(this.stats.totalProcessed);
    if (this.throughputTracker.length > 60) { // Keep 1 minute of data
      this.throughputTracker.shift();
    }
  }

  async process(event: ProcessingEvent): Promise<void> {
    try {
      const startTime = Date.now();

      // Find appropriate processor
      const processor = Array.from(this.processors.values())
        .find(p => p.canProcess(event));

      if (!processor) {
        logger.warn('No processor found for event', { type: event.type });
        return;
      }

      // Process event
      await processor.process(event);

      // Update stats
      const processingTime = Date.now() - startTime;
      this.stats.totalProcessed++;
      this.updateAverageProcessingTime(processingTime);

      event.status = 'completed';
      event.processingTime = processingTime;

      if (polymarketDebugConfig.logProcessing) {
        logger.debug('Event processed successfully', {
          type: event.type,
          processingTime,
          conditionId: event.conditionId,
        });
      }

    } catch (error) {
      this.stats.processingErrors++;
      event.status = 'failed';
      event.error = error instanceof Error ? error.message : String(error);

      // Check if we should retry
      if (this.shouldRetry(event)) {
        event.retryCount++;
        await this.scheduleRetry(event);
      } else {
        logger.error('Event processing failed permanently', {
          type: event.type,
          error: event.error,
          retryCount: event.retryCount,
        });
      }
    }
  }

  canProcess(event: ProcessingEvent): boolean {
    return Array.from(this.processors.values())
      .some(processor => processor.canProcess(event));
  }

  getPriority(): number {
    return 2; // Medium priority
  }

  async enqueue(event: ProcessingEvent): Promise<void> {
    if (this.queue.length >= this.config.bufferSize) {
      throw new DataProcessingError(
        'Queue is full',
        'processing',
        'QUEUE_FULL',
        { queueSize: this.queue.length, bufferSize: this.config.bufferSize },
        new Date(),
        false,
        'high'
      );
    }

    // Set default values if not provided
    if (!event.id) {
      event.id = `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    if (!event.processedAt) {
      event.processedAt = new Date();
    }

    if (event.status === 'pending') {
      event.status = 'pending';
    }

    this.queue.push(event);

    if (polymarketDebugConfig.logProcessing) {
      logger.debug('Event enqueued', {
        id: event.id,
        type: event.type,
        queueSize: this.queue.length,
      });
    }

    this.emit('enqueued', { event, queueSize: this.queue.length });
  }

  async dequeue(): Promise<ProcessingEvent | null> {
    if (this.queue.length === 0) {
      return null;
    }

    const event = this.queue.shift() || null;

    if (event && polymarketDebugConfig.logProcessing) {
      logger.debug('Event dequeued', {
        id: event.id,
        type: event.type,
        queueSize: this.queue.length,
      });
    }

    if (event) {
      this.emit('dequeued', { event, queueSize: this.queue.length });
    }

    return event;
  }

  async peek(): Promise<ProcessingEvent | null> {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  async size(): Promise<number> {
    return this.queue.length;
  }

  async clear(): Promise<void> {
    const clearedCount = this.queue.length;
    this.queue = [];

    logger.info('Queue cleared', { clearedCount });
    this.emit('cleared', { clearedCount });
  }

  async getStats(): Promise<DataProcessorStats> {
    this.stats.queueSize = this.queue.length;
    this.stats.lastBatchProcessedAt = this.lastBatchProcessedAt;

    // Calculate throughput
    if (this.throughputTracker.length > 1) {
      const recent = this.throughputTracker[this.throughputTracker.length - 1];
      const previous = this.throughputTracker[0];
      this.stats.throughput = Math.max(0, (recent - previous) / (this.throughputTracker.length - 1));
    } else {
      this.stats.throughput = 0;
    }

    return { ...this.stats };
  }

  private async processBatch(): Promise<void> {
    if (this.processing) return;

    this.processing = true;
    const batch: ProcessingEvent[] = [];

    try {
      // Collect batch
      while (batch.length < this.config.batchSize && this.queue.length > 0) {
        const event = await this.dequeue();
        if (event) {
          batch.push(event);
        }
      }

      if (batch.length === 0) {
        return;
      }

      // Sort by priority
      batch.sort((a, b) => {
        const aPriority = this.getEventPriority(a);
        const bPriority = this.getEventPriority(b);
        return bPriority - aPriority; // Higher priority first
      });

      // Process batch
      const startTime = Date.now();
      const processingPromises = batch.map(event => this.process(event));

      await Promise.allSettled(processingPromises);

      const batchTime = Date.now() - startTime;
      this.lastBatchProcessedAt = new Date();

      if (polymarketDebugConfig.logProcessing) {
        logger.info('Batch processed', {
          batchSize: batch.length,
          processingTime: batchTime,
          averageTime: batchTime / batch.length,
        });
      }

      this.emit('batchProcessed', {
        batchSize: batch.length,
        processingTime: batchTime,
        queueSize: this.queue.length,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Batch processing failed', { error: errorMessage });

      this.emit('batchError', { error: errorMessage, batchSize: batch.length });

    } finally {
      this.processing = false;
    }
  }

  private getEventPriority(event: ProcessingEvent): number {
    // Check metadata priority first
    if (event.metadata.priority) {
      const priorityMap = { low: 1, medium: 2, high: 3, critical: 4 };
      return priorityMap[event.metadata.priority] || 2;
    }

    // Default priority by event type
    const priorityMap: Record<string, number> = {
      RESOLUTION: 4,
      POSITION_UPDATE: 3,
      TRANSACTION: 2,
      PRICE_UPDATE: 1,
      CONDITION_UPDATE: 2,
    };

    return priorityMap[event.type] || 2;
  }

  private shouldRetry(event: ProcessingEvent): boolean {
    if (event.retryCount >= this.retryPolicy.maxRetries) {
      return false;
    }

    if (!event.error) {
      return false;
    }

    // Default retryable error conditions if retryableErrors is not defined
    const retryableErrors = this.retryPolicy.retryableErrors || [
      'timeout',
      'network',
      'connection',
      'socket',
      'econnreset',
      'enotfound',
      'econnrefused',
      'etimedout'
    ];

    return retryableErrors.some(errorType =>
      event.error!.toLowerCase().includes(errorType.toLowerCase())
    );
  }

  private async scheduleRetry(event: ProcessingEvent): Promise<void> {
    const delay = this.calculateRetryDelay(event.retryCount);
    const retryEvent = { ...event };

    setTimeout(async () => {
      try {
        await this.enqueue(retryEvent);
      } catch (error) {
        logger.error('Failed to schedule retry', {
          eventId: retryEvent.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, delay);

    logger.debug('Event scheduled for retry', {
      eventId: event.id,
      retryCount: event.retryCount,
      delay,
    });
  }

  private calculateRetryDelay(retryCount: number): number {
    let delay = this.retryPolicy.baseDelay * Math.pow(this.retryPolicy.backoffMultiplier, retryCount);

    if (delay > this.retryPolicy.maxDelay) {
      delay = this.retryPolicy.maxDelay;
    }

    if (this.retryPolicy.jitter) {
      delay += Math.random() * delay * 0.1; // Add 10% jitter
    }

    return Math.round(delay);
  }

  private updateAverageProcessingTime(processingTime: number): void {
    this.stats.averageProcessingTime =
      (this.stats.averageProcessingTime * (this.stats.totalProcessed - 1) + processingTime) / this.stats.totalProcessed;
  }

  // Database storage methods

  private async storeMarketData(data: NormalizedMarketData): Promise<void> {
    try {
      await databasePool.query(
        `INSERT INTO polymarket_market_data (
          condition_id, symbol, question, outcomes,
          current_price, probability, volume_24h, price_change_24h,
          liquidity, timestamp, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (condition_id, timestamp) DO UPDATE SET
          current_price = EXCLUDED.current_price,
          probability = EXCLUDED.probability,
          volume_24h = EXCLUDED.volume_24h,
          price_change_24h = EXCLUDED.price_change_24h,
          liquidity = EXCLUDED.liquidity,
          metadata = EXCLUDED.metadata`,
        [
          data.conditionId,
          data.symbol,
          data.question,
          JSON.stringify(data.outcomes),
          data.marketData.currentPrice,
          data.marketData.probability,
          data.marketData.volume24h,
          data.marketData.priceChange24h,
          data.marketData.liquidity,
          data.marketData.timestamp,
          JSON.stringify(data.metadata),
        ]
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DataProcessingError(
        `Failed to store market data: ${errorMessage}`,
        'storage',
        'MARKET_DATA_STORAGE_ERROR',
        { conditionId: data.conditionId },
        new Date(),
        true,
        'medium'
      );
    }
  }

  private async storeTransaction(data: NormalizedTransaction): Promise<void> {
    try {
      await databasePool.query(
        `INSERT INTO polymarket_transactions (
          id, user_address, type, condition_id, outcome,
          amount, price, value, fee, timestamp, hash,
          block_number, gas_used, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO NOTHING`,
        [
          data.id,
          data.user,
          data.type,
          data.conditionId,
          data.outcome,
          data.amount,
          data.price,
          data.value,
          data.fee,
          data.timestamp,
          data.hash,
          data.blockNumber,
          data.gasUsed,
          JSON.stringify(data.metadata),
        ]
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DataProcessingError(
        `Failed to store transaction: ${errorMessage}`,
        'storage',
        'TRANSACTION_STORAGE_ERROR',
        { transactionId: data.id },
        new Date(),
        true,
        'medium'
      );
    }
  }

  private async storePosition(data: NormalizedPosition): Promise<void> {
    try {
      await databasePool.query(
        `INSERT INTO polymarket_positions (
          id, user_address, condition_id, outcome, side,
          size, average_price, current_price, unrealized_pnl, realized_pnl,
          created_at, updated_at, status, payouts, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          current_price = EXCLUDED.current_price,
          unrealized_pnl = EXCLUDED.unrealized_pnl,
          realized_pnl = EXCLUDED.realized_pnl,
          updated_at = EXCLUDED.updated_at,
          status = EXCLUDED.status,
          payouts = EXCLUDED.payouts,
          metadata = EXCLUDED.metadata`,
        [
          data.id,
          data.user,
          data.conditionId,
          data.outcome,
          data.side,
          data.size,
          data.averagePrice,
          data.currentPrice,
          data.unrealizedPnl,
          data.realizedPnl,
          data.createdAt,
          data.updatedAt,
          data.status,
          JSON.stringify(data.payouts),
          JSON.stringify(data.metadata),
        ]
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DataProcessingError(
        `Failed to store position: ${errorMessage}`,
        'storage',
        'POSITION_STORAGE_ERROR',
        { positionId: data.id },
        new Date(),
        true,
        'medium'
      );
    }
  }

  private async updateConditionResolution(condition: PolymarketCondition): Promise<void> {
    try {
      await databasePool.query(
        `UPDATE polymarket_conditions SET
          status = $1,
          resolve_time = $2,
          resolution = $3,
          updated_at = NOW()
        WHERE id = $4`,
        [
          condition.status,
          condition.resolveTime,
          JSON.stringify(condition.resolution),
          condition.id,
        ]
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new DataProcessingError(
        `Failed to update condition resolution: ${errorMessage}`,
        'storage',
        'CONDITION_RESOLUTION_ERROR',
        { conditionId: condition.id },
        new Date(),
        true,
        'high'
      );
    }
  }

  // Notification checking methods

  private async checkPriceChangeNotifications(data: NormalizedMarketData): Promise<void> {
    if (!polymarketNotificationRules.priceChange.enabled) {
      return;
    }

    // Get previous price data
    const previousData = await this.getPreviousMarketData(data.conditionId);
    if (!previousData) {
      return;
    }

    const priceChange = Math.abs(data.marketData.currentPrice - previousData.currentPrice);
    const percentChange = (priceChange / previousData.currentPrice) * 100;

    if (percentChange >= polymarketNotificationRules.priceChange.threshold * 100) {
      const trigger: NotificationTrigger = {
        type: 'price_change',
        conditionId: data.conditionId,
        data: {
          currentPrice: data.marketData.currentPrice,
          previousPrice: previousData.currentPrice,
          percentChange,
        },
        timestamp: new Date(),
        priority: percentChange >= 20 ? 'high' : 'medium',
      };

      this.emit('notificationTrigger', trigger);
    }
  }

  private async checkHighValueTransactionNotifications(data: NormalizedTransaction): Promise<void> {
    if (!polymarketNotificationRules.highValueTransactions.enabled) {
      return;
    }

    if (data.value >= polymarketNotificationRules.highValueTransactions.threshold) {
      const trigger: NotificationTrigger = {
        type: 'transaction',
        conditionId: data.conditionId,
        userId: data.user,
        data: {
          transactionId: data.id,
          value: data.value,
          type: data.type,
        },
        timestamp: new Date(),
        priority: data.value >= 10000 ? 'critical' : 'high',
      };

      this.emit('notificationTrigger', trigger);
    }
  }

  private async checkPositionUpdateNotifications(data: NormalizedPosition): Promise<void> {
    if (!polymarketNotificationRules.positionUpdates.enabled) {
      return;
    }

    const totalPnl = data.unrealizedPnl + data.realizedPnl;

    if (Math.abs(totalPnl) >= polymarketNotificationRules.positionUpdates.pnlThreshold) {
      const trigger: NotificationTrigger = {
        type: 'position_update',
        conditionId: data.conditionId,
        userId: data.user,
        data: {
          positionId: data.id,
          unrealizedPnl: data.unrealizedPnl,
          realizedPnl: data.realizedPnl,
          totalPnl,
          status: data.status,
        },
        timestamp: new Date(),
        priority: Math.abs(totalPnl) >= 1000 ? 'high' : 'medium',
      };

      this.emit('notificationTrigger', trigger);
    }

    // Check for position closures
    if (polymarketNotificationRules.positionUpdates.notifyClosures &&
        (data.status === 'SETTLED' || data.status === 'CANCELLED')) {
      const trigger: NotificationTrigger = {
        type: 'position_update',
        conditionId: data.conditionId,
        userId: data.user,
        data: {
          positionId: data.id,
          status: data.status,
          realizedPnl: data.realizedPnl,
          closureReason: data.status === 'SETTLED' ? 'market_resolved' : 'cancelled',
        },
        timestamp: new Date(),
        priority: 'high',
      };

      this.emit('notificationTrigger', trigger);
    }
  }

  private async checkResolutionNotifications(condition: PolymarketCondition): Promise<void> {
    if (!polymarketNotificationRules.marketResolutions.enabled) {
      return;
    }

    const trigger: NotificationTrigger = {
      type: 'market_resolution',
      conditionId: condition.id,
      data: {
        question: condition.question,
        resolvedOutcome: condition.resolution?.outcome,
        resolvedProbability: condition.resolution?.probability,
        resolveTime: condition.resolveTime,
      },
      timestamp: new Date(),
      priority: 'critical',
    };

    this.emit('notificationTrigger', trigger);
  }

  private async getPreviousMarketData(conditionId: string): Promise<NormalizedMarketData['marketData'] | null> {
    try {
      const result = await databasePool.query(
        `SELECT current_price, probability, volume_24h, price_change_24h, liquidity, timestamp
         FROM polymarket_market_data
         WHERE condition_id = $1
         ORDER BY timestamp DESC
         LIMIT 1`,
        [conditionId]
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        currentPrice: row.current_price,
        probability: row.probability,
        volume24h: row.volume_24h,
        priceChange24h: row.price_change_24h,
        liquidity: row.liquidity,
        timestamp: row.timestamp,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get previous market data', {
        conditionId,
        error: errorMessage,
      });
      return null;
    }
  }

  // Public utility methods

  getMetrics(): ProcessingMetrics {
    return { ...this.metrics };
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down data processor...');

    // Clear timers
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // Process remaining events
    while (this.queue.length > 0) {
      await this.processBatch();
      await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause
    }

    logger.info('Data processor shutdown complete');
    this.emit('shutdown');
  }
}

export default DataProcessor;