import { EventEmitter } from 'events';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';
import { NotificationData, TelegramUserPreferences, WalletTracking } from '@/types/telegram';
import { PolymarketEvent, ProcessingEvent } from '@/types/data-processing';

export interface PreferenceFilterConfig {
  // Redis keys
  userPreferencesKey: string;
  userWalletsKey: string;
  globalDefaultsKey: string;
  filterCacheKey: string;

  // Cache settings
  cacheTimeout: number; // seconds
  maxCacheSize: number;

  // Filter settings
  enableSmartFiltering: boolean;
  enableAdaptiveThreshols: boolean;
  enableQuietHours: boolean;
  enableDeduplication: boolean;
  deduplicationWindow: number; // seconds

  // Adaptive thresholds
  adaptiveThresholdPeriod: number; // days
  minDataPointsForAdaptation: number;
  thresholdSensitivity: number; // 0-1

  // Performance settings
  enableMetrics: boolean;
  metricsRetentionDays: number;
}

export interface FilterContext {
  userId: number;
  notification: NotificationData;
  event?: PolymarketEvent | ProcessingEvent;
  userPreferences?: TelegramUserPreferences;
  userWallets?: WalletTracking[];
  currentTime?: Date;
  userTimezone?: string;
  deliveryHistory?: NotificationData[];
}

export interface FilterResult {
  shouldDeliver: boolean;
  reason?: string;
  priority?: NotificationData['priority'];
  scheduledFor?: Date;
  modifiedContent?: {
    title?: string;
    message?: string;
  };
  tags?: string[];
  metadata?: any;
}

export interface UserFilterStats {
  userId: number;
  totalNotifications: number;
  deliveredNotifications: number;
  filteredNotifications: number;
  filterReasons: Record<string, number>;
  averageDeliveryDelay: number;
  engagementRate: number;
  lastUpdated: Date;
}

export interface PreferenceAnalytics {
  // User preference statistics
  preferenceDistribution: Record<string, number>;
  preferenceEffectiveness: Record<string, {
    deliveryRate: number;
    engagementRate: number;
    userSatisfaction: number;
  }>;

  // Filter performance
  filterPerformance: {
    totalProcessed: number;
    filteredOut: number;
    deliveryImproved: number;
    spamPrevented: number;
    averageProcessingTime: number;
  };

  // Adaptive thresholds
  adaptiveThresholds: Record<string, {
    currentThreshold: number;
    originalThreshold: number;
    adaptationCount: number;
    lastAdaptation: Date;
    effectiveness: number;
  }>;

  // User segments
  userSegments: Array<{
    segmentId: string;
    size: number;
    characteristics: string[];
    preferences: Partial<TelegramUserPreferences>;
    behavior: {
      averageDailyNotifications: number;
      preferredTypes: string[];
      peakHours: number[];
      engagementRate: number;
    };
  }>;
}

export class UserPreferenceFilter extends EventEmitter {
  private config: PreferenceFilterConfig;

  // Cache for user preferences
  private preferenceCache: Map<number, {
    preferences: TelegramUserPreferences;
    wallets: WalletTracking[];
    lastUpdated: Date;
  }> = new Map();

  // Deduplication cache
  private deduplicationCache: Map<string, Date> = new Map();

  // Filter statistics
  private filterStats: Map<number, UserFilterStats> = new Map();

  // Adaptive thresholds
  private adaptiveThresholds: Map<string, {
    currentThreshold: number;
    dataPoints: number[];
    lastAdaptation: Date;
  }> = new Map();

