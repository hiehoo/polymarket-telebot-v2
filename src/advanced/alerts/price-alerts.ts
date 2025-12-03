import PolymarketRestClient from '../../services/polymarket/rest-client';
import { NotificationService } from '../../services/notifications/notification-service';
import { NotificationTemplates } from '../../services/notifications/notification-templates';
import { logger } from '../../utils/logger';

export interface PriceAlert {
  id: string;
  userId: number;
  telegramId: number;
  walletAddress?: string;
  marketId: string;
  marketTitle: string;
  alertType: 'above' | 'below' | 'change_percent' | 'volume_spike';
  targetPrice: number;
  currentPrice?: number;
  changePercent?: number;
  volumeThreshold?: number;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  triggeredAt?: Date;
  lastChecked?: Date;
}

export interface PriceAlertConfig {
  userId: number;
  marketId: string;
  alertType: 'above' | 'below' | 'change_percent' | 'volume_spike';
  targetValue: number;
  currency: string;
  walletAddress?: string;
  expiresAt?: Date;
  repeat?: boolean;
}

export class PriceAlerts {
  private logger = logger;
  private alertIntervals = new Map<string, NodeJS.Timeout>();
  private readonly CHECK_INTERVAL = 30000; // 30 seconds

  constructor(
    private polymarketService: PolymarketRestClient,
    private notificationService: NotificationService
  ) {}

