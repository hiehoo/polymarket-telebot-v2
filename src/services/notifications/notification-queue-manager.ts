import { EventEmitter } from 'events';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';
import { NotificationData, NotificationPreferences } from './notification-service';

export interface QueueManagerConfig {
  // Redis keys
  queueKey: string;
  processingKey: string;
  metricsKey: string;
  delayedKey: string;

  // Queue behavior
  maxQueueSize: number;
  batchSize: number;
  processingTimeout: number; // ms
  visibilityTimeout: number; // ms

  // Priority handling
  enablePriorityQueuing: boolean;
  priorityWeights: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };

  // Dead letter queue
  enableDeadLetterQueue: boolean;
  deadLetterKey: string;
  maxRetries: number;
  deadLetterRetention: number; // ms

  // Performance
  enableMetrics: boolean;
  metricsRetentionPeriod: number; // ms
}

export interface QueueItem {
  id: string;
  userId: number;
  type: NotificationData['type'];
  priority: NotificationData['priority'];
  payload: NotificationData;
  createdAt: number;
  scheduledFor: number;
  attempts: number;
  lastAttempt?: number;
  retryDelay?: number;
  tags?: string[];
}

export interface QueueMetrics {
  totalEnqueued: number;
  totalDequeued: number;
  totalProcessed: number;
  totalFailed: number;
  totalRetried: number;
  averageProcessingTime: number;
  averageWaitTime: number;
  queueDepth: number;
  deadLetterCount: number;
  priorityDistribution: Record<string, number>;

  // Time series data
  processingRate: number[]; // items per minute over last hour
  errorRate: number[]; // error percentage over last hour

  // User-specific metrics
  userMetrics: Map<number, {
    enqueued: number;
    processed: number;
    failed: number;
    averageWaitTime: number;
    lastProcessed?: number;
  }>;
}

export interface QueueWorker {
  id: string;
  status: 'idle' | 'processing' | 'paused' | 'stopped';
  currentTask?: QueueItem;
  startTime: number;
  processedCount: number;
  errorCount: number;
  lastActivity: number;
}