  constructor(config: Partial<PreferenceFilterConfig> = {}) {
    super();

    this.config = {
      userPreferencesKey: 'user:preferences',
      userWalletsKey: 'user:wallets',
      globalDefaultsKey: 'preferences:defaults',
      filterCacheKey: 'filter:cache',

      cacheTimeout: 300, // 5 minutes
      maxCacheSize: 10000,

      enableSmartFiltering: true,
      enableAdaptiveThreshols: true,
      enableQuietHours: true,
      enableDeduplication: true,
      deduplicationWindow: 300, // 5 minutes

      adaptiveThresholdPeriod: 7, // 7 days
      minDataPointsForAdaptation: 50,
      thresholdSensitivity: 0.5,

      enableMetrics: true,
      metricsRetentionDays: 30,

      ...config
    };

    this.initializeGlobalDefaults();
    this.startPeriodicTasks();
  }

  private async initializeGlobalDefaults(): Promise<void> {
    try {
      const defaults = await redisClient.hgetall(this.config.globalDefaultsKey);

      if (Object.keys(defaults).length === 0) {
        // Set default preferences
        const defaultPreferences: Partial<TelegramUserPreferences> = {
          notifications: {
            enabled: true,
            types: {
              positionUpdates: true,
              transactions: true,
              resolutions: true,
              priceAlerts: true,
              largePositions: true
            },
            thresholds: {
              minPositionSize: 1000,
              minTransactionAmount: 100,
              priceChangeThreshold: 5
            },
            quietHours: {
              enabled: false,
              start: '22:00',
              end: '08:00',
              timezone: 'UTC'
            }
          },
          language: 'en',
          timezone: 'UTC'
        };

        await redisClient.hset(
          this.config.globalDefaultsKey,
          'preferences',
          JSON.stringify(defaultPreferences)
        );

        logger.info('Global default preferences initialized');
      }

    } catch (error) {
      logger.error('Error initializing global defaults:', error);
    }
  }

  private startPeriodicTasks(): void {
    // Cleanup cache every 5 minutes
    setInterval(() => {
      this.cleanupCache();
    }, 5 * 60 * 1000);

    // Cleanup deduplication cache every 15 minutes
    setInterval(() => {
      this.cleanupDeduplicationCache();
    }, 15 * 60 * 1000);

    // Update adaptive thresholds every hour
    if (this.config.enableAdaptiveThreshols) {
      setInterval(() => {
        this.updateAdaptiveThresholds().catch(error => {
          logger.error('Error updating adaptive thresholds:', error);
        });
      }, 60 * 60 * 1000);
    }

    // Save statistics every 10 minutes
    if (this.config.enableMetrics) {
      setInterval(() => {
        this.saveStatistics().catch(error => {
          logger.error('Error saving statistics:', error);
        });
      }, 10 * 60 * 1000);
    }
  }

  async shouldDeliverNotification(
    userId: number,
    notification: NotificationData,
    event?: PolymarketEvent | ProcessingEvent
  ): Promise<FilterResult> {
    const startTime = Date.now();

    try {
      // Get filter context
      const context = await this.buildFilterContext(userId, notification, event);
      if (!context) {
        return {
          shouldDeliver: false,
          reason: 'User preferences not found or user disabled notifications'
        };
      }

      // Apply filters in sequence
      const filters = [
        this.checkEnabledNotifications,
        this.checkNotificationType,
        this.checkQuietHours,
        this.checkThresholds,
        this.checkDeduplication,
        this.checkFrequencyLimit,
        this.checkContentRelevance,
        this.checkPersonalizationRules
      ];

      for (const filter of filters) {
        const result = await filter.call(this, context);
        if (!result.shouldDeliver) {
          this.recordFilteredNotification(userId, result.reason || 'Unknown');
          return result;
        }

        // Apply modifications if any
        if (result.modifiedContent || result.priority) {
          notification = {
            ...notification,
            title: result.modifiedContent?.title || notification.title,
            message: result.modifiedContent?.message || notification.message,
            priority: result.priority || notification.priority
          };
        }
      }

      // Successful filtering
      this.recordDeliveredNotification(userId, Date.now() - startTime);

      const finalResult: FilterResult = {
        shouldDeliver: true,
        scheduledFor: result.scheduledFor,
        modifiedContent: result.modifiedContent,
        priority: result.priority,
        tags: result.tags,
        metadata: result.metadata
      };

      this.emit('notification:approved', { userId, notification, result: finalResult });
      return finalResult;

    } catch (error) {
      logger.error(`Error filtering notification for user ${userId}:`, error);
      this.recordFilteredNotification(userId, 'Filtering error');

      return {
        shouldDeliver: false,
        reason: 'Filtering system error'
      };
    }
  }

