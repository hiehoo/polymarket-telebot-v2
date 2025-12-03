import { Telegraf } from 'telegraf';
import { redisClient } from '../redis/redis-client';
import { logger } from '../../utils/logger';

export interface NotificationData {
  userId: number;
  type: 'transaction' | 'position' | 'resolution' | 'price_alert' | 'system';
  title: string;
  message: string;
  data?: any;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  metadata?: {
    walletId?: string;
    transactionHash?: string;
    marketId?: string;
    timestamp: number;
  };
}

export interface NotificationPreferences {
  enabled: boolean;
  types: {
    transactions: boolean;
    positions: boolean;
    resolutions: boolean;
    priceAlerts: boolean;
    system: boolean;
  };
  thresholds: {
    minPositionSize: number;
    minTransactionAmount: number;
    priceChangeThreshold: number;
  };
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

export class NotificationService {
  private bot: Telegraf;
  private queueKey = 'notification_queue';
  private processingKey = 'notification_processing';

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  async queueNotification(notification: NotificationData): Promise<void> {
    try {
      const score = Date.now() + this.getPriorityOffset(notification.priority);
      await redisClient.zadd(this.queueKey, score, JSON.stringify(notification));

      logger.info(`Notification queued for user ${notification.userId}: ${notification.type}`);
    } catch (error) {
      logger.error('Failed to queue notification:', error);
    }
  }

  async sendNotification(notificationOrUserId: NotificationData | number, notification?: NotificationData): Promise<void> {
    if (typeof notificationOrUserId === 'number' && notification) {
      // Handle legacy call with userId and notification
      notification.userId = notificationOrUserId;
      await this.queueNotification(notification);
    } else {
      // Handle new call with just notification
      await this.queueNotification(notificationOrUserId as NotificationData);
    }
  }

  async processNotifications(): Promise<void> {
    try {
      const processing = await redisClient.get(this.processingKey);
      if (processing) {
        return;
      }

      await redisClient.setex(this.processingKey, 60, '1');

      const notifications = await redisClient.zrangebyscore(
        this.queueKey,
        0,
        Date.now(),
        'LIMIT',
        0,
        50
      );

      for (const notifStr of notifications) {
        try {
          const notification: NotificationData = JSON.parse(notifStr);
          await this.deliverNotification(notification);
          await redisClient.zrem(this.queueKey, notifStr);
        } catch (error) {
          logger.error('Error processing individual notification:', error);
        }
      }

      await redisClient.del(this.processingKey);
    } catch (error) {
      logger.error('Error processing notifications:', error);
      await redisClient.del(this.processingKey);
    }
  }

  private async deliverNotification(notification: NotificationData): Promise<void> {
    try {
      const preferences = await this.getUserNotificationPreferences(notification.userId);

      if (!this.shouldDeliver(notification, preferences)) {
        return;
      }

      const message = this.formatNotificationMessage(notification);
      const keyboard = this.getNotificationKeyboard(notification);

      await this.bot.telegram.sendMessage(notification.userId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });

      logger.info(`Notification delivered to user ${notification.userId}: ${notification.type}`);
    } catch (error) {
      logger.error(`Failed to deliver notification to user ${notification.userId}:`, error);
    }
  }

  private shouldDeliver(notification: NotificationData, preferences?: NotificationPreferences): boolean {
    if (!preferences?.enabled) {
      return false;
    }

    if (!preferences.types[notification.type]) {
      return false;
    }

    if (preferences.quietHours?.enabled && this.isQuietHours(preferences.quietHours)) {
      return notification.priority === 'urgent';
    }

    return true;
  }

  private isQuietHours(quietHours: NotificationPreferences['quietHours']): boolean {
    // Implementation would check current time against quiet hours
    // This is a simplified version
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

  private getPriorityOffset(priority: NotificationData['priority']): number {
    const offsets = {
      low: 300000,      // 5 minutes
      medium: 60000,    // 1 minute
      high: 10000,      // 10 seconds
      urgent: 0         // immediate
    };
    return offsets[priority] || offsets.medium;
  }

  private formatNotificationMessage(notification: NotificationData): string {
    const icons = {
      transaction: '💰',
      position: '📊',
      resolution: '🎯',
      price_alert: '📈',
      system: '⚙️'
    };

    const icon = icons[notification.type] || '📢';
    let message = `${icon} *${notification.title}*\n\n${notification.message}`;

    if (notification.metadata?.walletId) {
      message += `\n\n📍 Wallet: ${notification.metadata.walletId}`;
    }

    return message;
  }

  private getNotificationKeyboard(notification: NotificationData): any {
    if (!notification.metadata) {
      return undefined;
    }

    const keyboard = [];

    if (notification.metadata.walletId) {
      keyboard.push([{
        text: '📍 View Wallet',
        callback_data: `wallet_view_${notification.metadata.walletId}`
      }]);
    }

    if (notification.metadata.transactionHash) {
      keyboard.push([{
        text: '🔗 View Transaction',
        callback_data: `tx_view_${notification.metadata.transactionHash}`
      }]);
    }

    if (keyboard.length === 0) {
      return undefined;
    }

    return { inline_keyboard: keyboard };
  }

  private async getUserNotificationPreferences(userId: number): Promise<NotificationPreferences | undefined> {
    try {
      const key = `notif_prefs:${userId}`;
      const prefsData = await redisClient.get(key);
      return prefsData ? JSON.parse(prefsData) : undefined;
    } catch (error) {
      logger.error(`Error getting notification preferences for user ${userId}:`, error);
      return undefined;
    }
  }

  async updateUserNotificationPreferences(userId: number, preferences: NotificationPreferences): Promise<boolean> {
    try {
      const key = `notif_prefs:${userId}`;
      await redisClient.setex(key, 7 * 24 * 60 * 60, JSON.stringify(preferences)); // 7 days
      return true;
    } catch (error) {
      logger.error(`Error updating notification preferences for user ${userId}:`, error);
      return false;
    }
  }

  async getQueueSize(): Promise<number> {
    try {
      return await redisClient.zcard(this.queueKey);
    } catch (error) {
      logger.error('Error getting queue size:', error);
      return 0;
    }
  }
}