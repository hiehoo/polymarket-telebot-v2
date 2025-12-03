import { EventEmitter } from 'events';
import { Telegraf } from 'telegraf';
import PolymarketWebSocketClient from '../polymarket/websocket-client';
import { NotificationService } from './notification-service';
import RealTimeNotificationService from './realtime-notification-service';
import NotificationDispatcher from './notification-dispatcher';
import NotificationQueueManager from './notification-queue-manager';
import EnhancedNotificationTemplates from './notification-templates-enhanced';
import NotificationHistoryAnalytics from './notification-history-analytics';
import UserPreferenceFilter from './user-preference-filter';
import NotificationMonitoringAnalytics from './notification-monitoring-analytics';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';
import { NotificationData, TelegramUserPreferences } from '@/types/telegram';
import { ProcessingEvent } from '@/types/data-processing';

export interface TelegramNotificationServiceConfig {
  // Bot configuration
  botToken: string;
  webhookUrl?: string;
  dropPendingUpdates?: boolean;

  // Notification configuration
  enableRealTimeNotifications: boolean;
  enableBatching: boolean;
  enableHistory: boolean;
  enableAnalytics: boolean;
  enableMonitoring: boolean;

  // Performance targets
  targetDeliveryTime: number; // milliseconds
  targetSuccessRate: number; // percentage
  maxQueueDepth: number;
  maxConcurrentNotifications: number;

  // Rate limiting
  enableRateLimiting: boolean;
  rateLimits: {
    perSecond: number;
    perMinute: number;
    perHour: number;
  };

  // Retry configuration
  maxRetries: number;
  retryDelay: number; // milliseconds
  retryBackoffMultiplier: number;

  // Caching
  enableCaching: boolean;
  cacheTimeout: number; // seconds
}

export interface ServiceStatus {
  websocket: {
    connected: boolean;
    subscriptions: number;
    messagesReceived: number;
    lastMessage: Date;
  };
  notification: {
    queued: number;
    processing: number;
    delivered: number;
    failed: number;
    averageDeliveryTime: number;
  };
  system: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    health: 'healthy' | 'warning' | 'critical';
  };
}

export class TelegramNotificationService extends EventEmitter {
  private config: TelegramNotificationServiceConfig;
  private bot: Telegraf;

  // Core services
  private wsClient: PolymarketWebSocketClient;
  private notificationService: NotificationService;
  private realTimeService: RealTimeNotificationService;
  private dispatcher: NotificationDispatcher;
  private queueManager: NotificationQueueManager;
  private templates: EnhancedNotificationTemplates;
  private historyAnalytics: NotificationHistoryAnalytics;
  private preferenceFilter: UserPreferenceFilter;
  private monitoringAnalytics: NotificationMonitoringAnalytics;

  // Service state
  private isStarted = false;
  private startTime = new Date();

  constructor(
    bot: Telegraf,
    wsClient: PolymarketWebSocketClient,
    config: TelegramNotificationServiceConfig
  ) {
    super();

    this.config = config;
    this.bot = bot;
    this.wsClient = wsClient;

    this.initializeServices();
    this.setupEventHandlers();
  }