  private async buildFilterContext(
    userId: number,
    notification: NotificationData,
    event?: PolymarketEvent | ProcessingEvent
  ): Promise<FilterContext | null> {
    // Check cache first
    const cached = this.preferenceCache.get(userId);
    const now = new Date();

    if (cached && (now.getTime() - cached.lastUpdated.getTime()) < this.config.cacheTimeout * 1000) {
      return {
        userId,
        notification,
        event,
        userPreferences: cached.preferences,
        userWallets: cached.wallets,
        currentTime: now,
        userTimezone: cached.preferences?.timezone || 'UTC'
      };
    }

    try {
      // Load user preferences
      const [preferences, wallets] = await Promise.all([
        this.getUserPreferences(userId),
        this.getUserWallets(userId)
      ]);

      if (!preferences || !preferences.notifications?.enabled) {
        return null;
      }

      // Update cache
      this.preferenceCache.set(userId, {
        preferences,
        wallets: wallets || [],
        lastUpdated: now
      });

      return {
        userId,
        notification,
        event,
        userPreferences: preferences,
        userWallets: wallets || [],
        currentTime: now,
        userTimezone: preferences.timezone || 'UTC'
      };

    } catch (error) {
      logger.error(`Error building filter context for user ${userId}:`, error);
      return null;
    }
  }

  private async getUserPreferences(userId: number): Promise<TelegramUserPreferences | null> {
    try {
      const prefsData = await redisClient.hget(
        `${this.config.userPreferencesKey}:${userId}`,
        'preferences'
      );

      if (!prefsData) {
        // Use global defaults
        const defaultsData = await redisClient.hget(
          this.config.globalDefaultsKey,
          'preferences'
        );
        return defaultsData ? JSON.parse(defaultsData) : null;
      }

      return JSON.parse(prefsData);

    } catch (error) {
      logger.error(`Error getting preferences for user ${userId}:`, error);
      return null;
    }
  }

  private async getUserWallets(userId: number): Promise<WalletTracking[] | null> {
    try {
      const walletsData = await redisClient.get(
        `${this.config.userWalletsKey}:${userId}`
      );
      return walletsData ? JSON.parse(walletsData) : null;

    } catch (error) {
      logger.error(`Error getting wallets for user ${userId}:`, error);
      return null;
    }
  }

  private async checkEnabledNotifications(context: FilterContext): Promise<FilterResult> {
    if (!context.userPreferences?.notifications?.enabled) {
      return {
        shouldDeliver: false,
        reason: 'Notifications disabled by user'
      };
    }

    return { shouldDeliver: true };
  }

  private async checkNotificationType(context: FilterContext): Promise<FilterResult> {
    const { notification, userPreferences } = context;
    const typePreferences = userPreferences?.notifications?.types;

    if (!typePreferences) {
      return { shouldDeliver: true };
    }

    let enabled = false;
    switch (notification.type) {
      case 'transaction':
        enabled = typePreferences.transactions;
        break;
      case 'position':
        enabled = typePreferences.positionUpdates;
        break;
      case 'resolution':
        enabled = typePreferences.resolutions;
        break;
      case 'price_alert':
        enabled = typePreferences.priceAlerts;
        break;
      case 'system':
        enabled = true; // System notifications are always enabled
        break;
      default:
        enabled = typePreferences.priceAlerts || true;
    }

    return {
      shouldDeliver: enabled,
      reason: enabled ? undefined : `Notification type ${notification.type} disabled by user`
    };
  }

