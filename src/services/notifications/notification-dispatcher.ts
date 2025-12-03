import { EventEmitter } from 'events';
import { Telegraf } from 'telegraf';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';
import { NotificationService, NotificationData } from './notification-service';

export interface DispatcherConfig {
  // Rate limiting
  enableRateLimiting: boolean;
  rateLimits: {
    perSecond: number;
    perMinute: number;
    perHour: number;
  };
  burstCapacity: number;

  // Batching
  enableBatching: boolean;
  batchConfig: {
    maxBatchSize: number;
    batchTimeout: number; // ms
    maxBatchDelay: number; // ms
  };

  // Retry logic
  enableRetry: boolean;
  retryConfig: {
    maxAttempts: number;
    baseDelay: number; // ms
    maxDelay: number; // ms
    backoffMultiplier: number;
  };

  // Circuit breaker
  enableCircuitBreaker: boolean;
  circuitBreakerConfig: {
    failureThreshold: number;
    resetTimeout: number; // ms
    monitoringPeriod: number; // ms
  };

  // Performance monitoring
  enableMetrics: boolean;
  metricsInterval: number; // ms
}

export interface QueuedNotification extends NotificationData {
  id: string;
  queueId: string;
  priority: number; // numeric priority for sorting
  enqueuedAt: Date;
  scheduledFor: Date;
  attempts: number;
  lastAttempt?: Date;
  retryable: boolean;
}

export interface NotificationBatch {
  id: string;
  userId: number;
  notifications: QueuedNotification[];
  createdAt: Date;
  scheduledFor: Date;
  size: number;
}

export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  windowStart: number;
  count: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
  calls: number;
}

export interface DispatcherMetrics {
  totalQueued: number;
  totalDispatched: number;
  totalFailed: number;
  totalRetried: number;
  averageQueueTime: number;
  averageDispatchTime: number;
  successRate: number;
  queueDepth: number;
  batchesProcessed: number;
  rateLimitHits: number;
  circuitBreakerTrips: number;

  // Per user metrics
  userMetrics: Map<number, {
    queued: number;
    dispatched: number;
    failed: number;
    lastDispatch?: Date;
  }>;

  // Time series metrics (last hour)
  timeSeries: Array<{
    timestamp: Date;
    dispatched: number;
    failed: number;
    rateLimited: number;
  }>;
}

export class NotificationDispatcher extends EventEmitter {
  private bot: Telegraf;
  private config: DispatcherConfig;
  private notificationService: NotificationService;

  // Queue management
  private processingQueues: Map<string, QueuedNotification[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private isProcessing = false;

  // Rate limiting
  private rateLimits: Map<number, RateLimitBucket> = new Map();
  private globalRateLimit: RateLimitBucket;

  // Circuit breaker
  private circuitBreaker: CircuitBreakerState;

  // Retry management
  private retryQueue: QueuedNotification[] = [];
  private retryTimer?: NodeJS.Timeout;

  // Metrics
  private metrics: DispatcherMetrics;
  private metricsTimer?: NodeJS.Timeout;

  constructor(
    bot: Telegraf,
    notificationService: NotificationService,
    config: Partial<DispatcherConfig> = {}
  ) {
    super();

    this.bot = bot;
    this.notificationService = notificationService;

    this.config = {
      enableRateLimiting: true,
      rateLimits: {
        perSecond: 5,
        perMinute: 30,
        perHour: 500
      },
      burstCapacity: 10,

      enableBatching: true,
      batchConfig: {
        maxBatchSize: 20,
        batchTimeout: 5000,
        maxBatchDelay: 30000
      },

      enableRetry: true,
      retryConfig: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2
      },

      enableCircuitBreaker: true,
      circuitBreakerConfig: {
        failureThreshold: 10,
        resetTimeout: 60000,
        monitoringPeriod: 300000
      },

      enableMetrics: true,
      metricsInterval: 60000, // 1 minute
      ...config
    };

    this.initializeState();
    this.startPeriodicTasks();
  }