  private initializeServices(): void {
    // Initialize core notification service
    this.notificationService = new NotificationService(this.bot);

    // Initialize dispatcher with enhanced configuration
    this.dispatcher = new NotificationDispatcher(
      this.bot,
      this.notificationService,
      {
        enableRateLimiting: this.config.enableRateLimiting,
        rateLimits: this.config.rateLimits,
        enableBatching: this.config.enableBatching,
        enableRetry: true,
        retryConfig: {
          maxAttempts: this.config.maxRetries,
          baseDelay: this.config.retryDelay,
          maxDelay: this.config.retryDelay * this.config.retryBackoffMultiplier * 10,
          backoffMultiplier: this.config.retryBackoffMultiplier
        }
      }
    );

    // Initialize queue manager
    this.queueManager = new NotificationQueueManager({
      maxQueueSize: this.config.maxQueueDepth,
      enablePriorityQueuing: true,
      enableDeadLetterQueue: true,
      maxRetries: this.config.maxRetries
    });

    // Initialize templates
    this.templates = new EnhancedNotificationTemplates();

    // Initialize history analytics
    this.historyAnalytics = new NotificationHistoryAnalytics({
      enableRealTimeAnalytics: this.config.enableAnalytics,
      enableDetailedTracking: this.config.enableHistory,
      historyRetentionDays: 30
    });

    // Initialize preference filter
    this.preferenceFilter = new UserPreferenceFilter({
      enableSmartFiltering: true,
      enableAdaptiveThresholds: true,
      enableQuietHours: true,
      enableDeduplication: true
    });

    // Initialize monitoring analytics
    this.monitoringAnalytics = new NotificationMonitoringAnalytics({
      enableRealTimeMonitoring: this.config.enableMonitoring,
      enablePerformanceAlerts: true,
      enableHealthChecks: true,
      alertThresholds: {
        deliveryRate: this.config.targetSuccessRate,
        errorRate: 100 - this.config.targetSuccessRate,
        queueDepth: this.config.maxQueueDepth * 0.8,
        processingLatency: this.config.targetDeliveryTime
      }
    });
  }

  private setupEventHandlers(): void {
    // WebSocket event handlers
    this.wsClient.on('message', (event: ProcessingEvent) => {
      this.handleWebSocketEvent(event).catch(error => {
        logger.error('Error handling WebSocket event:', error);
      });
    });

    this.wsClient.on('connected', () => {
      logger.info('WebSocket connected for real-time notifications');
      this.emit('websocket:connected');
    });

    this.wsClient.on('disconnected', () => {
      logger.warn('WebSocket disconnected from real-time notifications');
      this.emit('websocket:disconnected');
    });

    // Dispatcher event handlers
    this.dispatcher.on('notification:dispatched', async (notification) => {
      await this.recordNotificationDelivered(notification);
    });

    this.dispatcher.on('notification:dispatchError', async (data) => {
      await this.recordNotificationFailed(data.notification, data.error);
    });

    // Queue manager event handlers
    this.queueManager.on('item:processed', async (item) => {
      await this.recordNotificationProcessed(item);
    });

    this.queueManager.on('item:failed', async (item) => {
      await this.recordNotificationFailed(item.payload, new Error('Queue processing failed'));
    });

    // Monitoring event handlers
    this.monitoringAnalytics.on('alert:triggered', (alert) => {
      this.emit('alert:triggered', alert);
      logger.warn('Monitoring alert triggered:', alert);
    });

    // Real-time service event handlers
    this.realTimeService?.on('notification:sent', async (notification) => {
      await this.monitoringAnalytics.recordNotificationProcessed(
        notification,
        Date.now() - notification.metadata.timestamp,
        true
      );
    });

    this.realTimeService?.on('notification:error', async (data) => {
      await this.monitoringAnalytics.recordNotificationProcessed(
        data.notification,
        Date.now() - data.notification.metadata.timestamp,
        false
      );
    });
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      logger.warn('Telegram notification service already started');
      return;
    }