  private async checkQuietHours(context: FilterContext): Promise<FilterResult> {
    if (!this.config.enableQuietHours || !context.userPreferences?.notifications?.quietHours?.enabled) {
      return { shouldDeliver: true };
    }

    const quietHours = context.userPreferences.notifications.quietHours;
    const isInQuietHours = this.isInQuietHours(context.currentTime!, quietHours);

    if (isInQuietHours) {
      // Only allow urgent notifications during quiet hours
      if (notification.priority === 'urgent') {
        return {
          shouldDeliver: true,
          tags: ['quiet_hours_override']
        };
      }

      return {
        shouldDeliver: false,
        reason: 'Notification outside quiet hours',
        scheduledFor: this.calculateNextActiveTime(context.currentTime!, quietHours)
      };
    }

    return { shouldDeliver: true };
  }

  private isInQuietHours(currentTime: Date, quietHours: any): boolean {
    try {
      const userTime = this.convertToUserTimezone(currentTime, quietHours.timezone);
      const currentMinutes = userTime.getHours() * 60 + userTime.getMinutes();

      const [startHour, startMin] = quietHours.start.split(':').map(Number);
      const [endHour, endMin] = quietHours.end.split(':').map(Number);
      const startTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;

      if (startTime <= endTime) {
        return currentMinutes >= startTime && currentMinutes <= endTime;
      } else {
        // Overnight quiet hours
        return currentMinutes >= startTime || currentMinutes <= endTime;
      }

    } catch (error) {
      logger.error('Error checking quiet hours:', error);
      return false;
    }
  }

  private convertToUserTimezone(date: Date, timezone: string): Date {
    try {
      // Simple timezone conversion (would use a proper library in production)
      return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    } catch (error) {
      logger.warn(`Invalid timezone: ${timezone}, using UTC`);
      return new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    }
  }

  private calculateNextActiveTime(currentTime: Date, quietHours: any): Date {
    try {
      const userTime = this.convertToUserTimezone(currentTime, quietHours.timezone);
      const currentMinutes = userTime.getHours() * 60 + userTime.getMinutes();

      const [endHour, endMin] = quietHours.end.split(':').map(Number);
      const endTime = endHour * 60 + endMin;

      let nextActiveMinutes = endTime;

      // If we're past the end time, schedule for tomorrow
      if (currentMinutes >= endTime) {
        nextActiveMinutes += 24 * 60;
      }

      const nextActiveTime = new Date(currentTime);
      nextActiveTime.setHours(Math.floor(nextActiveMinutes / 60), nextActiveMinutes % 60, 0, 0);

      return nextActiveTime;

    } catch (error) {
      logger.error('Error calculating next active time:', error);
      return new Date(currentTime.getTime() + 8 * 60 * 60 * 1000); // 8 hours from now
    }
  }

  private async checkThresholds(context: FilterContext): Promise<FilterResult> {
    const { notification, event, userPreferences } = context;
    const thresholds = userPreferences?.notifications?.thresholds;

    if (!thresholds || !event) {
      return { shouldDeliver: true };
    }

    const data = event.data || {};
    let shouldDeliver = true;
    let reason: string | undefined;

    switch (notification.type) {
      case 'transaction': {
        const amount = (data as any).amount || 0;
        if (amount < thresholds.minTransactionAmount) {
          shouldDeliver = false;
          reason = `Transaction amount $${amount} below threshold $${thresholds.minTransactionAmount}`;
        }
        break;
      }

      case 'position': {
        const position = (data as any).position || {};
        const size = position.size || 0;
        if (size < thresholds.minPositionSize) {
          shouldDeliver = false;
          reason = `Position size ${size} below threshold ${thresholds.minPositionSize}`;
        }
        break;
      }

      case 'price_alert': {
        const priceChange = (data as any).priceChange || 0;
        if (Math.abs(priceChange) < thresholds.priceChangeThreshold) {
          shouldDeliver = false;
          reason = `Price change ${priceChange}% below threshold ${thresholds.priceChangeThreshold}%`;
        }
        break;
      }
    }

    return {
      shouldDeliver,
      reason
    };
  }