  private initializeState(): void {
    // Initialize global rate limit
    this.globalRateLimit = {
      tokens: this.config.rateLimits.perSecond,
      lastRefill: Date.now(),
      windowStart: Date.now(),
      count: 0
    };

    // Initialize circuit breaker
    this.circuitBreaker = {
      state: 'closed',
      failures: 0,
      calls: 0
    };

    // Initialize metrics
    this.metrics = {
      totalQueued: 0,
      totalDispatched: 0,
      totalFailed: 0,
      totalRetried: 0,
      averageQueueTime: 0,
      averageDispatchTime: 0,
      successRate: 1,
      queueDepth: 0,
      batchesProcessed: 0,
      rateLimitHits: 0,
      circuitBreakerTrips: 0,
      userMetrics: new Map(),
      timeSeries: []
    };
  }

  private startPeriodicTasks(): void {
    if (this.config.enableMetrics) {
      this.metricsTimer = setInterval(() => {
        this.collectMetrics();
      }, this.config.metricsInterval);
    }

    // Process retry queue every 5 seconds
    setInterval(() => {
      this.processRetryQueue();
    }, 5000);

    // Cleanup old metrics (keep last hour)
    setInterval(() => {
      this.cleanupMetrics();
    }, 10 * 60 * 1000); // 10 minutes
  }

  async enqueue(notification: NotificationData, options: {
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    scheduledFor?: Date;
    retryable?: boolean;
  } = {}): Promise<string> {
    const id = this.generateNotificationId(notification);
    const queueId = `queue:${notification.userId}`;

    const queuedNotification: QueuedNotification = {
      ...notification,
      id,
      queueId,
      priority: this.getNumericPriority(options.priority || notification.priority),
      enqueuedAt: new Date(),
      scheduledFor: options.scheduledFor || new Date(),
      attempts: 0,
      retryable: options.retryable !== false,
    };

    try {
      // Add to queue
      if (!this.processingQueues.has(queueId)) {
        this.processingQueues.set(queueId, []);
      }

      const queue = this.processingQueues.get(queueId)!;
      this.insertSorted(queue, queuedNotification);

      // Update metrics
      this.metrics.totalQueued++;
      this.updateUserMetrics(notification.userId, 'queued');

      // Schedule processing
      if (this.config.enableBatching) {
        this.scheduleBatchProcessing(notification.userId);
      } else {
        this.processNotifications();
      }

      logger.debug(`Notification enqueued: ${id} for user ${notification.userId}`);
      this.emit('notification:enqueued', queuedNotification);

      return id;

    } catch (error) {
      logger.error(`Error enqueuing notification: ${id}`, error);
      this.emit('notification:error', { notification: queuedNotification, error });
      throw error;
    }
  }

  private async scheduleBatchProcessing(userId: number): Promise<void> {
    const queueId = `queue:${userId}`;

    if (this.batchTimers.has(queueId)) {
      return; // Already scheduled
    }

    const timer = setTimeout(() => {
      this.processBatch(userId);
      this.batchTimers.delete(queueId);
    }, this.config.batchConfig.batchTimeout);

    this.batchTimers.set(queueId, timer);
  }

  private async processBatch(userId: number): Promise<void> {
    const queueId = `queue:${userId}`;
    const queue = this.processingQueues.get(queueId);

    if (!queue || queue.length === 0) {
      return;
    }

    // Check circuit breaker
    if (this.config.enableCircuitBreaker && !this.canProcessRequest()) {
      logger.warn('Circuit breaker open, skipping batch processing');
      return;
    }

    try {
      const now = new Date();
      const eligibleNotifications = queue.filter(n => n.scheduledFor <= now);

      if (eligibleNotifications.length === 0) {
        return;
      }

      // Take batch size or all eligible notifications
      const batchSize = Math.min(eligibleNotifications.length, this.config.batchConfig.maxBatchSize);
      const batchNotifications = eligibleNotifications.slice(0, batchSize);

      // Remove from queue
      this.processingQueues.set(queueId, queue.filter(n => !batchNotifications.includes(n)));

      // Process batch
      await this.dispatchBatch(userId, batchNotifications);

      // Update metrics
      this.metrics.batchesProcessed++;

      // Schedule next batch if queue still has items
      if (queue.length > 0) {
        this.scheduleBatchProcessing(userId);
      }

    } catch (error) {
      logger.error(`Error processing batch for user ${userId}:`, error);
      this.updateCircuitBreaker(false);
    }
  }