export class NotificationQueueManager extends EventEmitter {
  private config: QueueManagerConfig;
  private workers: Map<string, QueueWorker> = new Map();
  private isProcessing = false;
  private processingTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<QueueManagerConfig> = {}) {
    super();

    this.config = {
      queueKey: 'notifications:queue',
      processingKey: 'notifications:processing',
      metricsKey: 'notifications:metrics',
      delayedKey: 'notifications:delayed',

      maxQueueSize: 10000,
      batchSize: 50,
      processingTimeout: 30000,
      visibilityTimeout: 60000,

      enablePriorityQueuing: true,
      priorityWeights: {
        urgent: 1000,
        high: 100,
        medium: 10,
        low: 1
      },

      enableDeadLetterQueue: true,
      deadLetterKey: 'notifications:dead_letter',
      maxRetries: 3,
      deadLetterRetention: 7 * 24 * 60 * 60 * 1000, // 7 days

      enableMetrics: true,
      metricsRetentionPeriod: 24 * 60 * 60 * 1000, // 24 hours

      ...config
    };

    this.initializeMetrics();
    this.startPeriodicTasks();
  }

  private initializeMetrics(): void {
    // Initialize Redis metrics structure if needed
    this.ensureMetricsStructure().catch(error => {
      logger.error('Error initializing metrics:', error);
    });
  }

  private async ensureMetricsStructure(): Promise<void> {
    const metricsKey = this.config.metricsKey;
    const exists = await redisClient.exists(metricsKey);

    if (!exists) {
      await redisClient.hset(metricsKey, {
        totalEnqueued: '0',
        totalDequeued: '0',
        totalProcessed: '0',
        totalFailed: '0',
        totalRetried: '0',
        averageProcessingTime: '0',
        averageWaitTime: '0',
        queueDepth: '0',
        deadLetterCount: '0',
        lastReset: Date.now().toString()
      });
    }
  }

  private startPeriodicTasks(): void {
    // Process queue every second
    this.processingTimer = setInterval(() => {
      this.processQueue().catch(error => {
        logger.error('Error processing queue:', error);
      });
    }, 1000);

    // Collect metrics every minute
    if (this.config.enableMetrics) {
      this.metricsTimer = setInterval(() => {
        this.collectMetrics().catch(error => {
          logger.error('Error collecting metrics:', error);
        });
      }, 60000);
    }

    // Cleanup old data every hour
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        logger.error('Error during cleanup:', error);
      });
    }, 60 * 60 * 1000);
  }

  async enqueue(notification: NotificationData, options: {
    priority?: NotificationData['priority'];
    delay?: number; // ms
    tags?: string[];
    retryable?: boolean;
  } = {}): Promise<string> {
    const id = this.generateItemId();
    const now = Date.now();

    const queueItem: QueueItem = {
      id,
      userId: notification.userId,
      type: notification.type,
      priority: options.priority || notification.priority || 'medium',
      payload: notification,
      createdAt: now,
      scheduledFor: now + (options.delay || 0),
      attempts: 0,
      tags: options.tags || []
    };

    try {
      // Check queue size limit
      const queueSize = await this.getQueueSize();
      if (queueSize >= this.config.maxQueueSize) {
        throw new Error(`Queue is full (${queueSize}/${this.config.maxQueueSize})`);
      }

      if (options.delay && options.delay > 0) {
        // Add to delayed queue
        await this.addToDelayedQueue(queueItem);
      } else {
        // Add to main queue
        await this.addToMainQueue(queueItem);
      }

      // Update metrics
      await this.incrementMetric('totalEnqueued');
      await this.updateUserMetric(notification.userId, 'enqueued');

      logger.debug(`Notification enqueued: ${id} for user ${notification.userId}`);
      this.emit('item:enqueued', queueItem);

      return id;

    } catch (error) {
      logger.error(`Error enqueuing notification: ${id}`, error);
      this.emit('item:error', { item: queueItem, error });
      throw error;
    }
  }

  private async addToMainQueue(item: QueueItem): Promise<void> {
    const score = this.calculateScore(item);
    const serializedItem = JSON.stringify(item);

    await redisClient.zadd(this.config.queueKey, score, serializedItem);
  }

  private async addToDelayedQueue(item: QueueItem): Promise<void> {
    const serializedItem = JSON.stringify(item);
    await redisClient.zadd(this.config.delayedKey, item.scheduledFor, serializedItem);
  }

  private calculateScore(item: QueueItem): number {
    if (!this.config.enablePriorityQueuing) {
      return item.scheduledFor;
    }

    const priorityWeight = this.config.priorityWeights[item.priority] || 1;
    const timeScore = item.scheduledFor;

    // Combine time and priority: lower score = higher priority
    // We subtract priority weight from time to prioritize important items
    return timeScore - (priorityWeight * 1000000);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Move delayed items to main queue if their time has come
      await this.moveDelayedItems();

      // Get available workers
      const availableWorkers = Array.from(this.workers.values())
        .filter(worker => worker.status === 'idle');

      if (availableWorkers.length === 0) {
        return;
      }

      // Get items from queue
      const items = await this.getBatchFromQueue();

      if (items.length === 0) {
        return;
      }

      // Process items
      const processingPromises = items.map(item => this.processItem(item, availableWorkers));
      await Promise.allSettled(processingPromises);

    } catch (error) {
      logger.error('Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async moveDelayedItems(): Promise<void> {
    const now = Date.now();
    const items = await redisClient.zrangebyscore(
      this.config.delayedKey,
      0,
      now,
      'LIMIT',
      0,
      this.config.batchSize
    );

    if (items.length === 0) {
      return;
    }

    const pipeline = redisClient.pipeline();

    for (const itemStr of items) {
      try {
        const item: QueueItem = JSON.parse(itemStr);
        await this.addToMainQueue(item);
        pipeline.zrem(this.config.delayedKey, itemStr);
      } catch (error) {
        pipeline.zrem(this.config.delayedKey, itemStr);
        logger.error('Error moving delayed item to main queue:', error);
      }
    }

    await pipeline.exec();
  }

  private async getBatchFromQueue(): Promise<QueueItem[]> {
    const items = await redisClient.zrange(
      this.config.queueKey,
      0,
      this.config.batchSize - 1
    );

    if (items.length === 0) {
      return [];
    }

    const queueItems: QueueItem[] = [];
    const pipeline = redisClient.pipeline();

    for (const itemStr of items) {
      try {
        const item: QueueItem = JSON.parse(itemStr);
        queueItems.push(item);
        pipeline.zrem(this.config.queueKey, itemStr);
      } catch (error) {
        pipeline.zrem(this.config.queueKey, itemStr);
        logger.error('Error parsing queue item:', error);
      }
    }

    await pipeline.exec();

    // Update metrics
    await this.incrementMetric('totalDequeued', queueItems.length);

    return queueItems;
  }

  private async processItem(item: QueueItem, availableWorkers: QueueWorker[]): Promise<void> {
    // Assign worker
    const worker = availableWorkers.find(w => w.status === 'idle');
    if (!worker) {
      // Re-queue item
      await this.addToMainQueue(item);
      return;
    }

    worker.status = 'processing';
    worker.currentTask = item;
    worker.lastActivity = Date.now();

    // Add to processing set
    await redisClient.zadd(
      this.config.processingKey,
      Date.now() + this.config.visibilityTimeout,
      JSON.stringify(item)
    );

    const startTime = Date.now();

    try {
      // Emit event for processing
      this.emit('item:processing', item);

      // Wait for processing completion or timeout
      await this.processItemWithTimeout(item, this.config.processingTimeout);

      // Mark as processed
      worker.processedCount++;
      worker.status = 'idle';
      worker.currentTask = undefined;

      const processingTime = Date.now() - startTime;
      const waitTime = startTime - item.createdAt;

      // Update metrics
      await this.updateProcessingMetrics(processingTime, waitTime, true);
      await this.updateUserMetric(item.userId, 'processed', processingTime, waitTime);

      // Remove from processing set
      await redisClient.zrem(this.config.processingKey, JSON.stringify(item));

      logger.debug(`Notification processed: ${item.id}`);
      this.emit('item:processed', item);

    } catch (error) {
      // Handle processing error
      worker.errorCount++;
      worker.status = 'idle';
      worker.currentTask = undefined;

      const processingTime = Date.now() - startTime;

      await this.handleProcessingError(item, error);
      await this.updateProcessingMetrics(processingTime, 0, false);

      // Remove from processing set
      await redisClient.zrem(this.config.processingKey, JSON.stringify(item));
    }
  }

  private async processItemWithTimeout(item: QueueItem, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Processing timeout for item: ${item.id}`));
      }, timeout);

      // Listen for processing completion
      const completeHandler = (completedItem: QueueItem) => {
        if (completedItem.id === item.id) {
          clearTimeout(timer);
          this.removeListener('item:completed', completeHandler);
          resolve();
        }
      };

      const errorHandler = (errorData: { item: QueueItem; error: Error }) => {
        if (errorData.item.id === item.id) {
          clearTimeout(timer);
          this.removeListener('item:completed', completeHandler);
          this.removeListener('item:error', errorHandler);
          reject(errorData.error);
        }
      };

      this.once('item:completed', completeHandler);
      this.once('item:processingError', errorHandler);

      // Emit processing event
      this.emit('item:startProcessing', item);
    });
  }

  private async handleProcessingError(item: QueueItem, error: any): Promise<void> {
    item.attempts++;
    item.lastAttempt = Date.now();

    if (item.attempts >= this.config.maxRetries) {
      // Move to dead letter queue
      await this.moveToDeadLetterQueue(item, error);
      await this.incrementMetric('totalFailed');
      await this.updateUserMetric(item.userId, 'failed');

      logger.error(`Notification failed after max retries: ${item.id}`, error);
      this.emit('item:failed', { item, error });
    } else {
      // Schedule retry with exponential backoff
      item.retryDelay = Math.min(1000 * Math.pow(2, item.attempts), 30000);
      item.scheduledFor = Date.now() + item.retryDelay;

      await this.addToDelayedQueue(item);
      await this.incrementMetric('totalRetried');

      logger.debug(`Notification scheduled for retry: ${item.id} (attempt ${item.attempts})`);
      this.emit('item:retry', item);
    }
  }

  private async moveToDeadLetterQueue(item: QueueItem, error: any): Promise<void> {
    if (!this.config.enableDeadLetterQueue) {
      return;
    }

    const deadLetterItem = {
      item,
      error: {
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      },
      failedAt: Date.now()
    };

    await redisClient.zadd(
      this.config.deadLetterKey,
      Date.now(),
      JSON.stringify(deadLetterItem)
    );

    await this.incrementMetric('deadLetterCount');
  }

  async completeItem(itemId: string): Promise<void> {
    this.emit('item:completed', { id: itemId });
  }

  async failItem(itemId: string, error: Error): Promise<void> {
    this.emit('item:processingError', { id: itemId, error });
  }

  private async incrementMetric(metricName: string, value: number = 1): Promise<void> {
    await redisClient.hincrby(this.config.metricsKey, metricName, value);
  }

  private async updateUserMetric(
    userId: number,
    action: 'enqueued' | 'processed' | 'failed',
    processingTime?: number,
    waitTime?: number
  ): Promise<void> {
    const userMetricsKey = `${this.config.metricsKey}:user:${userId}`;
    const pipeline = redisClient.pipeline();

    pipeline.hincrby(userMetricsKey, action, 1);

    if (processingTime !== undefined) {
      // Update average processing time
      const current = await redisClient.hget(userMetricsKey, 'totalProcessingTime') || '0';
      const count = await redisClient.hget(userMetricsKey, 'processedCount') || '0';
      const newTotal = parseInt(current) + processingTime;
      const newCount = parseInt(count) + 1;

      pipeline.hset(userMetricsKey, 'totalProcessingTime', newTotal.toString());
      pipeline.hset(userMetricsKey, 'averageProcessingTime', (newTotal / newCount).toString());
    }

    if (waitTime !== undefined) {
      // Update average wait time
      const current = await redisClient.hget(userMetricsKey, 'totalWaitTime') || '0';
      const count = await redisClient.hget(userMetricsKey, 'processedCount') || '0';
      const newTotal = parseInt(current) + waitTime;
      const newCount = parseInt(count) + 1;

      pipeline.hset(userMetricsKey, 'totalWaitTime', newTotal.toString());
      pipeline.hset(userMetricsKey, 'averageWaitTime', (newTotal / newCount).toString());
    }

    pipeline.expire(userMetricsKey, this.config.metricsRetentionPeriod / 1000);
    await pipeline.exec();
  }

  private async updateProcessingMetrics(
    processingTime: number,
    waitTime: number,
    success: boolean
  ): Promise<void> {
    const pipeline = redisClient.pipeline();

    // Update counts
    if (success) {
      pipeline.hincrby(this.config.metricsKey, 'totalProcessed', 1);
    }

    // Update averages
    const metrics = await redisClient.hgetall(this.config.metricsKey);
    const totalProcessed = parseInt(metrics.totalProcessed || '0');
    const currentAvgProcessingTime = parseFloat(metrics.averageProcessingTime || '0');
    const currentAvgWaitTime = parseFloat(metrics.averageWaitTime || '0');

    const newAvgProcessingTime = (
      (currentAvgProcessingTime * totalProcessed + processingTime) / (totalProcessed + 1)
    );
    const newAvgWaitTime = (
      (currentAvgWaitTime * totalProcessed + waitTime) / (totalProcessed + 1)
    );

    pipeline.hset(this.config.metricsKey, 'averageProcessingTime', newAvgProcessingTime.toString());
    pipeline.hset(this.config.metricsKey, 'averageWaitTime', newAvgWaitTime.toString());

    await pipeline.exec();
  }

  private async collectMetrics(): Promise<void> {
    try {
      const metrics = await redisClient.hgetall(this.config.metricsKey);
      const queueDepth = await this.getQueueSize();

      const queueMetrics: QueueMetrics = {
        totalEnqueued: parseInt(metrics.totalEnqueued || '0'),
        totalDequeued: parseInt(metrics.totalDequeued || '0'),
        totalProcessed: parseInt(metrics.totalProcessed || '0'),
        totalFailed: parseInt(metrics.totalFailed || '0'),
        totalRetried: parseInt(metrics.totalRetried || '0'),
        averageProcessingTime: parseFloat(metrics.averageProcessingTime || '0'),
        averageWaitTime: parseFloat(metrics.averageWaitTime || '0'),
        queueDepth,
        deadLetterCount: parseInt(metrics.deadLetterCount || '0'),
        priorityDistribution: await this.getPriorityDistribution(),
        processingRate: [], // Would need time series implementation
        errorRate: [],
        userMetrics: new Map()
      };

      this.emit('metrics:collected', queueMetrics);

    } catch (error) {
      logger.error('Error collecting metrics:', error);
    }
  }

  private async getPriorityDistribution(): Promise<Record<string, number>> {
    const items = await redisClient.zrange(this.config.queueKey, 0, -1);
    const distribution: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };

    for (const itemStr of items) {
      try {
        const item: QueueItem = JSON.parse(itemStr);
        distribution[item.priority] = (distribution[item.priority] || 0) + 1;
      } catch (error) {
        // Skip invalid items
      }
    }

    return distribution;
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();

    // Cleanup stale processing items
    const staleProcessing = await redisClient.zrangebyscore(
      this.config.processingKey,
      0,
      now
    );

    if (staleProcessing.length > 0) {
      const pipeline = redisClient.pipeline();

      for (const itemStr of staleProcessing) {
        try {
          const item: QueueItem = JSON.parse(itemStr);
          await this.handleProcessingError(item, new Error('Processing timeout'));
          pipeline.zrem(this.config.processingKey, itemStr);
        } catch (error) {
          pipeline.zrem(this.config.processingKey, itemStr);
        }
      }

      await pipeline.exec();
    }

    // Cleanup old dead letter items
    if (this.config.enableDeadLetterQueue) {
      const cutoffTime = now - this.config.deadLetterRetention;
      await redisClient.zremrangebyscore(
        this.config.deadLetterKey,
        0,
        cutoffTime
      );
    }
  }

  private async getQueueSize(): Promise<number> {
    return await redisClient.zcard(this.config.queueKey);
  }

  private generateItemId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API methods
  async getMetrics(): Promise<QueueMetrics> {
    const metrics = await redisClient.hgetall(this.config.metricsKey);
    const queueDepth = await this.getQueueSize();

    return {
      totalEnqueued: parseInt(metrics.totalEnqueued || '0'),
      totalDequeued: parseInt(metrics.totalDequeued || '0'),
      totalProcessed: parseInt(metrics.totalProcessed || '0'),
      totalFailed: parseInt(metrics.totalFailed || '0'),
      totalRetried: parseInt(metrics.totalRetried || '0'),
      averageProcessingTime: parseFloat(metrics.averageProcessingTime || '0'),
      averageWaitTime: parseFloat(metrics.averageWaitTime || '0'),
      queueDepth,
      deadLetterCount: parseInt(metrics.deadLetterCount || '0'),
      priorityDistribution: await this.getPriorityDistribution(),
      processingRate: [],
      errorRate: [],
      userMetrics: new Map()
    };
  }

  async getQueueStatus(): Promise<{
    size: number;
    processing: number;
    delayed: number;
    deadLetter: number;
  }> {
    const [size, processing, delayed, deadLetter] = await Promise.all([
      redisClient.zcard(this.config.queueKey),
      redisClient.zcard(this.config.processingKey),
      redisClient.zcard(this.config.delayedKey),
      this.config.enableDeadLetterQueue ? redisClient.zcard(this.config.deadLetterKey) : Promise.resolve(0)
    ]);

    return { size, processing, delayed, deadLetter };
  }

  async peekQueue(limit: number = 10): Promise<QueueItem[]> {
    const items = await redisClient.zrange(this.config.queueKey, 0, limit - 1);
    const queueItems: QueueItem[] = [];

    for (const itemStr of items) {
      try {
        const item: QueueItem = JSON.parse(itemStr);
        queueItems.push(item);
      } catch (error) {
        // Skip invalid items
      }
    }

    return queueItems;
  }

  async getDeadLetterItems(limit: number = 50): Promise<any[]> {
    if (!this.config.enableDeadLetterQueue) {
      return [];
    }

    const items = await redisClient.zrevrange(this.config.deadLetterKey, 0, limit - 1);
    const deadLetterItems = [];

    for (const itemStr of items) {
      try {
        const item = JSON.parse(itemStr);
        deadLetterItems.push(item);
      } catch (error) {
        // Skip invalid items
      }
    }

    return deadLetterItems;
  }

  async retryDeadLetterItem(itemId: string): Promise<boolean> {
    if (!this.config.enableDeadLetterQueue) {
      return false;
    }

    const items = await redisClient.zrange(this.config.deadLetterKey, 0, -1);

    for (const itemStr of items) {
      try {
        const deadLetterItem = JSON.parse(itemStr);
        if (deadLetterItem.item.id === itemId) {
          // Reset item and re-queue
          const item = deadLetterItem.item;
          item.attempts = 0;
          item.lastAttempt = undefined;
          item.scheduledFor = Date.now();

          await this.addToMainQueue(item);
          await redisClient.zrem(this.config.deadLetterKey, itemStr);

          logger.info(`Dead letter item requeued: ${itemId}`);
          this.emit('deadLetter:retried', item);

          return true;
        }
      } catch (error) {
        // Skip invalid items
      }
    }

    return false;
  }

  addWorker(workerId: string): void {
    this.workers.set(workerId, {
      id: workerId,
      status: 'idle',
      startTime: Date.now(),
      processedCount: 0,
      errorCount: 0,
      lastActivity: Date.now()
    });

    logger.debug(`Worker added: ${workerId}`);
  }

  removeWorker(workerId: string): void {
    this.workers.delete(workerId);
    logger.debug(`Worker removed: ${workerId}`);
  }

  getWorkers(): QueueWorker[] {
    return Array.from(this.workers.values());
  }

  updateConfig(newConfig: Partial<QueueManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Queue manager config updated', this.config);
  }

  async shutdown(): Promise<void> {
    // Clear timers
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Wait for current processing to complete
    let processingCount = this.workers.size;
    const checkInterval = setInterval(() => {
      const processingWorkers = Array.from(this.workers.values())
        .filter(w => w.status === 'processing').length;

      if (processingWorkers === 0) {
        clearInterval(checkInterval);
      }
    }, 1000);

    // Force stop after 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 30000);

    logger.info('Queue manager shut down');
  }
}

export default NotificationQueueManager;