  private async checkDeduplication(context: FilterContext): Promise<FilterResult> {
    if (!this.config.enableDeduplication) {
      return { shouldDeliver: true };
    }

    const { notification, userId } = context;
    const dedupKey = this.generateDeduplicationKey(userId, notification);
    const lastSent = this.deduplicationCache.get(dedupKey);

    if (lastSent) {
      const timeSinceLastSent = Date.now() - lastSent.getTime();
      if (timeSinceLastSent < this.config.deduplicationWindow * 1000) {
        return {
          shouldDeliver: false,
          reason: 'Duplicate notification filtered',
          tags: ['deduplicated']
        };
      }
    }

    // Update deduplication cache
    this.deduplicationCache.set(dedupKey, new Date());

    return { shouldDeliver: true };
  }

  private generateDeduplicationKey(userId: number, notification: NotificationData): string {
    const keyParts = [
      userId.toString(),
      notification.type,
      notification.metadata?.conditionId || '',
      notification.metadata?.walletId || '',
      notification.metadata?.transactionHash || ''
    ];

    return keyParts.filter(part => part.length > 0).join(':');
  }

  private async checkFrequencyLimit(context: FilterContext): Promise<FilterResult> {
    // This would implement rate limiting per user based on their preferences
    // For now, always allow delivery
    return { shouldDeliver: true };
  }

  private async checkContentRelevance(context: FilterContext): Promise<FilterResult> {
    if (!this.config.enableSmartFiltering) {
      return { shouldDeliver: true };
    }

    const { notification, userWallets } = context;

    // Check if notification is relevant to user's tracked wallets
    if (notification.metadata?.walletId && userWallets) {
      const isTracked = userWallets.some(wallet =>
        wallet.address === notification.metadata!.walletId
      );

      if (!isTracked) {
        return {
          shouldDeliver: false,
          reason: 'Notification not relevant to tracked wallets'
        };
      }
    }

    return { shouldDeliver: true };
  }

  private async checkPersonalizationRules(context: FilterContext): Promise<FilterResult> {
    const { notification, userPreferences } = context;

    let modifiedContent;
    let priority = notification.priority;

    // Personalize based on user preferences
    if (userPreferences?.language !== 'en') {
      // Would translate content based on user language
      modifiedContent = {
        ...modifiedContent,
        title: this.translateContent(notification.title, userPreferences?.language || 'en'),
        message: this.translateContent(notification.message, userPreferences?.language || 'en')
      };
    }

    // Adjust priority based on user behavior (adaptive threshold)
    if (this.config.enableAdaptiveThreshols) {
      const adaptivePriority = await this.getAdaptivePriority(
        context.userId,
        notification.type,
        priority
      );
      priority = adaptivePriority;
    }

    return {
      shouldDeliver: true,
      modifiedContent,
      priority,
      tags: ['personalized']
    };
  }

  private translateContent(content: string, language: string): string {
    // Simplified translation - would use proper translation service
    const translations: Record<string, string> = {
      'es': content, // Add actual translations
      'fr': content,
      'de': content,
      'zh': content
    };

    return translations[language] || content;
  }

  private async getAdaptivePriority(
    userId: number,
    notificationType: string,
    originalPriority: NotificationData['priority']
  ): Promise<NotificationData['priority']> {
    const thresholdKey = `${userId}:${notificationType}`;
    const adaptiveData = this.adaptiveThresholds.get(thresholdKey);

    if (!adaptiveData) {
      // Initialize adaptive data
      this.adaptiveThresholds.set(thresholdKey, {
        currentThreshold: this.getPriorityValue(originalPriority),
        dataPoints: [],
        lastAdaptation: new Date()
      });
      return originalPriority;
    }

    // Would analyze user engagement history to adapt priority
    // For now, return original priority
    return originalPriority;
  }