    try {
      logger.info('Starting Telegram notification service...');

      // Start monitoring first to track service startup
      if (this.config.enableMonitoring) {
        this.monitoringAnalytics.startMonitoring();
      }

      // Connect WebSocket for real-time events
      if (this.config.enableRealTimeNotifications) {
        await this.wsClient.connect();

        // Subscribe to relevant channels
        await this.wsClient.subscribe('transactions', {
          events: ['all'],
          minAmount: 100
        });

        await this.wsClient.subscribe('positions', {
          events: ['opened', 'closed', 'increased', 'decreased']
        });

        await this.wsClient.subscribe('resolutions', {
          events: ['all']
        });

        // Initialize real-time service
        this.realTimeService = new RealTimeNotificationService(
          this.wsClient,
          this.notificationService,
          {
            enableBatching: this.config.enableBatching,
            enableRateLimiting: this.config.enableRateLimiting,
            enableDeduplication: true,
            enablePrioritization: true
          }
        );

        logger.info('Real-time notification service initialized');
      }

      // Start queue manager
      await this.queueManager.addWorker('main');
      logger.info('Queue manager started');

      // Warm up caches and prefetch data
      if (this.config.enableCaching) {
        await this.warmupCaches();
      }

      this.isStarted = true;
      this.startTime = new Date();

      logger.info('Telegram notification service started successfully');
      this.emit('service:started', { startTime: this.startTime });

    } catch (error) {
      logger.error('Failed to start Telegram notification service:', error);
      this.emit('service:startError', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      logger.info('Stopping Telegram notification service...');

      // Stop real-time service
      if (this.realTimeService) {
        await this.realTimeService.shutdown();
      }

      // Disconnect WebSocket
      await this.wsClient.disconnect();

      // Stop dispatcher
      await this.dispatcher.shutdown();

      // Stop queue manager
      await this.queueManager.shutdown();

      // Stop monitoring
      if (this.monitoringAnalytics) {
        await this.monitoringAnalytics.shutdown();
      }

      // Save final state
      await this.saveServiceState();

      this.isStarted = false;

      logger.info('Telegram notification service stopped');
      this.emit('service:stopped', { stoppedAt: new Date() });

    } catch (error) {
      logger.error('Error stopping Telegram notification service:', error);
      this.emit('service:stopError', error);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async handleWebSocketEvent(event: ProcessingEvent): Promise<void> {
    try {
      logger.debug('Processing WebSocket event:', {
        type: event.type,
        userId: event.userId,
        conditionId: event.conditionId
      });

      // Find interested users for this event
      const interestedUsers = await this.getInterestedUsers(event);

      if (interestedUsers.length === 0) {
        logger.debug('No interested users for WebSocket event');
        return;
      }

      // Generate notifications for all interested users
      const notificationPromises = interestedUsers.map(userId =>
        this.generateAndSendNotification(userId, event)
      );

      const results = await Promise.allSettled(notificationPromises);

      // Log results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.debug(`WebSocket event processed: ${successful} successful, ${failed} failed`, {
        type: event.type,
        totalUsers: interestedUsers.length
      });

      this.emit('websocket:eventProcessed', {
        event,
        interestedUsers: interestedUsers.length,
        successful,
        failed
      });

    } catch (error) {
      logger.error('Error handling WebSocket event:', error);
      this.emit('websocket:eventError', { event, error });
    }
  }

  private async getInterestedUsers(event: ProcessingEvent): Promise<number[]> {
    try {
      const interestedUsers: number[] = [];

      // Get users tracking this specific wallet
      if (event.userId) {
        const walletKey = `tracking:user:${event.userId}`;
        const walletTrackers = await redisClient.smembers(walletKey);
        interestedUsers.push(...walletTrackers.map(id => parseInt(id)));
      }

      // Get users tracking this condition/market
      if (event.conditionId) {
        const conditionKey = `tracking:condition:${event.conditionId}`;
        const conditionTrackers = await redisClient.smembers(conditionKey);
        interestedUsers.push(...conditionTrackers.map(id => parseInt(id)));
      }

      // Get users tracking all activity
      const globalKey = 'tracking:global';
      const globalTrackers = await redisClient.smembers(globalKey);
      interestedUsers.push(...globalTrackers.map(id => parseInt(id)));

      // Remove duplicates and filter valid user IDs
      const uniqueUsers = [...new Set(interestedUsers)].filter(id => !isNaN(id));

      return uniqueUsers;

    } catch (error) {
      logger.error('Error getting interested users:', error);
      return [];
    }
  }

