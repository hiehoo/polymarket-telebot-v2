import { EventEmitter } from 'events';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';
import { NotificationData, NotificationPreferences } from '@/types/telegram';

export interface NotificationHistoryConfig {
  // Storage keys
  historyKey: string;
  analyticsKey: string;
  metricsKey: string;
  aggregatesKey: string;

  // Retention policies
  historyRetentionDays: number;
  analyticsRetentionDays: number;
  rawMetricsRetentionDays: number;

  // Aggregation settings
  aggregationIntervals: {
    minute: number;    // seconds
    hour: number;      // seconds
    day: number;       // seconds
    week: number;      // seconds
    month: number;      // seconds
  };

  // Analytics settings
  enableRealTimeAnalytics: boolean;
  enableDetailedTracking: boolean;
  enableUserAnalytics: boolean;
  enableMarketAnalytics: boolean;
}

export interface NotificationHistoryEntry {
  id: string;
  userId: number;
  type: NotificationData['type'];
  title: string;
  message: string;
  priority: NotificationData['priority'];
  status: 'sent' | 'failed' | 'pending' | 'bounced' | 'delivered';
  createdAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
  metadata: {
    walletId?: string;
    transactionHash?: string;
    marketId?: string;
    conditionId?: string;
    templateType?: string;
    batchId?: string;
    processingTime?: number;
    deliveryTime?: number;
    retryCount?: number;
    source: 'websocket' | 'api' | 'scheduled' | 'manual';
    tags?: string[];
  };
  userPreferences?: Partial<NotificationPreferences>;
  deliveryMethod?: 'telegram' | 'email' | 'push' | 'webhook';
  errorDetails?: {
    code: string;
    message: string;
    stack?: string;
    timestamp: Date;
  };
}

export interface NotificationAnalytics {
  // Time-based analytics
  totalNotifications: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  averageDeliveryTime: number;
  deliveryRate: number;

  // Type-based analytics
  typeDistribution: Record<string, {
    count: number;
    successRate: number;
    averageDeliveryTime: number;
  }>;

  // Priority-based analytics
  priorityDistribution: Record<string, {
    count: number;
    successRate: number;
    averageDeliveryTime: number;
  }>;

  // User engagement
  userEngagement: {
    totalActiveUsers: number;
    averageNotificationsPerUser: number;
    topEngagedUsers: Array<{
      userId: number;
      notificationCount: number;
      engagementRate: number;
    }>;
    readRate: number;
    clickThroughRate: number;
  };

  // Performance metrics
  performanceMetrics: {
    queueLatency: number;
    processingLatency: number;
    deliveryLatency: number;
    throughput: number; // notifications per minute
    errorRate: number;
    retryRate: number;
  };

  // Market-specific analytics
  marketAnalytics: Record<string, {
    notificationCount: number;
    engagementRate: number;
    averageResponseTime: number;
    hotMarkets: boolean;
  }>;

  // Time series data
  timeSeriesData: {
    hourly: Array<{
      timestamp: Date;
      count: number;
      successRate: number;
      averageLatency: number;
    }>;
    daily: Array<{
      date: string;
      count: number;
      successRate: number;
      averageLatency: number;
      uniqueUsers: number;
    }>;
  };
}

export interface NotificationFilters {
  userId?: number;
  type?: NotificationData['type'] | NotificationData['type'][];
  priority?: NotificationData['priority'] | NotificationData['priority'][];
  status?: NotificationHistoryEntry['status'] | NotificationHistoryEntry['status'][];
  dateRange?: {
    start: Date;
    end: Date;
  };
  marketId?: string;
  conditionId?: string;
  source?: NotificationHistoryEntry['metadata']['source'];
  tags?: string[];
  hasError?: boolean;
  readStatus?: 'read' | 'unread' | 'all';
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'deliveredAt' | 'readAt' | 'priority';
  sortOrder?: 'asc' | 'desc';
}

export interface NotificationInsights {
  trends: {
    deliveryTrend: 'improving' | 'declining' | 'stable';
    engagementTrend: 'increasing' | 'decreasing' | 'stable';
    errorTrend: 'improving' | 'worsening' | 'stable';
  };
  recommendations: Array<{
    type: 'performance' | 'engagement' | 'delivery' | 'configuration';
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    actionItems: string[];
  }>;
  anomalies: Array<{
    type: 'spike' | 'drop' | 'pattern' | 'error';
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    affectedMetrics: string[];
    detectedAt: Date;
  }>;
  userSegments: Array<{
    segment: string;
    size: number;
    characteristics: string[];
    averageEngagement: number;
  }>;
}

