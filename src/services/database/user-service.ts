import { logger } from '../../utils/logger';
import { DatabaseUser, TrackedWallet, NotificationLog } from '../../types/database';

export class UserService {
  private userCache: Map<number, DatabaseUser> = new Map();
  private walletCache: Map<number, TrackedWallet[]> = new Map();

  constructor() {
    // In-memory cache for minimal implementation
  }

  async createUser(telegramUser: {
    id: number;
    username?: string;
    first_name: string;
    last_name?: string;
    language_code?: string;
  }): Promise<DatabaseUser> {
    try {
      const userId = `user_${telegramUser.id}_${Date.now()}`;

      const user: DatabaseUser = {
        id: userId,
        telegram_id: telegramUser.id,
        telegram_username: telegramUser.username,
        is_active: true,
        notification_preferences: {
          enabled: true,
          position_updates: true,
          transactions: true,
          resolutions: true,
          price_alerts: true,
          large_positions: true,
          min_position_size: 1000,
          min_transaction_amount: 100,
          price_change_threshold: 5.0
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      this.userCache.set(telegramUser.id, user);

      logger.info(`Created user ${telegramUser.id} (${telegramUser.username})`);
      return user;

    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  async getUserByTelegramId(telegramId: number): Promise<DatabaseUser | null> {
    try {
      const cached = this.userCache.get(telegramId);
      if (cached) {
        return cached;
      }

      return null;

    } catch (error) {
      logger.error('Error getting user by telegram ID:', error);
      return null;
    }
  }

  async updateUser(telegramId: number, updates: Partial<DatabaseUser>): Promise<DatabaseUser | null> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        return null;
      }

      const updatedUser: DatabaseUser = {
        ...user,
        ...updates,
        updated_at: new Date()
      };

      this.userCache.set(telegramId, updatedUser);

      logger.info(`Updated user ${telegramId}`);
      return updatedUser;

    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  async addTrackedWallet(telegramId: number, walletAddress: string, alias?: string): Promise<TrackedWallet | null> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        return null;
      }

      const walletId = `wallet_${telegramId}_${Date.now()}`;
      const wallet: TrackedWallet = {
        id: walletId,
        user_id: user.id,
        wallet_address: walletAddress,
        alias,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      const userWallets = await this.getUserWallets(telegramId);
      userWallets.push(wallet);

      this.walletCache.set(telegramId, userWallets);

      logger.info(`Added wallet ${walletAddress} for user ${telegramId}`);
      return wallet;

    } catch (error) {
      logger.error('Error adding tracked wallet:', error);
      throw error;
    }
  }

  async getUserWallets(telegramId: number): Promise<TrackedWallet[]> {
    try {
      const cached = this.walletCache.get(telegramId);
      if (cached) {
        return cached;
      }

      return [];

    } catch (error) {
      logger.error('Error getting user wallets:', error);
      return [];
    }
  }

  async removeTrackedWallet(telegramId: number, walletAddress: string): Promise<boolean> {
    try {
      const userWallets = await this.getUserWallets(telegramId);
      const updatedWallets = userWallets.filter(wallet => wallet.wallet_address !== walletAddress);

      if (updatedWallets.length === userWallets.length) {
        return false;
      }

      this.walletCache.set(telegramId, updatedWallets);

      logger.info(`Removed wallet ${walletAddress} for user ${telegramId}`);
      return true;

    } catch (error) {
      logger.error('Error removing tracked wallet:', error);
      return false;
    }
  }

  async updateWalletAlias(telegramId: number, walletAddress: string, alias: string): Promise<boolean> {
    try {
      const userWallets = await this.getUserWallets(telegramId);
      const wallet = userWallets.find(w => w.wallet_address === walletAddress);

      if (!wallet) {
        return false;
      }

      wallet.alias = alias;
      wallet.updated_at = new Date();

      this.walletCache.set(telegramId, userWallets);

      logger.info(`Updated alias for wallet ${walletAddress} for user ${telegramId}`);
      return true;

    } catch (error) {
      logger.error('Error updating wallet alias:', error);
      return false;
    }
  }

  async isWalletTracked(telegramId: number, walletAddress: string): Promise<boolean> {
    try {
      const userWallets = await this.getUserWallets(telegramId);
      return userWallets.some(wallet => wallet.wallet_address === walletAddress);

    } catch (error) {
      logger.error('Error checking if wallet is tracked:', error);
      return false;
    }
  }

  async getUserStatistics(telegramId: number): Promise<{
    totalWallets: number;
    activeWallets: number;
    totalNotifications: number;
    lastActivity: Date | null;
    joinDate: Date | null;
  }> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        return {
          totalWallets: 0,
          activeWallets: 0,
          totalNotifications: 0,
          lastActivity: null,
          joinDate: null
        };
      }