  private getPriorityValue(priority: NotificationData['priority']): number {
    const values = { urgent: 4, high: 3, medium: 2, low: 1 };
    return values[priority] || 2;
  }

  private recordDeliveredNotification(userId: number, processingTime: number): void {
    let stats = this.filterStats.get(userId);

    if (!stats) {
      stats = {
        userId,
        totalNotifications: 0,
        deliveredNotifications: 0,
        filteredNotifications: 0,
        filterReasons: {},
        averageDeliveryDelay: 0,
        engagementRate: 0,
        lastUpdated: new Date()
      };
      this.filterStats.set(userId, stats);
    }

    stats.totalNotifications++;
    stats.deliveredNotifications++;
    stats.averageDeliveryDelay = (
      (stats.averageDeliveryDelay * (stats.deliveredNotifications - 1) + processingTime) /
      stats.deliveredNotifications
    );
    stats.lastUpdated = new Date();

    this.emit('statistics:updated', stats);
  }

  private recordFilteredNotification(userId: number, reason: string): void {
    let stats = this.filterStats.get(userId);

    if (!stats) {
      stats = {
        userId,
        totalNotifications: 0,
        deliveredNotifications: 0,
        filteredNotifications: 0,
        filterReasons: {},
        averageDeliveryDelay: 0,
        engagementRate: 0,
        lastUpdated: new Date()
      };
      this.filterStats.set(userId, stats);
    }

    stats.totalNotifications++;
    stats.filteredNotifications++;
    stats.filterReasons[reason] = (stats.filterReasons[reason] || 0) + 1;
    stats.lastUpdated = new Date();

    this.emit('statistics:updated', stats);
  }

  private cleanupCache(): void {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - this.config.cacheTimeout * 1000);

    for (const [userId, cacheEntry] of this.preferenceCache.entries()) {
      if (cacheEntry.lastUpdated < cutoffTime) {
        this.preferenceCache.delete(userId);
      }
    }