  async createAlert(config: PriceAlertConfig): Promise<PriceAlert> {
    try {
      const alertId = this.generateAlertId(config.userId, config.marketId, Date.now());

      const alert: PriceAlert = {
        id: alertId,
        userId: config.userId,
        telegramId: config.userId, // Would get from user service
        walletAddress: config.walletAddress,
        marketId: config.marketId,
        marketTitle: await this.getMarketTitle(config.marketId),
        alertType: config.alertType,
        targetPrice: config.targetValue,
        currency: config.currency,
        isActive: true,
        createdAt: new Date(),
        lastChecked: new Date()
      };

      // Save alert to database
      await this.saveAlert(alert);

      // Start monitoring if not already monitoring this market
      this.startMonitoring(alert);

      this.logger.info('Price alert created', {
        alertId: alert.id,
        userId: alert.userId,
        marketId: alert.marketId,
        alertType: alert.alertType,
        targetValue: alert.targetPrice
      });

      return alert;

    } catch (error) {
      this.logger.error('Error creating price alert', {
        config,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async updateAlert(alertId: string, updates: Partial<PriceAlert>): Promise<PriceAlert> {
    try {
      const existingAlert = await this.getAlert(alertId);
      if (!existingAlert) {
        throw new Error(`Alert ${alertId} not found`);
      }

      const updatedAlert = { ...existingAlert, ...updates, id: alertId };
      await this.saveAlert(updatedAlert);

      // Restart monitoring if alert configuration changed
      if (updates.alertType || updates.targetPrice || updates.isActive === false) {
        this.stopMonitoring(alertId);
        if (updatedAlert.isActive) {
          this.startMonitoring(updatedAlert);
        }
      }

      return updatedAlert;

    } catch (error) {
      this.logger.error('Error updating price alert', {
        alertId,
        updates,
        error
      });
      throw error;
    }
  }

  async deleteAlert(alertId: string): Promise<void> {
    try {
      await this.removeAlert(alertId);
      this.stopMonitoring(alertId);

      this.logger.info('Price alert deleted', { alertId });

    } catch (error) {
      this.logger.error('Error deleting price alert', {
        alertId,
        error
      });
      throw error;
    }
  }

  async getUserAlerts(userId: number, activeOnly: boolean = true): Promise<PriceAlert[]> {
    try {
      const alerts = await this.getAlertsByUser(userId);
      return activeOnly ? alerts.filter(alert => alert.isActive) : alerts;

    } catch (error) {
      this.logger.error('Error getting user alerts', {
        userId,
        activeOnly,
        error
      });
      return [];
    }
  }

  async checkAlert(alertId: string): Promise<boolean> {
    try {
      const alert = await this.getAlert(alertId);
      if (!alert || !alert.isActive) {
        return false;
      }

      const isTriggered = await this.evaluateAlert(alert);

      if (isTriggered) {
        await this.triggerAlert(alert);
        return true;
      }

      // Update last checked timestamp
      alert.lastChecked = new Date();
      await this.saveAlert(alert);

      return false;

    } catch (error) {
      this.logger.error('Error checking alert', {
        alertId,
        error
      });
      return false;
    }
  }

  async checkAllAlerts(): Promise<number> {
    try {
      const activeAlerts = await this.getActiveAlerts();
      let triggeredCount = 0;

      for (const alert of activeAlerts) {
        try {
          if (await this.evaluateAlert(alert)) {
            await this.triggerAlert(alert);
            triggeredCount++;
          }

          alert.lastChecked = new Date();
          await this.saveAlert(alert);

        } catch (error) {
          this.logger.error('Error evaluating individual alert', {
            alertId: alert.id,
            error
          });
        }
      }

      return triggeredCount;

    } catch (error) {
      this.logger.error('Error checking all alerts', { error });
      return 0;
    }
  }

  private startMonitoring(alert: PriceAlert): void {
    if (this.alertIntervals.has(alert.id)) {
      return;
    }

    const interval = setInterval(async () => {
      await this.checkAlert(alert.id);
    }, this.CHECK_INTERVAL);

    this.alertIntervals.set(alert.id, interval);

    this.logger.debug('Started monitoring alert', {
      alertId: alert.id,
      interval: this.CHECK_INTERVAL
    });
  }

  private stopMonitoring(alertId: string): void {
    const interval = this.alertIntervals.get(alertId);
    if (interval) {
      clearInterval(interval);
      this.alertIntervals.delete(alertId);

      this.logger.debug('Stopped monitoring alert', { alertId });
    }
  }

  private async evaluateAlert(alert: PriceAlert): Promise<boolean> {
    try {
      const market = await this.polymarketService.getMarket(alert.marketId);
      if (!market || !market.currentPrice) {
        return false;
      }

      alert.currentPrice = market.currentPrice;

      switch (alert.alertType) {
        case 'above':
          return market.currentPrice >= alert.targetPrice;

        case 'below':
          return market.currentPrice <= alert.targetPrice;

        case 'change_percent':
          if (!alert.changePercent) {
            const change = this.calculatePercentageChange(market.currentPrice, alert.targetPrice);
            alert.changePercent = change;
          }
          return Math.abs(alert.changePercent) >= alert.targetPrice;

        case 'volume_spike':
          if (!market.volume24h) return false;
          return market.volume24h >= (alert.targetPrice || 0);

        default:
          return false;
      }

    } catch (error) {
      this.logger.error('Error evaluating alert', {
        alertId: alert.id,
        error
      });
      return false;
    }
  }

  private async triggerAlert(alert: PriceAlert): Promise<void> {
    try {
      const notification = NotificationTemplates.priceAlert({
        walletAddress: alert.walletAddress || 'N/A',
        marketId: alert.marketId,
        marketTitle: alert.marketTitle,
        currentPrice: alert.currentPrice || 0,
        targetPrice: alert.targetPrice,
        currency: alert.currency,
        alertType: alert.alertType
      });

      notification.userId = alert.telegramId;

      await this.notificationService.sendNotification(alert.telegramId, notification);

      // Update alert status
      alert.triggeredAt = new Date();
      alert.isActive = false; // Deactivate after triggering
      await this.saveAlert(alert);

      // Stop monitoring this alert
      this.stopMonitoring(alert.id);

      this.logger.info('Price alert triggered', {
        alertId: alert.id,
        userId: alert.userId,
        marketId: alert.marketId,
        triggerPrice: alert.currentPrice,
        targetPrice: alert.targetPrice
      });

    } catch (error) {
      this.logger.error('Error triggering alert', {
        alertId: alert.id,
        error
      });
    }
  }

  private calculatePercentageChange(current: number, target: number): number {
    if (target === 0) return 0;
    return ((current - target) / target) * 100;
  }

  private generateAlertId(userId: number, marketId: string, timestamp: number): string {
    return `alert_${userId}_${marketId.slice(-8)}_${timestamp}`;
  }

  private async getMarketTitle(marketId: string): Promise<string> {
    try {
      const market = await this.polymarketService.getMarket(marketId);
      return market?.title || 'Unknown Market';
    } catch {
      return 'Unknown Market';
    }
  }

  // Database operations (would integrate with existing database service)
  private async saveAlert(alert: PriceAlert): Promise<void> {
    // Implementation would save to database
  }

  private async getAlert(alertId: string): Promise<PriceAlert | null> {
    // Implementation would retrieve from database
    return null;
  }

  private async removeAlert(alertId: string): Promise<void> {
    // Implementation would remove from database
  }

  private async getAlertsByUser(userId: number): Promise<PriceAlert[]> {
    // Implementation would retrieve all alerts for user
    return [];
  }

  private async getActiveAlerts(): Promise<PriceAlert[]> {
    // Implementation would retrieve all active alerts
    return [];
  }

  // Cleanup on service shutdown
  public shutdown(): void {
    for (const [alertId, interval] of this.alertIntervals) {
      clearInterval(interval);
      this.logger.debug('Stopped monitoring alert during shutdown', { alertId });
    }
    this.alertIntervals.clear();
  }

  // Alert statistics and analytics
  async getAlertStatistics(userId: number): Promise<{
    totalAlerts: number;
    activeAlerts: number;
    triggeredToday: number;
    successRate: number;
    averageTriggerTime: number;
  }> {
    try {
      const userAlerts = await this.getAlertsByUser(userId);
      const activeAlerts = userAlerts.filter(alert => alert.isActive);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const triggeredToday = userAlerts.filter(alert =>
        alert.triggeredAt && alert.triggeredAt >= today
      ).length;

      const successfulAlerts = userAlerts.filter(alert => alert.triggeredAt).length;
      const successRate = userAlerts.length > 0 ? (successfulAlerts / userAlerts.length) * 100 : 0;

      const triggerTimes = userAlerts
        .filter(alert => alert.triggeredAt && alert.createdAt)
        .map(alert => alert.triggeredAt!.getTime() - alert.createdAt.getTime());

      const averageTriggerTime = triggerTimes.length > 0
        ? triggerTimes.reduce((sum, time) => sum + time, 0) / triggerTimes.length
        : 0;

      return {
        totalAlerts: userAlerts.length,
        activeAlerts: activeAlerts.length,
        triggeredToday,
        successRate,
        averageTriggerTime
      };

    } catch (error) {
      this.logger.error('Error getting alert statistics', {
        userId,
        error
      });
      return {
        totalAlerts: 0,
        activeAlerts: 0,
        triggeredToday: 0,
        successRate: 0,
        averageTriggerTime: 0
      };
    }
  }
}