  private async generateAndSendNotification(
    userId: number,
    event: ProcessingEvent
  ): Promise<void> {
    try {
      // Get user preferences
      const userPreferences = await this.getUserPreferences(userId);
      if (!userPreferences?.notifications?.enabled) {
        return; // User has disabled notifications
      }

      // Generate notification using templates
      const templateType = this.determineTemplateType(event);
      const notificationData = this.templates.generateNotification(templateType, {
        event,
        userPreferences
      });

      if (!notificationData) {
        logger.warn(`No template generated for event type: ${templateType}`);
        return;
      }

      // Set user ID
      notificationData.userId = userId;

      // Apply user preference filtering
      const filterResult = await this.preferenceFilter.shouldDeliverNotification(
        userId,
        notificationData,
        event
      );

      if (!filterResult.shouldDeliver) {
        logger.debug(`Notification filtered for user ${userId}: ${filterResult.reason}`);
        await this.recordNotificationFiltered(userId, notificationData, filterResult.reason);
        return;
      }

      // Apply modifications from filter
      if (filterResult.modifiedContent) {
        notificationData.title = filterResult.modifiedContent.title || notificationData.title;
        notificationData.message = filterResult.modifiedContent.message || notificationData.message;
      }

      if (filterResult.priority) {
        notificationData.priority = filterResult.priority;
      }

      // Add metadata
      notificationData.metadata = {
        ...notificationData.metadata,
        templateType,
        source: 'websocket',
        tags: filterResult.tags,
        scheduledFor: filterResult.scheduledFor
      };

      // Send notification
      await this.sendNotification(notificationData, {
        scheduledFor: filterResult.scheduledFor
      });

    } catch (error) {
      logger.error(`Error generating/sending notification for user ${userId}:`, error);
      throw error;
    }
  }

  private determineTemplateType(event: ProcessingEvent): string {
    switch (event.type) {
      case 'TRANSACTION': {
        const amount = (event.data as any)?.transaction?.amount || 0;
        if (amount > 10000) return 'transaction_large';
        if (amount > 1000) return 'transaction_medium';
        return 'transaction_small';
      }

      case 'POSITION_UPDATE': {
        const position = (event.data as any)?.position || {};
        if (position.previousSize === 0) return 'position_opened';
        if (position.size > (position.previousSize || 0)) return 'position_increased';
        if (position.size < (position.previousSize || 0)) return 'position_decreased';
        if (position.size === 0) return 'position_closed';
        return 'position_opened';
      }

      case 'RESOLUTION': {
        const resolution = (event.data as any)?.resolution;
        if (resolution === 'YES') return 'market_resolved_yes';
        if (resolution === 'NO') return 'market_resolved_no';
        return 'market_resolved_ambiguous';
      }

      case 'PRICE_UPDATE': {
        const priceChange = Math.abs((event.data as any)?.priceChange || 0);
        if (priceChange > 20) return 'price_spike_up';
        if (priceChange < -20) return 'price_spike_down';
        return 'price_threshold_crossed';
      }

      default:
        return 'system';
    }
  }

  private async getUserPreferences(userId: number): Promise<TelegramUserPreferences | null> {
    try {
      const prefsData = await redisClient.hget(
        `user:${userId}:preferences`,
        'preferences'
      );
      return prefsData ? JSON.parse(prefsData) : null;
    } catch (error) {
      logger.error(`Error getting preferences for user ${userId}:`, error);
      return null;
    }
  }

  private async sendNotification(
    notification: NotificationData,
    options: {
      scheduledFor?: Date;
    } = {}
  ): Promise<string> {
    try {
      if (options.scheduledFor && options.scheduledFor > new Date()) {
        // Schedule for later delivery
        return await this.queueManager.enqueue(notification, {
          delay: options.scheduledFor.getTime() - Date.now(),
          priority: notification.priority,
          retryable: true
        });
      } else {
        // Send immediately through dispatcher
        return await this.dispatcher.enqueue(notification, {
          priority: notification.priority
        });
      }
    } catch (error) {
      logger.error('Error sending notification:', error);
      throw error;
    }
  }

