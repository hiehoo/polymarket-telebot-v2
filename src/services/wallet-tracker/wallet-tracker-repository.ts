/**
 * Wallet Tracker Repository
 * PostgreSQL-based persistence for wallet tracking data
 * Replaces Redis for user/subscriber data to survive redeployments
 */

import { query, transaction } from '@/services/database/connection-pool';
import { logger } from '@/utils/logger';

export interface TrackedWalletRecord {
  id: string;
  user_id: string;
  telegram_id: number;
  chat_id: number;
  wallet_address: string;
  alias?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WalletSubscriber {
  userId: number;
  chatId: number;
  alias?: string;
}

/**
 * WalletTrackerRepository
 * Handles PostgreSQL persistence for wallet tracking
 */
export class WalletTrackerRepository {
  /**
   * Ensure user exists in database, create if not
   */
  async ensureUser(telegramId: number, chatId: number): Promise<string> {
    try {
      // Check if user exists
      const existingUsers = await query<{ id: string }>(
        'SELECT id FROM users WHERE telegram_id = $1',
        [telegramId]
      );

      if (existingUsers.length > 0) {
        return existingUsers[0].id;
      }

      // Create new user
      const newUsers = await query<{ id: string }>(
        `INSERT INTO users (telegram_id, is_active, created_at, updated_at)
         VALUES ($1, true, NOW(), NOW())
         RETURNING id`,
        [telegramId]
      );

      logger.info('Created new user for wallet tracking', { telegramId });
      return newUsers[0].id;
    } catch (error) {
      logger.error('Failed to ensure user exists', {
        telegramId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Add a tracked wallet for a user
   */
  async addTrackedWallet(
    telegramId: number,
    chatId: number,
    walletAddress: string,
    alias?: string
  ): Promise<{ success: boolean; message: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      // Ensure user exists
      const userId = await this.ensureUser(telegramId, chatId);

      // Check if already tracking
      const existing = await query<{ id: string }>(
        `SELECT id FROM tracked_wallets
         WHERE user_id = $1 AND wallet_address = $2 AND is_active = true`,
        [userId, normalizedWallet]
      );

      if (existing.length > 0) {
        return { success: false, message: 'Already tracking this wallet.' };
      }

      // Check user's wallet limit (10 per user)
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM tracked_wallets
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );

      if (parseInt(countResult[0].count) >= 10) {
        return { success: false, message: 'Maximum 10 wallets per user. Remove a wallet first.' };
      }

      // Insert tracked wallet with chat_id stored in alias field as JSON metadata
      // We store chat_id alongside alias since the schema doesn't have a chat_id column
      const metadata = JSON.stringify({ chatId, alias });

      await query(
        `INSERT INTO tracked_wallets (user_id, wallet_address, alias, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW())
         ON CONFLICT (user_id, wallet_address)
         DO UPDATE SET is_active = true, alias = $3, updated_at = NOW()`,
        [userId, normalizedWallet, metadata]
      );

      logger.info('Added tracked wallet', { telegramId, wallet: normalizedWallet, alias });

      const displayName = alias || `${normalizedWallet.slice(0, 6)}...${normalizedWallet.slice(-4)}`;
      return { success: true, message: `Now tracking ${displayName}.` };
    } catch (error) {
      logger.error('Failed to add tracked wallet', {
        telegramId,
        wallet: normalizedWallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { success: false, message: 'Failed to start tracking. Please try again.' };
    }
  }

  /**
   * Remove a tracked wallet for a user
   */
  async removeTrackedWallet(
    telegramId: number,
    walletAddress: string
  ): Promise<{ success: boolean; message: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      const result = await query(
        `UPDATE tracked_wallets tw
         SET is_active = false, updated_at = NOW()
         FROM users u
         WHERE tw.user_id = u.id
           AND u.telegram_id = $1
           AND tw.wallet_address = $2
           AND tw.is_active = true`,
        [telegramId, normalizedWallet]
      );

      const shortAddr = `${normalizedWallet.slice(0, 6)}...${normalizedWallet.slice(-4)}`;

      if ((result as any).rowCount === 0) {
        return { success: false, message: 'Wallet not found in your tracking list.' };
      }

      logger.info('Removed tracked wallet', { telegramId, wallet: normalizedWallet });
      return { success: true, message: `Stopped tracking ${shortAddr}.` };
    } catch (error) {
      logger.error('Failed to remove tracked wallet', {
        telegramId,
        wallet: normalizedWallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { success: false, message: 'Failed to stop tracking. Please try again.' };
    }
  }

  /**
   * Get all wallets tracked by a user
   */
  async getUserTrackedWallets(telegramId: number): Promise<Array<{ address: string; alias?: string }>> {
    try {
      const results = await query<{ wallet_address: string; alias: string | null }>(
        `SELECT tw.wallet_address, tw.alias
         FROM tracked_wallets tw
         JOIN users u ON tw.user_id = u.id
         WHERE u.telegram_id = $1 AND tw.is_active = true
         ORDER BY tw.created_at DESC`,
        [telegramId]
      );

      return results.map(r => {
        let alias: string | undefined;
        try {
          if (r.alias) {
            const metadata = JSON.parse(r.alias);
            alias = metadata.alias;
          }
        } catch {
          alias = r.alias || undefined;
        }
        return { address: r.wallet_address, alias };
      });
    } catch (error) {
      logger.error('Failed to get user tracked wallets', {
        telegramId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Get all unique tracked wallets across all users
   */
  async getAllTrackedWallets(): Promise<string[]> {
    try {
      const results = await query<{ wallet_address: string }>(
        `SELECT DISTINCT wallet_address
         FROM tracked_wallets
         WHERE is_active = true`
      );

      return results.map(r => r.wallet_address);
    } catch (error) {
      logger.error('Failed to get all tracked wallets', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Get all subscribers for a wallet
   */
  async getWalletSubscribers(walletAddress: string): Promise<WalletSubscriber[]> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      const results = await query<{ telegram_id: number; alias: string | null }>(
        `SELECT u.telegram_id, tw.alias
         FROM tracked_wallets tw
         JOIN users u ON tw.user_id = u.id
         WHERE tw.wallet_address = $1 AND tw.is_active = true`,
        [normalizedWallet]
      );

      return results.map(r => {
        let chatId = r.telegram_id; // Default to telegram_id as chatId
        let alias: string | undefined;

        try {
          if (r.alias) {
            const metadata = JSON.parse(r.alias);
            chatId = metadata.chatId || r.telegram_id;
            alias = metadata.alias;
          }
        } catch {
          alias = r.alias || undefined;
        }

        return {
          userId: r.telegram_id,
          chatId,
          alias,
        };
      });
    } catch (error) {
      logger.error('Failed to get wallet subscribers', {
        wallet: normalizedWallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Check if user is tracking a wallet
   */
  async isUserTrackingWallet(telegramId: number, walletAddress: string): Promise<boolean> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      const results = await query<{ id: string }>(
        `SELECT tw.id
         FROM tracked_wallets tw
         JOIN users u ON tw.user_id = u.id
         WHERE u.telegram_id = $1 AND tw.wallet_address = $2 AND tw.is_active = true`,
        [telegramId, normalizedWallet]
      );

      return results.length > 0;
    } catch (error) {
      logger.error('Failed to check if user is tracking wallet', {
        telegramId,
        wallet: normalizedWallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get wallet alias for a user
   */
  async getWalletAlias(telegramId: number, walletAddress: string): Promise<string | undefined> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      const results = await query<{ alias: string | null }>(
        `SELECT tw.alias
         FROM tracked_wallets tw
         JOIN users u ON tw.user_id = u.id
         WHERE u.telegram_id = $1 AND tw.wallet_address = $2 AND tw.is_active = true`,
        [telegramId, normalizedWallet]
      );

      if (results.length === 0 || !results[0].alias) {
        return undefined;
      }

      try {
        const metadata = JSON.parse(results[0].alias);
        return metadata.alias;
      } catch {
        return results[0].alias;
      }
    } catch (error) {
      logger.error('Failed to get wallet alias', {
        telegramId,
        wallet: normalizedWallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  /**
   * Get all wallet aliases (for consensus detector)
   */
  async getAllWalletAliases(): Promise<Map<string, string>> {
    try {
      const results = await query<{ wallet_address: string; alias: string | null }>(
        `SELECT DISTINCT ON (wallet_address) wallet_address, alias
         FROM tracked_wallets
         WHERE is_active = true AND alias IS NOT NULL
         ORDER BY wallet_address, created_at DESC`
      );

      const aliases = new Map<string, string>();

      for (const r of results) {
        if (r.alias) {
          try {
            const metadata = JSON.parse(r.alias);
            if (metadata.alias) {
              aliases.set(r.wallet_address, metadata.alias);
            }
          } catch {
            aliases.set(r.wallet_address, r.alias);
          }
        }
      }

      return aliases;
    } catch (error) {
      logger.error('Failed to get all wallet aliases', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return new Map();
    }
  }

  /**
   * Update wallet last activity timestamp
   */
  async updateWalletActivity(walletAddress: string): Promise<void> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      await query(
        `UPDATE tracked_wallets
         SET last_activity_at = NOW(), updated_at = NOW()
         WHERE wallet_address = $1 AND is_active = true`,
        [normalizedWallet]
      );
    } catch (error) {
      logger.error('Failed to update wallet activity', {
        wallet: normalizedWallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get tracking statistics
   */
  async getStats(): Promise<{
    totalWallets: number;
    totalUsers: number;
    totalSubscriptions: number;
  }> {
    try {
      const walletCount = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT wallet_address) as count
         FROM tracked_wallets
         WHERE is_active = true`
      );

      const userCount = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT user_id) as count
         FROM tracked_wallets
         WHERE is_active = true`
      );

      const subscriptionCount = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM tracked_wallets
         WHERE is_active = true`
      );

      return {
        totalWallets: parseInt(walletCount[0].count),
        totalUsers: parseInt(userCount[0].count),
        totalSubscriptions: parseInt(subscriptionCount[0].count),
      };
    } catch (error) {
      logger.error('Failed to get tracking stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { totalWallets: 0, totalUsers: 0, totalSubscriptions: 0 };
    }
  }
}

// Singleton instance
let repositoryInstance: WalletTrackerRepository | null = null;

export function getWalletTrackerRepository(): WalletTrackerRepository {
  if (!repositoryInstance) {
    repositoryInstance = new WalletTrackerRepository();
  }
  return repositoryInstance;
}

export function createWalletTrackerRepository(): WalletTrackerRepository {
  return new WalletTrackerRepository();
}