  private async dispatchBatch(userId: number, notifications: QueuedNotification[]): Promise<void> {
    const startTime = Date.now();

    try {
      if (notifications.length === 1) {
        await this.dispatchSingle(notifications[0]);
      } else {
        await this.dispatchMultiple(userId, notifications);
      }

      // Update metrics
      const dispatchTime = Date.now() - startTime;
      this.updateDispatchMetrics(dispatchTime, notifications.length, true);

      logger.debug(`Batch dispatched: ${notifications.length} notifications for user ${userId}`);

    } catch (error) {
      // Update metrics
      const dispatchTime = Date.now() - startTime;
      this.updateDispatchMetrics(dispatchTime, notifications.length, false);

      logger.error(`Error dispatching batch for user ${userId}:`, error);
      this.updateCircuitBreaker(false);

      // Add failed notifications to retry queue
      for (const notification of notifications) {
        if (notification.retryable) {
          this.addToRetryQueue(notification);
        }
      }
    }
  }

  private async dispatchSingle(notification: QueuedNotification): Promise<void> {
    // Check rate limiting
    if (this.config.enableRateLimiting && !this.checkRateLimit(notification.userId)) {
      this.metrics.rateLimitHits++;
      // Re-queue for later
      notification.scheduledFor = new Date(Date.now() + 1000);
      await this.enqueue(notification);
      return;
    }

    try {
      await this.notificationService.deliverNotification(notification);
      notification.attempts++;
      this.metrics.totalDispatched++;
      this.updateUserMetrics(notification.userId, 'dispatched');

      this.emit('notification:dispatched', notification);

    } catch (error) {
      this.metrics.totalFailed++;
      this.updateUserMetrics(notification.userId, 'failed');

      if (notification.retryable && notification.attempts < this.config.retryConfig.maxAttempts) {
        this.addToRetryQueue(notification);
        this.metrics.totalRetried++;
      }

      this.emit('notification:dispatchError', { notification, error });
      throw error;
    }
  }

  private async dispatchMultiple(userId: number, notifications: QueuedNotification[]): Promise<void> {
    if (notifications.length <= 3) {
      // Send individually for small batches
      for (const notification of notifications) {
        await this.dispatchSingle(notification);
      }
      return;
    }

    // Create batch summary
    const summaryNotification = this.createBatchSummary(userId, notifications);
    await this.dispatchSingle(summaryNotification);
  }