      const userWallets = await this.getUserWallets(telegramId);
      const activeWallets = userWallets.filter(wallet => wallet.is_active).length;

      return {
        totalWallets: userWallets.length,
        activeWallets,
        totalNotifications: 0,
        lastActivity: userWallets.reduce((latest, wallet) => {
          return wallet.last_activity_at && (!latest || wallet.last_activity_at > latest)
            ? wallet.last_activity_at
            : latest;
        }, null as Date | null),
        joinDate: user.created_at
      };

    } catch (error) {
      logger.error('Error getting user statistics:', error);
      return {
        totalWallets: 0,
        activeWallets: 0,
        totalNotifications: 0,
        lastActivity: null,
        joinDate: null
      };
    }
  }

  async updateNotificationPreferences(
    telegramId: number,
    preferences: Partial<DatabaseUser['notification_preferences']>
  ): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        return false;
      }

      const updatedPreferences = {
        ...user.notification_preferences,
        ...preferences
      };

      await this.updateUser(telegramId, {
        notification_preferences: updatedPreferences
      });

      logger.info(`Updated notification preferences for user ${telegramId}`);
      return true;

    } catch (error) {
      logger.error('Error updating notification preferences:', error);
      return false;
    }
  }

  async logNotification(
    userId: string,
    notificationType: NotificationLog['notification_type'],
    messageText: string,
    messageData: any
  ): Promise<void> {
    try {
      const notification: NotificationLog = {
        id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: userId,
        notification_type: notificationType,
        message_text: messageText,
        message_data: messageData,
        sent_at: new Date(),
        delivery_status: 'pending',
        retry_count: 0,
        created_at: new Date()
      };

      // For minimal implementation, just log the notification
      // In production, this would save to database

      logger.info(`Logged notification ${notification.id} for user ${userId}`);

    } catch (error) {
      logger.error('Error logging notification:', error);
    }
  }

  async getUserCount(): Promise<number> {
    try {
      return 0;

    } catch (error) {
      logger.error('Error getting user count:', error);
      return 0;
    }
  }

  async getActiveUserCount(): Promise<number> {
    try {
      return 0;

    } catch (error) {
      logger.error('Error getting active user count:', error);
      return 0;
    }
  }

  async getTotalTrackedWallets(): Promise<number> {
    try {
      return 0;

    } catch (error) {
      logger.error('Error getting total tracked wallets:', error);
      return 0;
    }
  }

  async deactivateUser(telegramId: number): Promise<boolean> {
    try {
      const success = await this.updateUser(telegramId, { is_active: false });
      return success !== null;

    } catch (error) {
      logger.error('Error deactivating user:', error);
      return false;
    }
  }

  async reactivateUser(telegramId: number): Promise<boolean> {
    try {
      const success = await this.updateUser(telegramId, { is_active: true });
      return success !== null;

    } catch (error) {
      logger.error('Error reactivating user:', error);
      return false;
    }
  }

  async updateUserLastActivity(telegramId: number): Promise<void> {
    try {
      await this.updateUser(telegramId, {
        updated_at: new Date(),
        last_notification_at: new Date()
      });

    } catch (error) {
      logger.error('Error updating user last activity:', error);
    }
  }

  async getUsersWithWallet(walletAddress: string): Promise<DatabaseUser[]> {
    try {
      return [];

    } catch (error) {
      logger.error('Error getting users with wallet:', error);
      return [];
    }
  }

  async bulkUpdateWalletLastActivity(walletAddresses: string[]): Promise<void> {
    try {
      logger.info(`Bulk updating last activity for ${walletAddresses.length} wallets`);

    } catch (error) {
      logger.error('Error bulk updating wallet last activity:', error);
    }
  }

  /**
   * Get all active user telegram IDs (for broadcast notifications)
   */
  async getActiveUserTelegramIds(): Promise<number[]> {
    try {
      const activeIds: number[] = [];
      for (const [telegramId, user] of this.userCache) {
        if (user.is_active) {
          activeIds.push(telegramId);
        }
      }
      return activeIds;
    } catch (error) {
      logger.error('Error getting active user telegram IDs:', error);
      return [];
    }
  }
}