    // Limit cache size
    if (this.preferenceCache.size > this.config.maxCacheSize) {
      const entries = Array.from(this.preferenceCache.entries())
        .sort((a, b) => a[1].lastUpdated.getTime() - b[1].lastUpdated.getTime());

      const toRemove = entries.slice(0, entries.length - this.config.maxCacheSize);
      toRemove.forEach(([userId]) => this.preferenceCache.delete(userId));
    }
  }

  private cleanupDeduplicationCache(): void {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - this.config.deduplicationWindow * 1000);

    for (const [key, timestamp] of this.deduplicationCache.entries()) {
      if (timestamp < cutoffTime) {
        this.deduplicationCache.delete(key);
      }
    }
  }

  private async updateAdaptiveThresholds(): Promise<void> {
    if (!this.config.enableAdaptiveThreshols) {
      return;
    }

    // This would analyze historical data to adjust thresholds
    // Implementation depends on specific adaptation algorithm
    logger.debug('Updating adaptive thresholds');
  }

  private async saveStatistics(): Promise<void> {
    if (!this.config.enableMetrics) {
      return;
    }

    try {
      const pipeline = redisClient.pipeline();

      for (const [userId, stats] of this.filterStats.entries()) {
        const statsKey = `${this.config.filterCacheKey}:stats:${userId}`;
        pipeline.hset(statsKey, {
          totalNotifications: stats.totalNotifications.toString(),
          deliveredNotifications: stats.deliveredNotifications.toString(),
          filteredNotifications: stats.filteredNotifications.toString(),
          averageDeliveryDelay: stats.averageDeliveryDelay.toString(),
          filterReasons: JSON.stringify(stats.filterReasons),
          lastUpdated: stats.lastUpdated.toISOString()
        });
        pipeline.expire(statsKey, this.config.metricsRetentionDays * 24 * 60 * 60);
      }

      await pipeline.exec();
      logger.debug(`Saved statistics for ${this.filterStats.size} users`);

    } catch (error) {
      logger.error('Error saving statistics:', error);
    }
  }

  // Public API methods
  async updateUserPreferences(
    userId: number,
    preferences: Partial<TelegramUserPreferences>
  ): Promise<boolean> {
    try {
      // Merge with existing preferences
      const existing = await this.getUserPreferences(userId) || {};
      const merged = { ...existing, ...preferences };

      // Save to Redis
      await redisClient.hset(
        `${this.config.userPreferencesKey}:${userId}`,
        'preferences',
        JSON.stringify(merged)
      );

      // Invalidate cache
      this.preferenceCache.delete(userId);

      this.emit('preferences:updated', { userId, preferences: merged });
      return true;

    } catch (error) {
      logger.error(`Error updating preferences for user ${userId}:`, error);
      return false;
    }
  }

  async getUserFilterStats(userId: number): Promise<UserFilterStats | null> {
    return this.filterStats.get(userId) || null;
  }

  async getPreferenceAnalytics(timeRange?: { start: Date; end: Date }): Promise<PreferenceAnalytics> {
    const analytics: PreferenceAnalytics = {
      preferenceDistribution: {},
      preferenceEffectiveness: {},
      filterPerformance: {
        totalProcessed: 0,
        filteredOut: 0,
        deliveryImproved: 0,
        spamPrevented: 0,
        averageProcessingTime: 0
      },
      adaptiveThresholds: {},
      userSegments: []
    };

    // Calculate statistics from stored data
    let totalProcessed = 0;
    let totalFiltered = 0;

    for (const stats of this.filterStats.values()) {
      totalProcessed += stats.totalNotifications;
      totalFiltered += stats.filteredNotifications;
      analytics.filterPerformance.averageProcessingTime += stats.averageDeliveryDelay;
    }

    analytics.filterPerformance.totalProcessed = totalProcessed;
    analytics.filterPerformance.filteredOut = totalFiltered;
    analytics.filterPerformance.averageProcessingTime =
      this.filterStats.size > 0 ? analytics.filterPerformance.averageProcessingTime / this.filterStats.size : 0;

    // Add adaptive threshold information
    for (const [key, data] of this.adaptiveThresholds.entries()) {
      analytics.adaptiveThresholds[key] = {
        currentThreshold: data.currentThreshold,
        originalThreshold: data.currentThreshold, // Would track original
        adaptationCount: 0,
        lastAdaptation: data.lastAdaptation,
        effectiveness: 0
      };
    }

    return analytics;
  }

  async clearUserCache(userId: number): Promise<void> {
    this.preferenceCache.delete(userId);
    this.filterStats.delete(userId);
  }

  async testFilteringRules(
    userId: number,
    testNotification: NotificationData
  ): Promise<{
    result: FilterResult;
    context: FilterContext;
  }> {
    const context = await this.buildFilterContext(userId, testNotification);
    const result = await this.shouldDeliverNotification(userId, testNotification);

    return {
      result,
      context: context!
    };
  }

  getCacheStatus(): {
    preferencesCache: number;
    deduplicationCache: number;
    filterStats: number;
    adaptiveThresholds: number;
  } {
    return {
      preferencesCache: this.preferenceCache.size,
      deduplicationCache: this.deduplicationCache.size,
      filterStats: this.filterStats.size,
      adaptiveThresholds: this.adaptiveThresholds.size
    };
  }

  async shutdown(): Promise<void> {
    // Save final statistics
    await this.saveStatistics();

    // Clear caches
    this.preferenceCache.clear();
    this.deduplicationCache.clear();
    this.filterStats.clear();
    this.adaptiveThresholds.clear();

    logger.info('User preference filter shut down');
  }
}

export default UserPreferenceFilter;