export class NotificationHistoryAnalytics extends EventEmitter {
  private config: NotificationHistoryConfig;

  // Analytics cache
  private analyticsCache: Map<string, any> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  // Aggregation timers
  private aggregationTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<NotificationHistoryConfig> = {}) {
    super();

    this.config = {
      historyKey: 'notifications:history',
      analyticsKey: 'notifications:analytics',
      metricsKey: 'notifications:metrics',
      aggregatesKey: 'notifications:aggregates',

      historyRetentionDays: 30,
      analyticsRetentionDays: 90,
      rawMetricsRetentionDays: 7,

      aggregationIntervals: {
        minute: 60,
        hour: 3600,
        day: 86400,
        week: 604800,
        month: 2592000
      },

      enableRealTimeAnalytics: true,
      enableDetailedTracking: true,
      enableUserAnalytics: true,
      enableMarketAnalytics: true,

      ...config
    };

    this.startAggregationTasks();
    this.startAnalyticsCollection();
  }

  async recordNotification(
    notification: NotificationData,
    status: NotificationHistoryEntry['status'],
    deliveryDetails?: {
      deliveredAt?: Date;
      readAt?: Date;
      processingTime?: number;
      deliveryTime?: number;
      errorDetails?: NotificationHistoryEntry['errorDetails'];
      userPreferences?: Partial<NotificationPreferences>;
    }
  ): Promise<string> {
    const id = this.generateHistoryId(notification);
    const now = new Date();

    const historyEntry: NotificationHistoryEntry = {
      id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      message: this.truncateMessage(notification.message),
      priority: notification.priority,
      status,
      createdAt: notification.metadata?.timestamp ? new Date(notification.metadata.timestamp) : now,
      deliveredAt: deliveryDetails?.deliveredAt,
      readAt: deliveryDetails?.readAt,
      metadata: {
        walletId: notification.metadata?.walletId,
        transactionHash: notification.metadata?.transactionHash,
        marketId: notification.metadata?.marketId,
        conditionId: notification.metadata?.conditionId,
        templateType: notification.metadata?.templateType,
        batchId: notification.metadata?.batchId,
        processingTime: deliveryDetails?.processingTime,
        deliveryTime: deliveryDetails?.deliveryTime,
        retryCount: notification.metadata?.retryCount,
        source: notification.metadata?.source || 'api',
        tags: notification.metadata?.tags || []
      },
      userPreferences: deliveryDetails?.userPreferences,
      deliveryMethod: 'telegram',
      errorDetails: deliveryDetails?.errorDetails
    };

    try {
      // Store in Redis sorted sets for time-based queries
      await this.storeHistoryEntry(historyEntry);

      // Update real-time analytics
      if (this.config.enableRealTimeAnalytics) {
        await this.updateRealTimeAnalytics(historyEntry);
      }

      // Emit events for listeners
      this.emit('notification:recorded', historyEntry);

      if (status === 'sent' && deliveryDetails?.deliveredAt) {
        this.emit('notification:delivered', historyEntry);
      }

      if (status === 'failed') {
        this.emit('notification:failed', historyEntry);
      }

      if (deliveryDetails?.readAt) {
        this.emit('notification:read', historyEntry);
      }

      logger.debug(`Notification history recorded: ${id} for user ${notification.userId}`);
      return id;

    } catch (error) {
      logger.error(`Error recording notification history: ${id}`, error);
      this.emit('notification:recordingError', { entry: historyEntry, error });
      throw error;
    }
  }

  private async storeHistoryEntry(entry: NotificationHistoryEntry): Promise<void> {
    const pipeline = redisClient.pipeline();

    // Store in user-specific history
    const userHistoryKey = `${this.config.historyKey}:user:${entry.userId}`;
    const score = entry.createdAt.getTime();
    await redisClient.zadd(userHistoryKey, score, JSON.stringify(entry));

    // Store in global history
    await redisClient.zadd(this.config.historyKey, score, JSON.stringify(entry));

    // Store in type-specific history
    const typeHistoryKey = `${this.config.historyKey}:type:${entry.type}`;
    await redisClient.zadd(typeHistoryKey, score, JSON.stringify(entry));

    // Store in priority-specific history
    const priorityHistoryKey = `${this.config.historyKey}:priority:${entry.priority}`;
    await redisClient.zadd(priorityHistoryKey, score, JSON.stringify(entry));

    // Set expiration for retention
    const historyTTL = this.config.historyRetentionDays * 24 * 60 * 60;
    pipeline.expire(userHistoryKey, historyTTL);
    pipeline.expire(this.config.historyKey, historyTTL);
    pipeline.expire(typeHistoryKey, historyTTL);
    pipeline.expire(priorityHistoryKey, historyTTL);

    // Store in detailed tracking if enabled
    if (this.config.enableDetailedTracking) {
      const detailKey = `${this.config.historyKey}:detail:${entry.id}`;
      await redisClient.setex(detailKey, historyTTL, JSON.stringify(entry));
    }

    await pipeline.exec();
  }

  private async updateRealTimeAnalytics(entry: NotificationHistoryEntry): Promise<void> {
    const now = Date.now();
    const minuteKey = `${this.config.metricsKey}:minute:${Math.floor(now / 60000)}`;
    const hourKey = `${this.config.metricsKey}:hour:${Math.floor(now / 3600000)}`;
    const dayKey = `${this.config.metricsKey}:day:${Math.floor(now / 86400000)}`;

    const pipeline = redisClient.pipeline();

    // Update minute-level metrics
    pipeline.hincrby(minuteKey, `total_${entry.type}`, 1);
    pipeline.hincrby(minuteKey, `total_${entry.priority}`, 1);
    if (entry.status === 'sent') {
      pipeline.hincrby(minuteKey, 'successful', 1);
    } else {
      pipeline.hincrby(minuteKey, 'failed', 1);
    }
    if (entry.metadata.processingTime) {
      pipeline.hincrby(minuteKey, 'processing_time_total', entry.metadata.processingTime);
      pipeline.hincrby(minuteKey, 'processing_time_count', 1);
    }
    pipeline.expire(minuteKey, 2 * 3600); // Keep for 2 hours

    // Update hourly aggregates
    pipeline.hincrby(hourKey, `total_${entry.type}`, 1);
    pipeline.hincrby(hourKey, `total_${entry.priority}`, 1);
    if (entry.status === 'sent') {
      pipeline.hincrby(hourKey, 'successful', 1);
    } else {
      pipeline.hincrby(hourKey, 'failed', 1);
    }
    if (entry.metadata.processingTime) {
      pipeline.hincrby(hourKey, 'processing_time_total', entry.metadata.processingTime);
      pipeline.hincrby(hourKey, 'processing_time_count', 1);
    }
    pipeline.expire(hourKey, 48 * 3600); // Keep for 48 hours

    // Update daily aggregates
    pipeline.hincrby(dayKey, `total_${entry.type}`, 1);
    pipeline.hincrby(dayKey, `total_${entry.priority}`, 1);
    if (entry.status === 'sent') {
      pipeline.hincrby(dayKey, 'successful', 1);
    } else {
      pipeline.hincrby(dayKey, 'failed', 1);
    }
    if (entry.metadata.processingTime) {
      pipeline.hincrby(dayKey, 'processing_time_total', entry.metadata.processingTime);
      pipeline.hincrby(dayKey, 'processing_time_count', 1);
    }
    pipeline.expire(dayKey, 30 * 24 * 3600); // Keep for 30 days

    await pipeline.exec();

    // Invalidate cache
    this.analyticsCache.clear();
  }

  async getNotificationHistory(
    filters: NotificationFilters = {}
  ): Promise<{
    notifications: NotificationHistoryEntry[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      let results: NotificationHistoryEntry[] = [];
      let total = 0;
      let hasMore = false;

      // Determine which key to query based on filters
      let queryKey = this.config.historyKey;
      if (filters.userId) {
        queryKey = `${this.config.historyKey}:user:${filters.userId}`;
      } else if (filters.type && !Array.isArray(filters.type)) {
        queryKey = `${this.config.historyKey}:type:${filters.type}`;
      } else if (filters.priority && !Array.isArray(filters.priority)) {
        queryKey = `${this.config.historyKey}:priority:${filters.priority}`;
      }

      // Build query parameters
      const startScore = filters.dateRange?.start?.getTime() || 0;
      const endScore = filters.dateRange?.end?.getTime() || Date.now();

      // Get total count
      total = await redisClient.zcount(queryKey, startScore, endScore);

      // Get paginated results
      const offset = filters.offset || 0;
      const limit = filters.limit || 50;
      const endIndex = offset + limit - 1;

      let entries = await redisClient.zrangebyscore(
        queryKey,
        startScore,
        endScore,
        'LIMIT',
        offset,
        limit
      );

      // Parse entries
      results = entries
        .map(entry => {
          try {
            return JSON.parse(entry) as NotificationHistoryEntry;
          } catch (error) {
            logger.warn('Failed to parse history entry:', error);
            return null;
          }
        })
        .filter(entry => entry !== null) as NotificationHistoryEntry[];

      // Apply additional filters
      if (filters.type && Array.isArray(filters.type)) {
        results = results.filter(entry => filters.type!.includes(entry.type));
      }
      if (filters.priority && Array.isArray(filters.priority)) {
        results = results.filter(entry => filters.priority!.includes(entry.priority));
      }
      if (filters.status) {
        const statusArray = Array.isArray(filters.status) ? filters.status : [filters.status];
        results = results.filter(entry => statusArray.includes(entry.status));
      }
      if (filters.marketId) {
        results = results.filter(entry => entry.metadata.marketId === filters.marketId);
      }
      if (filters.conditionId) {
        results = results.filter(entry => entry.metadata.conditionId === filters.conditionId);
      }
      if (filters.source) {
        results = results.filter(entry => entry.metadata.source === filters.source);
      }
      if (filters.hasError !== undefined) {
        results = results.filter(entry => {
          return filters.hasError ? !!entry.errorDetails : !entry.errorDetails;
        });
      }
      if (filters.readStatus !== 'all') {
        if (filters.readStatus === 'read') {
          results = results.filter(entry => !!entry.readAt);
        } else {
          results = results.filter(entry => !entry.readAt);
        }
      }
      if (filters.tags && filters.tags.length > 0) {
        results = results.filter(entry => {
          if (!entry.metadata.tags) return false;
          return filters.tags!.some(tag => entry.metadata.tags!.includes(tag));
        });
      }

      // Sort results
      if (filters.sortBy) {
        results.sort((a, b) => {
          const aTime = this.getSortValue(a, filters.sortBy!);
          const bTime = this.getSortValue(b, filters.sortBy!);
          const order = filters.sortOrder === 'asc' ? 1 : -1;
          return (aTime - bTime) * order;
        });
      }

      hasMore = offset + results.length < total;

      return {
        notifications: results,
        total,
        hasMore
      };

    } catch (error) {
      logger.error('Error fetching notification history:', error);
      return {
        notifications: [],
        total: 0,
        hasMore: false
      };
    }
  }

  async getNotificationAnalytics(
    timeRange: { start: Date; end: Date } = {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      end: new Date()
    }
  ): Promise<NotificationAnalytics> {
    const cacheKey = `analytics:${timeRange.start.getTime()}-${timeRange.end.getTime()}`;
    const cached = this.analyticsCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const analytics: NotificationAnalytics = {
        totalNotifications: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        averageDeliveryTime: 0,
        deliveryRate: 0,
        typeDistribution: {},
        priorityDistribution: {},
        userEngagement: {
          totalActiveUsers: 0,
          averageNotificationsPerUser: 0,
          topEngagedUsers: [],
          readRate: 0,
          clickThroughRate: 0
        },
        performanceMetrics: {
          queueLatency: 0,
          processingLatency: 0,
          deliveryLatency: 0,
          throughput: 0,
          errorRate: 0,
          retryRate: 0
        },
        marketAnalytics: {},
        timeSeriesData: {
          hourly: [],
          daily: []
        }
      };

      // Get basic metrics
      const notifications = await this.getNotificationHistory({
        dateRange: timeRange,
        limit: 10000 // Get a large sample
      });

      analytics.totalNotifications = notifications.total;

      // Calculate success metrics
      for (const notification of notifications.notifications) {
        if (notification.status === 'sent') {
          analytics.successfulDeliveries++;
        } else if (notification.status === 'failed') {
          analytics.failedDeliveries++;
        }

        // Type distribution
        if (!analytics.typeDistribution[notification.type]) {
          analytics.typeDistribution[notification.type] = {
            count: 0,
            successRate: 0,
            averageDeliveryTime: 0
          };
        }
        analytics.typeDistribution[notification.type].count++;

        // Priority distribution
        if (!analytics.priorityDistribution[notification.priority]) {
          analytics.priorityDistribution[notification.priority] = {
            count: 0,
            successRate: 0,
            averageDeliveryTime: 0
          };
        }
        analytics.priorityDistribution[notification.priority].count++;

        // Performance metrics
        if (notification.metadata.processingTime) {
          analytics.performanceMetrics.processingLatency += notification.metadata.processingTime;
        }
        if (notification.metadata.deliveryTime) {
          analytics.performanceMetrics.deliveryLatency += notification.metadata.deliveryTime;
        }

        // User engagement
        const uniqueUsers = new Set(notifications.notifications.map(n => n.userId));
        analytics.userEngagement.totalActiveUsers = uniqueUsers.size;
        analytics.userEngagement.averageNotificationsPerUser = notifications.total / uniqueUsers.size;

        // Read rate
        if (notification.readAt) {
          analytics.userEngagement.readRate++;
        }

        // Market analytics
        if (notification.metadata.marketId) {
          if (!analytics.marketAnalytics[notification.metadata.marketId]) {
            analytics.marketAnalytics[notification.metadata.marketId] = {
              notificationCount: 0,
              engagementRate: 0,
              averageResponseTime: 0,
              hotMarkets: false
            };
          }
          analytics.marketAnalytics[notification.metadata.marketId].notificationCount++;
        }
      }

      // Calculate derived metrics
      analytics.deliveryRate = analytics.totalNotifications > 0
        ? analytics.successfulDeliveries / analytics.totalNotifications
        : 0;

      analytics.userEngagement.readRate = analytics.totalNotifications > 0
        ? analytics.userEngagement.readRate / analytics.totalNotifications
        : 0;

      const totalProcessing = notifications.notifications.reduce(
        (sum, n) => sum + (n.metadata.processingTime || 0), 0
      );
      analytics.performanceMetrics.processingLatency = notifications.notifications.length > 0
        ? totalProcessing / notifications.notifications.length
        : 0;

      // Get time series data
      analytics.timeSeriesData = await this.getTimeSeriesData(timeRange);

      // Cache result
      this.analyticsCache.set(cacheKey, analytics);
      setTimeout(() => {
        this.analyticsCache.delete(cacheKey);
      }, this.cacheTimeout);

      return analytics;

    } catch (error) {
      logger.error('Error generating notification analytics:', error);
      throw error;
    }
  }

  private async getTimeSeriesData(
    timeRange: { start: Date; end: Date }
  ): Promise<{
    hourly: NotificationAnalytics['timeSeriesData']['hourly'];
    daily: NotificationAnalytics['timeSeriesData']['daily'];
  }> {
    const result = {
      hourly: [] as NotificationAnalytics['timeSeriesData']['hourly'],
      daily: [] as NotificationAnalytics['timeSeriesData']['daily']
    };

    try {
      // Get hourly data
      const startHour = Math.floor(timeRange.start.getTime() / 3600000);
      const endHour = Math.floor(timeRange.end.getTime() / 3600000);

      for (let hour = startHour; hour <= endHour; hour++) {
        const hourKey = `${this.config.metricsKey}:hour:${hour}`;
        const metrics = await redisClient.hgetall(hourKey);

        if (Object.keys(metrics).length > 0) {
          const total = parseInt(metrics.successful || '0') + parseInt(metrics.failed || '0');
          const successRate = total > 0 ? parseInt(metrics.successful || '0') / total : 0;
          const avgProcessingTime = parseInt(metrics.processing_time_count || '0') > 0
            ? parseInt(metrics.processing_time_total || '0') / parseInt(metrics.processing_time_count || '0')
            : 0;

          result.hourly.push({
            timestamp: new Date(hour * 3600000),
            count: total,
            successRate,
            averageLatency: avgProcessingTime
          });
        }
      }

      // Get daily data
      const startDay = Math.floor(timeRange.start.getTime() / 86400000);
      const endDay = Math.floor(timeRange.end.getTime() / 86400000);

      for (let day = startDay; day <= endDay; day++) {
        const dayKey = `${this.config.metricsKey}:day:${day}`;
        const metrics = await redisClient.hgetall(dayKey);

        if (Object.keys(metrics).length > 0) {
          const total = parseInt(metrics.successful || '0') + parseInt(metrics.failed || '0');
          const successRate = total > 0 ? parseInt(metrics.successful || '0') / total : 0;
          const avgProcessingTime = parseInt(metrics.processing_time_count || '0') > 0
            ? parseInt(metrics.processing_time_total || '0') / parseInt(metrics.processing_time_count || '0')
            : 0;

          result.daily.push({
            date: new Date(day * 86400000).toISOString().split('T')[0],
            count: total,
            successRate,
            averageLatency: avgProcessingTime,
            uniqueUsers: parseInt(metrics.unique_users || '0')
          });
        }
      }

    } catch (error) {
      logger.error('Error getting time series data:', error);
    }

    return result;
  }

  async getNotificationInsights(
    timeRange: { start: Date; end: Date } = {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      end: new Date()
    }
  ): Promise<NotificationInsights> {
    try {
      const analytics = await this.getNotificationAnalytics(timeRange);
      const previousAnalytics = await this.getNotificationAnalytics({
        start: new Date(timeRange.start.getTime() - (timeRange.end.getTime() - timeRange.start.getTime())),
        end: timeRange.start
      });

      const insights: NotificationInsights = {
        trends: {
          deliveryTrend: this.calculateTrend(
            previousAnalytics.deliveryRate,
            analytics.deliveryRate
          ),
          engagementTrend: this.calculateTrend(
            previousAnalytics.userEngagement.readRate,
            analytics.userEngagement.readRate
          ),
          errorTrend: this.calculateTrend(
            1 - previousAnalytics.deliveryRate,
            1 - analytics.deliveryRate
          )
        },
        recommendations: [],
        anomalies: [],
        userSegments: []
      };

      // Generate recommendations
      insights.recommendations = this.generateRecommendations(analytics);

      // Detect anomalies
      insights.anomalies = this.detectAnomalies(analytics);

      // Analyze user segments
      insights.userSegments = await this.analyzeUserSegments(timeRange);

      return insights;

    } catch (error) {
      logger.error('Error generating notification insights:', error);
      return {
        trends: {
          deliveryTrend: 'stable',
          engagementTrend: 'stable',
          errorTrend: 'stable'
        },
        recommendations: [],
        anomalies: [],
        userSegments: []
      };
    }
  }

  private calculateTrend(previous: number, current: number): 'improving' | 'declining' | 'stable' {
    const change = current - previous;
    const changePercentage = previous !== 0 ? (change / previous) * 100 : 0;

    if (Math.abs(changePercentage) < 5) {
      return 'stable';
    } else if (changePercentage > 0) {
      return 'improving';
    } else {
      return 'declining';
    }
  }

  private generateRecommendations(analytics: NotificationAnalytics): NotificationInsights['recommendations'] {
    const recommendations: NotificationInsights['recommendations'] = [];

    // Delivery rate recommendations
    if (analytics.deliveryRate < 0.95) {
      recommendations.push({
        type: 'delivery',
        priority: 'high',
        title: 'Low Delivery Rate Detected',
        description: `Current delivery rate is ${(analytics.deliveryRate * 100).toFixed(1)}%, which is below the target of 95%.`,
        actionItems: [
          'Review error logs for common failure patterns',
          'Check rate limiting configuration',
          'Verify Telegram API connectivity',
          'Consider implementing fallback delivery methods'
        ]
      });
    }

    // Performance recommendations
    if (analytics.performanceMetrics.processingLatency > 1000) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        title: 'High Processing Latency',
        description: `Average processing time is ${analytics.performanceMetrics.processingLatency.toFixed(0)}ms, which may impact user experience.`,
        actionItems: [
          'Optimize notification processing pipeline',
          'Consider increasing queue processing capacity',
          'Review database query performance',
          'Implement caching for frequently accessed data'
        ]
      });
    }

    // Engagement recommendations
    if (analytics.userEngagement.readRate < 0.5) {
      recommendations.push({
        type: 'engagement',
        priority: 'medium',
        title: 'Low User Engagement',
        description: `Read rate is ${(analytics.userEngagement.readRate * 100).toFixed(1)}%, indicating low user engagement.`,
        actionItems: [
          'Review notification content relevance',
          'Optimize notification timing',
          'Consider personalization options',
          'Allow users to customize notification preferences'
        ]
      });
    }

    return recommendations;
  }

  private detectAnomalies(analytics: NotificationAnalytics): NotificationInsights['anomalies'] {
    const anomalies: NotificationInsights['anomalies'] = [];

    // Error rate anomaly
    if (analytics.deliveryRate < 0.9) {
      anomalies.push({
        type: 'drop',
        severity: analytics.deliveryRate < 0.8 ? 'critical' : 'high',
        description: `Significant drop in delivery rate detected: ${(analytics.deliveryRate * 100).toFixed(1)}%`,
        affectedMetrics: ['deliveryRate', 'errorRate'],
        detectedAt: new Date()
      });
    }

    // Processing time anomaly
    if (analytics.performanceMetrics.processingLatency > 5000) {
      anomalies.push({
        type: 'spike',
        severity: analytics.performanceMetrics.processingLatency > 10000 ? 'critical' : 'high',
        description: `Unusually high processing latency: ${analytics.performanceMetrics.processingLatency.toFixed(0)}ms`,
        affectedMetrics: ['processingLatency', 'throughput'],
        detectedAt: new Date()
      });
    }

    return anomalies;
  }

  private async analyzeUserSegments(
    timeRange: { start: Date; end: Date }
  ): Promise<NotificationInsights['userSegments']> {
    const segments: NotificationInsights['userSegments'] = [];

    try {
      // Get user notification patterns
      const notifications = await this.getNotificationHistory({
        dateRange: timeRange,
        limit: 10000
      });

      const userStats = new Map<number, {
        count: number;
        types: Set<string>;
        readCount: number;
        lastActivity: Date;
      }>();

      // Aggregate user statistics
      for (const notification of notifications.notifications) {
        if (!userStats.has(notification.userId)) {
          userStats.set(notification.userId, {
            count: 0,
            types: new Set(),
            readCount: 0,
            lastActivity: notification.createdAt
          });
        }

        const stats = userStats.get(notification.userId)!;
        stats.count++;
        stats.types.add(notification.type);
        if (notification.readAt) {
          stats.readCount++;
        }
        if (notification.createdAt > stats.lastActivity) {
          stats.lastActivity = notification.createdAt;
        }
      }

      // Define segments
      const activeUsers = Array.from(userStats.entries())
        .filter(([_, stats]) => stats.count >= 10);

      const highlyEngagedUsers = Array.from(userStats.entries())
        .filter(([_, stats]) => (stats.readCount / stats.count) > 0.8);

      const transactionFocusedUsers = Array.from(userStats.entries())
        .filter(([_, stats]) => stats.types.has('transaction') && stats.types.size <= 2);

      // Create segment objects
      if (activeUsers.length > 0) {
        segments.push({
          segment: 'Active Users',
          size: activeUsers.length,
          characteristics: ['10+ notifications', 'Regular activity', 'Multiple notification types'],
          averageEngagement: activeUsers.reduce((sum, [_, stats]) =>
            sum + (stats.readCount / stats.count), 0) / activeUsers.length
        });
      }

      if (highlyEngagedUsers.length > 0) {
        segments.push({
          segment: 'Highly Engaged',
          size: highlyEngagedUsers.length,
          characteristics: ['80%+ read rate', 'Frequent interaction', 'High responsiveness'],
          averageEngagement: highlyEngagedUsers.reduce((sum, [_, stats]) =>
            sum + (stats.readCount / stats.count), 0) / highlyEngagedUsers.length
        });
      }

      if (transactionFocusedUsers.length > 0) {
        segments.push({
          segment: 'Transaction Focused',
          size: transactionFocusedUsers.length,
          characteristics: ['Primarily transaction notifications', 'Limited notification types', 'Specific interest areas'],
          averageEngagement: transactionFocusedUsers.reduce((sum, [_, stats]) =>
            sum + (stats.readCount / stats.count), 0) / transactionFocusedUsers.length
        });
      }

    } catch (error) {
      logger.error('Error analyzing user segments:', error);
    }

    return segments;
  }

  private getSortValue(entry: NotificationHistoryEntry, sortBy: string): number {
    switch (sortBy) {
      case 'createdAt':
        return entry.createdAt.getTime();
      case 'deliveredAt':
        return entry.deliveredAt?.getTime() || 0;
      case 'readAt':
        return entry.readAt?.getTime() || 0;
      case 'priority':
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        return priorityOrder[entry.priority] || 0;
      default:
        return entry.createdAt.getTime();
    }
  }

  private truncateMessage(message: string, maxLength: number = 1000): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + '...';
  }

  private generateHistoryId(notification: NotificationData): string {
    return `hist_${Date.now()}_${notification.userId}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startAggregationTasks(): void {
    // Schedule aggregations for different intervals
    Object.entries(this.config.aggregationIntervals).forEach(([interval, seconds]) => {
      const timer = setInterval(() => {
        this.performAggregation(interval).catch(error => {
          logger.error(`Error during ${interval} aggregation:`, error);
        });
      }, seconds * 1000);

      this.aggregationTimers.set(interval, timer);
    });
  }

  private async performAggregation(interval: string): Promise<void> {
    try {
      // Implement aggregation logic for the specified interval
      logger.debug(`Performing ${interval} aggregation`);

      // This would aggregate raw metrics into higher-level summaries
      // Implementation depends on specific aggregation requirements

    } catch (error) {
      logger.error(`Error during ${interval} aggregation:`, error);
    }
  }

  private startAnalyticsCollection(): void {
    if (!this.config.enableRealTimeAnalytics) {
      return;
    }

    // Collect real-time analytics every minute
    setInterval(async () => {
      try {
        const now = new Date();
        const analytics = await this.getNotificationAnalytics({
          start: new Date(now.getTime() - 60 * 60 * 1000), // Last hour
          end: now
        });

        this.emit('analytics:updated', analytics);

      } catch (error) {
        logger.error('Error collecting real-time analytics:', error);
      }
    }, 60000); // Every minute
  }

  // Public API methods
  async deleteNotificationHistory(userId: number, beforeDate?: Date): Promise<number> {
    try {
      const userHistoryKey = `${this.config.historyKey}:user:${userId}`;
      const cutoff = beforeDate?.getTime() || 0;

      const removed = await redisClient.zremrangebyscore(userHistoryKey, 0, cutoff);

      // Also remove from global history
      const globalEntries = await redisClient.zrangebyscore(
        this.config.historyKey,
        0,
        cutoff
      );

      const pipeline = redisClient.pipeline();
      for (const entry of globalEntries) {
        try {
          const parsed = JSON.parse(entry) as NotificationHistoryEntry;
          if (parsed.userId === userId) {
            pipeline.zrem(this.config.historyKey, entry);
          }
        } catch (error) {
          // Skip invalid entries
        }
      }

      await pipeline.exec();

      logger.info(`Deleted ${removed} notification history entries for user ${userId}`);
      return removed;

    } catch (error) {
      logger.error(`Error deleting notification history for user ${userId}:`, error);
      return 0;
    }
  }

  async exportNotificationHistory(
    userId: number,
    format: 'json' | 'csv' = 'json',
    filters: NotificationFilters = {}
  ): Promise<string> {
    const history = await this.getNotificationHistory({
      userId,
      ...filters,
      limit: 10000
    });

    if (format === 'json') {
      return JSON.stringify(history.notifications, null, 2);
    } else if (format === 'csv') {
      const headers = [
        'ID', 'User ID', 'Type', 'Title', 'Priority', 'Status',
        'Created At', 'Delivered At', 'Read At', 'Processing Time', 'Delivery Time'
      ];

      const rows = history.notifications.map(entry => [
        entry.id,
        entry.userId,
        entry.type,
        entry.title,
        entry.priority,
        entry.status,
        entry.createdAt.toISOString(),
        entry.deliveredAt?.toISOString() || '',
        entry.readAt?.toISOString() || '',
        entry.metadata.processingTime || '',
        entry.metadata.deliveryTime || ''
      ]);

      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.analyticsCache.size,
      keys: Array.from(this.analyticsCache.keys())
    };
  }

  clearCache(): void {
    this.analyticsCache.clear();
  }

  async shutdown(): Promise<void> {
    // Clear aggregation timers
    for (const timer of this.aggregationTimers.values()) {
      clearInterval(timer);
    }
    this.aggregationTimers.clear();

    // Clear cache
    this.clearCache();

    logger.info('Notification history and analytics service shut down');
  }
}

export default NotificationHistoryAnalytics;