  private async recordNotificationDelivered(notification: any): Promise<void> {
    try {
      await this.historyAnalytics.recordNotification(
        notification,
        'sent',
        {
          deliveredAt: new Date(),
          processingTime: notification.metadata?.processingTime,
          deliveryTime: notification.metadata?.deliveryTime
        }
      );

      await this.monitoringAnalytics.recordNotificationProcessed(
        notification,
        notification.metadata?.processingTime || 0,
        true
      );

      this.emit('notification:delivered', notification);

    } catch (error) {
      logger.error('Error recording delivered notification:', error);
    }
  }

  private async recordNotificationFailed(
    notification: NotificationData,
    error: Error
  ): Promise<void> {
    try {
      await this.historyAnalytics.recordNotification(
        notification,
        'failed',
        {
          errorDetails: {
            code: error.name,
            message: error.message,
            stack: error.stack,
            timestamp: new Date()
          }
        }
      );

      await this.monitoringAnalytics.recordNotificationProcessed(
        notification,
        notification.metadata?.processingTime || 0,
        false
      );

      this.emit('notification:failed', { notification, error });

    } catch (recordError) {
      logger.error('Error recording failed notification:', recordError);
    }
  }

  private async recordNotificationProcessed(item: any): Promise<void> {
    try {
      await this.historyAnalytics.recordNotification(
        item.payload,
        'sent',
        {
          deliveredAt: new Date(),
          processingTime: item.metadata?.processingTime,
          deliveryTime: item.metadata?.deliveryTime
        }
      );

      await this.monitoringAnalytics.recordNotificationProcessed(
        item.payload,
        item.metadata?.processingTime || 0,
        true
      );

    } catch (error) {
      logger.error('Error recording processed notification:', error);
    }
  }

  private async recordNotificationFiltered(
    userId: number,
    notification: NotificationData,
    reason: string
  ): Promise<void> {
    try {
      await this.historyAnalytics.recordNotification(
        notification,
        'filtered',
        {
          errorDetails: {
            code: 'FILTERED',
            message: reason,
            timestamp: new Date()
          }
        }
      );

      this.emit('notification:filtered', { userId, notification, reason });

    } catch (error) {
      logger.error('Error recording filtered notification:', error);
    }
  }

  private async warmupCaches(): Promise<void> {
    try {
      logger.info('Warming up notification service caches...');

      // Preload common user preferences
      const activeUsers = await redisClient.smembers('active_users');
      const preferencePromises = activeUsers.map(userId =>
        this.getUserPreferences(parseInt(userId))
      );

      await Promise.allSettled(preferencePromises);

      logger.info(`Warmed up caches for ${activeUsers.length} users`);

    } catch (error) {
      logger.error('Error warming up caches:', error);
    }
  }

  private async saveServiceState(): Promise<void> {
    try {
      const serviceState = {
        startTime: this.startTime.toISOString(),
        lastShutdown: new Date().toISOString(),
        config: this.config,
        uptime: Date.now() - this.startTime.getTime()
      };

      await redisClient.hset(
        'notification:service:state',
        'current',
        JSON.stringify(serviceState)
      );

      logger.info('Service state saved');

    } catch (error) {
      logger.error('Error saving service state:', error);
    }
  }