  private createBatchSummary(userId: number, notifications: QueuedNotification[]): QueuedNotification {
    const typeGroups = notifications.reduce((groups, notif) => {
      groups[notif.type] = (groups[notif.type] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);

    const typeSummary = Object.entries(typeGroups)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');

    const priority = this.getHighestPriority(notifications);

    return {
      id: this.generateNotificationId({ userId, type: 'system' } as NotificationData),
      queueId: `queue:${userId}`,
      priority,
      enqueuedAt: new Date(),
      scheduledFor: new Date(),
      attempts: 0,
      retryable: false,
      userId,
      type: 'system',
      title: `📊 ${notifications.length} New Updates`,
      message: `You have ${typeSummary}. Tap to view details.`,
      data: {
        batch: true,
        notifications: notifications.map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          priority: n.priority
        }))
      },
      priority: 'medium',
      metadata: {
        timestamp: Date.now()
      }
    };
  }

  private getHighestPriority(notifications: QueuedNotification[]): QueuedNotification['priority'] {
    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
    return notifications.reduce((highest, notif) => {
      return priorityOrder[notif.priority] > priorityOrder[highest] ? notif.priority : highest;
    }, 'low' as QueuedNotification['priority']);
  }

  private checkRateLimit(userId: number): boolean {
    // Check global rate limit
    if (!this.refillGlobalTokens()) {
      return false;
    }

    if (this.globalRateLimit.tokens <= 0) {
      return false;
    }

    this.globalRateLimit.tokens--;

    // Check per-user rate limits
    const now = Date.now();
    let userBucket = this.rateLimits.get(userId);

    if (!userBucket) {
      userBucket = {
        tokens: this.config.rateLimits.perSecond,
        lastRefill: now,
        windowStart: now,
        count: 0
      };
      this.rateLimits.set(userId, userBucket);
    }

    // Refill tokens based on time elapsed
    const timeDiff = now - userBucket.lastRefill;
    if (timeDiff >= 1000) {
      userBucket.tokens = Math.min(
        this.config.rateLimits.perSecond,
        userBucket.tokens + Math.floor(timeDiff / 1000)
      );
      userBucket.lastRefill = now;
    }

    if (userBucket.tokens <= 0) {
      return false;
    }

    userBucket.tokens--;
    return true;
  }

  private refillGlobalTokens(): boolean {
    const now = Date.now();
    const timeDiff = now - this.globalRateLimit.lastRefill;

    if (timeDiff >= 1000) {
      this.globalRateLimit.tokens = Math.min(
        this.config.rateLimits.perSecond,
        this.globalRateLimit.tokens + Math.floor(timeDiff / 1000)
      );
      this.globalRateLimit.lastRefill = now;
      return true;
    }

    return false;
  }

  private canProcessRequest(): boolean {
    const now = Date.now();

    // Check if circuit breaker is open
    if (this.circuitBreaker.state === 'open') {
      if (this.circuitBreaker.nextAttemptTime && now < this.circuitBreaker.nextAttemptTime.getTime()) {
        return false;
      }
      // Move to half-open state
      this.circuitBreaker.state = 'half_open';
      this.circuitBreaker.calls = 0;
    }

    // Check if we're in half-open state with too many calls
    if (this.circuitBreaker.state === 'half_open' && this.circuitBreaker.calls >= 5) {
      return false;
    }

    return true;
  }

  private updateCircuitBreaker(success: boolean): void {
    if (!this.config.enableCircuitBreaker) {
      return;
    }

    this.circuitBreaker.calls++;

    if (success) {
      if (this.circuitBreaker.state === 'half_open') {
        // Success in half-open state, close the circuit breaker
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
      }
    } else {
      this.circuitBreaker.failures++;

      if (this.circuitBreaker.failures >= this.config.circuitBreakerConfig.failureThreshold) {
        // Trip the circuit breaker
        this.circuitBreaker.state = 'open';
        this.circuitBreaker.lastFailureTime = new Date();
        this.circuitBreaker.nextAttemptTime = new Date(
          Date.now() + this.config.circuitBreakerConfig.resetTimeout
        );

        this.metrics.circuitBreakerTrips++;
        logger.warn('Circuit breaker tripped', {
          failures: this.circuitBreaker.failures,
          nextAttempt: this.circuitBreaker.nextAttemptTime
        });

        this.emit('circuitBreaker:tripped', this.circuitBreaker);
      }
    }
  }

  private addToRetryQueue(notification: QueuedNotification): void {
    notification.attempts++;
    notification.lastAttempt = new Date();

    // Calculate retry delay
    const delay = Math.min(
      this.config.retryConfig.baseDelay * Math.pow(this.config.retryConfig.backoffMultiplier, notification.attempts - 1),
      this.config.retryConfig.maxDelay
    );

    notification.scheduledFor = new Date(Date.now() + delay);

    this.retryQueue.push(notification);
    this.retryQueue.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  }

  private async processRetryQueue(): Promise<void> {
    const now = new Date();
    const readyToRetry = this.retryQueue.filter(n => n.scheduledFor <= now);

    if (readyToRetry.length === 0) {
      return;
    }

    // Remove from retry queue
    this.retryQueue = this.retryQueue.filter(n => n.scheduledFor > now);

    // Re-enqueue notifications
    for (const notification of readyToRetry) {
      try {
        await this.enqueue(notification);
        logger.debug(`Notification requeued for retry: ${notification.id}`);
      } catch (error) {
        logger.error(`Error requeuing notification for retry: ${notification.id}`, error);
      }
    }
  }

  private insertSorted(queue: QueuedNotification[], notification: QueuedNotification): void {
    let low = 0, high = queue.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (queue[mid].priority < notification.priority) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    queue.splice(low, 0, notification);
  }

  private getNumericPriority(priority: string): number {
    const priorities = { urgent: 4, high: 3, medium: 2, low: 1 };
    return priorities[priority as keyof typeof priorities] || 2;
  }

  private generateNotificationId(notification: NotificationData): string {
    return `notif_${Date.now()}_${notification.userId}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateUserMetrics(userId: number, action: 'queued' | 'dispatched' | 'failed'): void {
    let userMetric = this.metrics.userMetrics.get(userId);

    if (!userMetric) {
      userMetric = {
        queued: 0,
        dispatched: 0,
        failed: 0
      };
      this.metrics.userMetrics.set(userId, userMetric);
    }

    userMetric[action]++;

    if (action === 'dispatched') {
      userMetric.lastDispatch = new Date();
    }
  }

  private updateDispatchMetrics(dispatchTime: number, count: number, success: boolean): void {
    // Update average dispatch time
    this.metrics.averageDispatchTime = (
      (this.metrics.averageDispatchTime * this.metrics.totalDispatched + dispatchTime) /
      (this.metrics.totalDispatched + count)
    );

    // Update queue depth
    this.metrics.queueDepth = Array.from(this.processingQueues.values())
      .reduce((total, queue) => total + queue.length, 0);

    // Update success rate
    const total = this.metrics.totalDispatched + this.metrics.totalFailed;
    this.metrics.successRate = total > 0 ? this.metrics.totalDispatched / total : 1;
  }

  private collectMetrics(): void {
    if (!this.config.enableMetrics) {
      return;
    }

    const now = new Date();
    const currentTimeSlot = {
      timestamp: now,
      dispatched: 0,
      failed: 0,
      rateLimited: 0
    };

    // Add to time series (keep last hour)
    this.metrics.timeSeries.push(currentTimeSlot);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    this.metrics.timeSeries = this.metrics.timeSeries.filter(entry => entry.timestamp > oneHourAgo);

    this.emit('metrics:collected', this.getMetrics());
  }

  private cleanupMetrics(): void {
    // Keep only last hour of time series data
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.metrics.timeSeries = this.metrics.timeSeries.filter(entry => entry.timestamp > oneHourAgo);

    // Cleanup rate limit buckets older than 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [userId, bucket] of this.rateLimits.entries()) {
      if (bucket.lastRefill < fiveMinutesAgo) {
        this.rateLimits.delete(userId);
      }
    }
  }

  // Public API methods
  async processNotifications(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const userIds = Array.from(this.processingQueues.keys())
        .map(key => parseInt(key.split(':')[1]))
        .filter(id => !isNaN(id));

      for (const userId of userIds) {
        await this.processBatch(userId);
      }
    } catch (error) {
      logger.error('Error processing notifications:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  getMetrics(): DispatcherMetrics {
    return {
      ...this.metrics,
      queueDepth: Array.from(this.processingQueues.values())
        .reduce((total, queue) => total + queue.length, 0) + this.retryQueue.length
    };
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  getQueueStatus(): Array<{ userId: number; queueSize: number; oldestNotification?: Date }> {
    const status = [];

    for (const [queueId, queue] of this.processingQueues.entries()) {
      const userId = parseInt(queueId.split(':')[1]);
      if (!isNaN(userId) && queue.length > 0) {
        status.push({
          userId,
          queueSize: queue.length,
          oldestNotification: queue[0]?.enqueuedAt
        });
      }
    }

    return status;
  }

  async forceFlush(userId?: number): Promise<void> {
    if (userId) {
      await this.processBatch(userId);
    } else {
      await this.processNotifications();
    }
  }

  updateConfig(newConfig: Partial<DispatcherConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Notification dispatcher config updated', this.config);
  }

  async shutdown(): Promise<void> {
    // Clear timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    // Process remaining notifications
    await this.processNotifications();

    logger.info('Notification dispatcher shut down');
  }
}

export default NotificationDispatcher;