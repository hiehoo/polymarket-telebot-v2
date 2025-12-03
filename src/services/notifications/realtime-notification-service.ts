import { EventEmitter } from 'events';
import PolymarketWebSocketClient from '../polymarket/websocket-client';
import { NotificationService } from '../notifications/notification-service';
import { ProcessingEvent, PolymarketEvent } from '@/types/data-processing';
import { TelegramUserPreferences, WalletTracking } from '@/types/telegram';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';

export interface RealTimeNotificationConfig {
  enableBatching: boolean;
  batchSize: number;
  batchTimeout: number; // ms
  maxConcurrentNotifications: number;
  enableDeduplication: boolean;
  deduplicationWindow: number; // ms
  enablePrioritization: boolean;
  enableRateLimiting: boolean;
  rateLimitPerUser: number; // per minute
}

export interface NotificationEvent {
  id: string;
  userId: number;
  type: 'transaction' | 'position' | 'resolution' | 'price_alert' | 'system';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  message: string;
  data: any;
  metadata: {
    walletId?: string;
    transactionHash?: string;
    marketId?: string;
    conditionId?: string;
    timestamp: number;
    source: 'websocket' | 'api' | 'scheduled';
  };
  createdAt: Date;
}

export interface NotificationBatch {
  id: string;
  userId: number;
  events: NotificationEvent[];
  createdAt: Date;
  scheduledFor: Date;
}

export interface UserNotificationContext {
  userId: number;
  preferences: TelegramUserPreferences;
  trackedWallets: WalletTracking[];
  lastNotification?: Date;
  notificationCount: number;
  rateLimitReset?: Date;
}

export class RealTimeNotificationService extends EventEmitter {
  private wsClient: PolymarketWebSocketClient;
  private notificationService: NotificationService;
  private config: RealTimeNotificationConfig;

  // Event processing
  private eventQueue: Map<string, NotificationEvent> = new Map();
  private processingQueue: NotificationEvent[] = [];
  private batchTimers: Map<number, NodeJS.Timeout> = new Map();

  // User contexts
  private userContexts: Map<number, UserNotificationContext> = new Map();
  private contextCacheExpiry = 5 * 60 * 1000; // 5 minutes

  // Deduplication
  private recentEvents: Map<string, number> = new Map();

  // Rate limiting
  private userRateLimits: Map<number, { count: number; resetTime: number }> = new Map();

  // Performance tracking
  private metrics = {
    eventsProcessed: 0,
    notificationsSent: 0,
    batchesProcessed: 0,
    averageProcessingTime: 0,
    errorCount: 0,
    deduplicationHits: 0,
    rateLimitHits: 0
  };

  constructor(
    wsClient: PolymarketWebSocketClient,
    notificationService: NotificationService,
    config: Partial<RealTimeNotificationConfig> = {}
  ) {
    super();

    this.wsClient = wsClient;
    this.notificationService = notificationService;

    this.config = {
      enableBatching: true,
      batchSize: 10,
      batchTimeout: 5000, // 5 seconds
      maxConcurrentNotifications: 100,
      enableDeduplication: true,
      deduplicationWindow: 30000, // 30 seconds
      enablePrioritization: true,
      enableRateLimiting: true,
      rateLimitPerUser: 10, // per minute
      ...config
    };

    this.setupWebSocketListeners();
    this.startPeriodicCleanup();
  }

  private setupWebSocketListeners(): void {
    this.wsClient.on('message', (event: ProcessingEvent) => {
      this.handleWebSocketEvent(event).catch(error => {
        logger.error('Error handling WebSocket event:', error);
        this.metrics.errorCount++;
      });
    });

    this.wsClient.on('connected', () => {
      logger.info('Real-time notification service connected to WebSocket');
      this.emit('websocket:connected');
    });

    this.wsClient.on('disconnected', () => {
      logger.warn('Real-time notification service disconnected from WebSocket');
      this.emit('websocket:disconnected');
    });

    this.wsClient.on('rateLimit', (rateLimit) => {
      logger.warn('WebSocket rate limit hit', rateLimit);
      this.emit('rateLimit', rateLimit);
    });
  }

  private async handleWebSocketEvent(event: ProcessingEvent): Promise<void> {
    const startTime = Date.now();

    try {
      // Convert processing event to notification events
      const notificationEvents = await this.convertToNotificationEvents(event);

      // Process each notification event
      for (const notificationEvent of notificationEvents) {
        await this.processNotificationEvent(notificationEvent);
      }

      this.metrics.eventsProcessed++;
      this.updateProcessingTimeMetrics(Date.now() - startTime);

    } catch (error) {
      logger.error('Failed to handle WebSocket event:', error);
      this.metrics.errorCount++;
      this.emit('error', { event, error });
    }
  }