  // Public API methods
  async getServiceStatus(): Promise<ServiceStatus> {
    try {
      const uptime = Date.now() - this.startTime.getTime();
      const memUsage = process.memoryUsage();
      const totalMem = require('os').totalmem();

      // Get WebSocket status
      const websocketStats = this.wsClient.getStats();

      // Get queue status
      const queueStatus = await this.queueManager.getQueueStatus();

      // Get notification metrics
      const dispatcherMetrics = this.dispatcher.getMetrics();

      // Get monitoring health
      const healthStatus = await this.monitoringAnalytics.getHealthStatus();

      return {
        websocket: {
          connected: this.wsClient.isConnected(),
          subscriptions: websocketStats.subscribedChannels?.length || 0,
          messagesReceived: websocketStats.messagesReceived || 0,
          lastMessage: websocketStats.lastMessageAt || new Date()
        },
        notification: {
          queued: queueStatus.size,
          processing: queueStatus.processing,
          delivered: dispatcherMetrics.totalDispatched,
          failed: dispatcherMetrics.totalFailed,
          averageDeliveryTime: dispatcherMetrics.averageDispatchTime
        },
        system: {
          uptime,
          memoryUsage: (memUsage.heapUsed / totalMem) * 100,
          cpuUsage: 0, // Would get from system monitoring
          health: healthStatus.status
        }
      };

    } catch (error) {
      logger.error('Error getting service status:', error);
      throw error;
    }
  }

  async sendManualNotification(
    userId: number,
    notification: Omit<NotificationData, 'userId'>
  ): Promise<string> {
    const fullNotification: NotificationData = {
      ...notification,
      userId,
      metadata: {
        ...notification.metadata,
        source: 'manual',
        timestamp: Date.now()
      }
    };

    return await this.sendNotification(fullNotification);
  }

  async sendBroadcastNotification(
    notification: Omit<NotificationData, 'userId'>,
    userFilter?: (userId: number) => boolean
  ): Promise<string[]> {
    try {
      // Get active users
      const activeUsers = await redisClient.smembers('active_users');
      const userIds = activeUsers
        .map(id => parseInt(id))
        .filter(id => !isNaN(id) && (!userFilter || userFilter(id)));

      // Send to all users
      const sendPromises = userIds.map(userId =>
        this.sendManualNotification(userId, notification)
      );

      const results = await Promise.allSettled(sendPromises);
      const successful = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>[];

      return successful.map(r => r.value);

    } catch (error) {
      logger.error('Error sending broadcast notification:', error);
      throw error;
    }
  }

  async updateUserPreferences(
    userId: number,
    preferences: Partial<TelegramUserPreferences>
  ): Promise<boolean> {
    try {
      return await this.preferenceFilter.updateUserPreferences(userId, preferences);
    } catch (error) {
      logger.error(`Error updating preferences for user ${userId}:`, error);
      return false;
    }
  }

  async getUserNotificationHistory(
    userId: number,
    options: {
      limit?: number;
      offset?: number;
      type?: NotificationData['type'];
      dateRange?: { start: Date; end: Date };
    } = {}
  ): Promise<any> {
    return await this.historyAnalytics.getNotificationHistory({
      userId,
      type: options.type,
      dateRange: options.dateRange,
      limit: options.limit,
      offset: options.offset
    });
  }

  async getSystemAnalytics(
    timeRange?: { start: Date; end: Date }
  ): Promise<any> {
    return await this.historyAnalytics.getNotificationAnalytics(timeRange);
  }

  async getMonitoringDashboard(): Promise<any> {
    return await this.monitoringAnalytics.getSystemOverview();
  }

  updateConfig(newConfig: Partial<TelegramNotificationServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Update child services
    this.dispatcher.updateConfig({
      enableRateLimiting: this.config.enableRateLimiting,
      rateLimits: this.config.rateLimits
    });

    this.monitoringAnalytics.updateConfig({
      alertThresholds: {
        deliveryRate: this.config.targetSuccessRate,
        errorRate: 100 - this.config.targetSuccessRate,
        queueDepth: this.config.maxQueueDepth * 0.8,
        processingLatency: this.config.targetDeliveryTime
      }
    });

    logger.info('Telegram notification service config updated');
  }
}

export default TelegramNotificationService;