  private async convertToNotificationEvents(event: ProcessingEvent): Promise<NotificationEvent[]> {
    const events: NotificationEvent[] = [];

    // Get users who should be notified about this event
    const interestedUsers = await this.getInterestedUsers(event);

    for (const userId of interestedUsers) {
      const notificationEvent = await this.createNotificationEvent(userId, event);
      if (notificationEvent) {
        events.push(notificationEvent);
      }
    }

    return events;
  }

  private async getInterestedUsers(event: ProcessingEvent): Promise<number[]> {
    const interestedUsers: number[] = [];

    try {
      // Get users tracking this wallet/condition
      const trackingKey = this.buildTrackingKey(event);
      const trackedUsers = await redisClient.smembers(trackingKey);

      // Convert user IDs to numbers and filter active users
      for (const userIdStr of trackedUsers) {
        const userId = parseInt(userIdStr);
        if (!isNaN(userId)) {
          const context = await this.getUserContext(userId);
          if (context && this.isNotificationEnabled(context, event)) {
            interestedUsers.push(userId);
          }
        }
      }

    } catch (error) {
      logger.error('Error getting interested users:', error);
    }

    return interestedUsers;
  }

  private buildTrackingKey(event: ProcessingEvent): string {
    if (event.userId) {
      return `tracking:user:${event.userId}`;
    }
    if (event.conditionId) {
      return `tracking:condition:${event.conditionId}`;
    }
    return `tracking:global`;
  }

  private async getUserContext(userId: number): Promise<UserNotificationContext | null> {
    // Check cache first
    const cached = this.userContexts.get(userId);
    if (cached && Date.now() - cached.notificationCount * 1000 < this.contextCacheExpiry) {
      return cached;
    }

    try {
      // Get user preferences
      const prefsKey = `user:${userId}:preferences`;
      const prefsData = await redisClient.get(prefsKey);
      const preferences = prefsData ? JSON.parse(prefsData) : null;

      if (!preferences || !preferences.notifications?.enabled) {
        return null;
      }

      // Get tracked wallets
      const walletsKey = `user:${userId}:wallets`;
      const walletsData = await redisClient.get(walletsKey);
      const trackedWallets = walletsData ? JSON.parse(walletsData) : [];

      const context: UserNotificationContext = {
        userId,
        preferences,
        trackedWallets,
        notificationCount: 0,
        lastNotification: undefined,
        rateLimitReset: undefined
      };

      this.userContexts.set(userId, context);
      return context;

    } catch (error) {
      logger.error(`Error getting user context for ${userId}:`, error);
      return null;
    }
  }

  private isNotificationEnabled(context: UserNotificationContext, event: ProcessingEvent): boolean {
    const preferences = context.preferences.notifications;

    // Check quiet hours
    if (preferences.quietHours?.enabled && this.isQuietHours(preferences.quietHours)) {
      return false; // Only urgent messages during quiet hours
    }

    // Check event type preferences
    switch (event.type) {
      case 'TRANSACTION':
        return preferences.types.transactions;
      case 'POSITION_UPDATE':
        return preferences.types.positions;
      case 'RESOLUTION':
        return preferences.types.resolutions;
      case 'PRICE_UPDATE':
        return preferences.types.priceAlerts;
      default:
        return true;
    }
  }

  private isQuietHours(quietHours: TelegramUserPreferences['notifications']['quietHours']): boolean {
    if (!quietHours?.enabled) return false;

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = quietHours.start.split(':').map(Number);
    const [endHour, endMin] = quietHours.end.split(':').map(Number);
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  private async createNotificationEvent(userId: number, event: ProcessingEvent): Promise<NotificationEvent | null> {
    try {
      const context = await this.getUserContext(userId);
      if (!context) return null;

      // Check rate limiting
      if (this.config.enableRateLimiting && this.isRateLimited(userId)) {
        this.metrics.rateLimitHits++;
        return null;
      }

      // Check deduplication
      if (this.config.enableDeduplication && this.isDuplicate(event, userId)) {
        this.metrics.deduplicationHits++;
        return null;
      }

      const { type, title, message, priority } = this.formatNotificationEvent(event, context);

      return {
        id: `notif_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type,
        priority,
        title,
        message,
        data: event.data,
        metadata: {
          walletId: event.userId,
          transactionHash: event.data?.transaction?.hash,
          marketId: event.conditionId,
          conditionId: event.conditionId,
          timestamp: event.timestamp.getTime(),
          source: 'websocket'
        },
        createdAt: new Date()
      };

    } catch (error) {
      logger.error(`Error creating notification event for user ${userId}:`, error);
      return null;
    }
  }

  private isRateLimited(userId: number): boolean {
    const now = Date.now();
    const rateLimit = this.userRateLimits.get(userId);

    if (!rateLimit || now > rateLimit.resetTime) {
      // Reset or create rate limit entry
      this.userRateLimits.set(userId, {
        count: 1,
        resetTime: now + 60000 // 1 minute
      });
      return false;
    }

    if (rateLimit.count >= this.config.rateLimitPerUser) {
      return true;
    }

    rateLimit.count++;
    return false;
  }

  private isDuplicate(event: ProcessingEvent, userId: number): boolean {
    const dedupKey = `${userId}_${event.type}_${event.conditionId}_${event.userId}`;
    const lastOccurrence = this.recentEvents.get(dedupKey);

    if (!lastOccurrence || Date.now() - lastOccurrence > this.config.deduplicationWindow) {
      this.recentEvents.set(dedupKey, Date.now());
      return false;
    }

    return true;
  }

  private formatNotificationEvent(event: ProcessingEvent, context: UserNotificationContext): {
    type: NotificationEvent['type'];
    title: string;
    message: string;
    priority: NotificationEvent['priority'];
  } {
    const thresholds = context.preferences.notifications.thresholds;

    switch (event.type) {
      case 'TRANSACTION': {
        const transaction = event.data?.transaction;
        const amount = transaction?.amount || 0;

        return {
          type: 'transaction',
          title: '💰 New Transaction',
          message: `Transaction of $${amount.toLocaleString()} detected`,
          priority: amount > thresholds.minTransactionAmount ? 'high' : 'medium'
        };
      }

      case 'POSITION_UPDATE': {
        const position = event.data?.position;
        const size = position?.size || 0;

        return {
          type: 'position',
          title: '📊 Position Update',
          message: `Position updated: ${size.toFixed(2)}`,
          priority: size > thresholds.minPositionSize ? 'high' : 'medium'
        };
      }

      case 'RESOLUTION': {
        return {
          type: 'resolution',
          title: '🎯 Market Resolved',
          message: `Market has been resolved`,
          priority: 'urgent'
        };
      }

      case 'PRICE_UPDATE': {
        const marketData = event.data?.marketData;
        const priceChange = marketData?.priceChange || 0;

        return {
          type: 'price_alert',
          title: '📈 Price Alert',
          message: `Price changed by ${priceChange.toFixed(2)}%`,
          priority: Math.abs(priceChange) > thresholds.priceChangeThreshold ? 'high' : 'low'
        };
      }

      default:
        return {
          type: 'system',
          title: '📢 Update',
          message: 'New update available',
          priority: 'medium'
        };
    }
  }

  private async processNotificationEvent(event: NotificationEvent): Promise<void> {
    try {
      if (this.config.enableBatching) {
        await this.addToBatch(event);
      } else {
        await this.sendNotification(event);
      }
    } catch (error) {
      logger.error('Error processing notification event:', error);
      this.metrics.errorCount++;
    }
  }

  private async addToBatch(event: NotificationEvent): Promise<void> {
    const batchKey = event.userId;

    // Initialize batch if not exists
    if (!this.eventQueue.has(event.id)) {
      this.eventQueue.set(event.id, event);
      this.processingQueue.push(event);
    }

    // Schedule batch processing
    if (!this.batchTimers.has(batchKey)) {
      const timer = setTimeout(() => {
        this.processBatch(batchKey);
      }, this.config.batchTimeout);

      this.batchTimers.set(batchKey, timer);
    }

    // Process batch immediately if it reaches max size
    const userEvents = this.processingQueue.filter(e => e.userId === batchKey);
    if (userEvents.length >= this.config.batchSize) {
      this.processBatch(batchKey);
    }
  }

  private async processBatch(userId: number): Promise<void> {
    const timer = this.batchTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(userId);
    }

    const userEvents = this.processingQueue.filter(e => e.userId === userId);
    if (userEvents.length === 0) return;

    // Remove events from processing queue
    this.processingQueue = this.processingQueue.filter(e => e.userId !== userId);

    // Sort by priority
    userEvents.sort((a, b) => this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority));

    try {
      if (userEvents.length === 1) {
        await this.sendNotification(userEvents[0]);
      } else {
        await this.sendBatchedNotifications(userId, userEvents);
      }

      this.metrics.batchesProcessed++;

    } catch (error) {
      logger.error(`Error processing batch for user ${userId}:`, error);
      this.metrics.errorCount++;
    }
  }

  private async sendBatchedNotifications(userId: number, events: NotificationEvent[]): Promise<void> {
    // Create a summary notification for batched events
    const summaryEvent: NotificationEvent = {
      id: `batch_${Date.now()}_${userId}`,
      userId,
      type: 'system',
      priority: this.getHighestPriority(events),
      title: `📊 ${events.length} New Updates`,
      message: this.formatBatchSummary(events),
      data: { events: events.map(e => ({ type: e.type, title: e.title, priority: e.priority })) },
      metadata: {
        timestamp: Date.now(),
        source: 'websocket'
      },
      createdAt: new Date()
    };

    await this.sendNotification(summaryEvent);
  }

  private formatBatchSummary(events: NotificationEvent[]): string {
    const typeCounts = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const summaries = Object.entries(typeCounts)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');

    return summaries;
  }

  private getHighestPriority(events: NotificationEvent[]): NotificationEvent['priority'] {
    const priorities = { urgent: 4, high: 3, medium: 2, low: 1 };
    return events.reduce((highest, event) => {
      return priorities[event.priority] > priorities[highest] ? event.priority : highest;
    }, 'low' as NotificationEvent['priority']);
  }

  private getPriorityWeight(priority: NotificationEvent['priority']): number {
    const weights = { urgent: 4, high: 3, medium: 2, low: 1 };
    return weights[priority];
  }

  private async sendNotification(event: NotificationEvent): Promise<void> {
    try {
      await this.notificationService.queueNotification({
        userId: event.userId,
        type: event.type,
        title: event.title,
        message: event.message,
        data: event.data,
        priority: event.priority,
        metadata: event.metadata
      });

      this.metrics.notificationsSent++;

      // Update user context
      const context = this.userContexts.get(event.userId);
      if (context) {
        context.lastNotification = new Date();
        context.notificationCount++;
      }

      this.emit('notification:sent', event);

    } catch (error) {
      logger.error(`Error sending notification for event ${event.id}:`, error);
      this.metrics.errorCount++;
      this.emit('notification:error', { event, error });
    }
  }

  private updateProcessingTimeMetrics(processingTime: number): void {
    const alpha = 0.1; // Exponential moving average factor
    this.metrics.averageProcessingTime =
      this.metrics.averageProcessingTime * (1 - alpha) + processingTime * alpha;
  }

  private startPeriodicCleanup(): void {
    // Cleanup expired entries every 5 minutes
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 5 * 60 * 1000);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();

    // Cleanup deduplication entries
    for (const [key, timestamp] of this.recentEvents.entries()) {
      if (now - timestamp > this.config.deduplicationWindow) {
        this.recentEvents.delete(key);
      }
    }

    // Cleanup rate limit entries
    for (const [userId, rateLimit] of this.userRateLimits.entries()) {
      if (now > rateLimit.resetTime) {
        this.userRateLimits.delete(userId);
      }
    }

    // Cleanup old user contexts
    for (const [userId, context] of this.userContexts.entries()) {
      if (now - context.lastNotification!.getTime() > this.contextCacheExpiry) {
        this.userContexts.delete(userId);
      }
    }
  }

  // Public API methods
  public getMetrics() {
    return { ...this.metrics };
  }

  public async forceProcessBatch(userId: number): Promise<void> {
    await this.processBatch(userId);
  }

  public getQueueSize(): number {
    return this.processingQueue.length;
  }

  public getUserNotificationContext(userId: number): UserNotificationContext | undefined {
    return this.userContexts.get(userId);
  }

  public updateConfig(newConfig: Partial<RealTimeNotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Real-time notification config updated', this.config);
  }

  public async shutdown(): Promise<void> {
    // Clear all timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // Process remaining events
    const userIds = new Set(this.processingQueue.map(e => e.userId));
    for (const userId of userIds) {
      await this.processBatch(userId);
    }

    logger.info('Real-time notification service shut down');
  }
}

export default RealTimeNotificationService;