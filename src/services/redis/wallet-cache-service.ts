import { logger } from '../../utils/logger';
import { RedisCacheManager } from './cache-manager';
import { TrackedWallet, WalletActivity } from '../../types/database';

interface CachedWalletData {
  wallet: TrackedWallet;
  balance?: {
    total: number;
    available: number;
    staked: number;
    pending: number;
    currency: string;
    lastUpdated: Date;
  };
  tokens?: Array<{
    symbol: string;
    balance: number;
    value: number;
    price: number;
    lastUpdated: Date;
  }>;
  activity?: WalletActivity[];
  lastRefreshed: Date;
}

interface WalletMetrics {
  totalTransactions: number;
  totalVolume: number;
  avgTransactionValue: number;
  lastActivity: Date | null;
  activePositions: number;
  resolvedPositions: number;
  winRate: number;
}

export class WalletCacheService {
  private cacheManager: RedisCacheManager;
  private readonly CACHE_TTL = {
    WALLET_DATA: 3600,
    BALANCE: 300,
    TOKENS: 300,
    ACTIVITY: 600,
    METRICS: 1800,
    VALIDATION: 86400
  };

  constructor() {
    this.cacheManager = new RedisCacheManager();
  }

  async cacheWalletData(wallet: TrackedWallet, additionalData?: Partial<CachedWalletData>): Promise<void> {
    try {
      const cacheKey = `wallet_data:${wallet.wallet_address}`;
      const cachedData: CachedWalletData = {
        wallet,
        lastRefreshed: new Date(),
        ...additionalData
      };

      await this.cacheManager.setCachedData(cacheKey, cachedData, this.CACHE_TTL.WALLET_DATA);

      logger.info(`Cached wallet data for ${wallet.wallet_address}`);
    } catch (error) {
      logger.error('Error caching wallet data:', error);
    }
  }

  async getWalletData(address: string): Promise<CachedWalletData | null> {
    try {
      const cacheKey = `wallet_data:${address}`;
      return await this.cacheManager.getCachedData(cacheKey) as CachedWalletData;
    } catch (error) {
      logger.error('Error getting wallet data:', error);
      return null;
    }
  }

  async cacheWalletBalance(
    address: string,
    balance: CachedWalletData['balance'],
    forceUpdate = false
  ): Promise<void> {
    try {
      const cacheKey = `balance:${address}`;

      if (!forceUpdate) {
        const existing = await this.cacheManager.getCachedData(cacheKey);
        if (existing) {
          return;
        }
      }

      await this.cacheManager.setCachedData(cacheKey, balance, this.CACHE_TTL.BALANCE);

      logger.debug(`Cached balance for ${address}`);
    } catch (error) {
      logger.error('Error caching wallet balance:', error);
    }
  }

  async getWalletBalance(address: string): Promise<CachedWalletData['balance'] | null> {
    try {
      const cacheKey = `balance:${address}`;
      return await this.cacheManager.getCachedData(cacheKey) as CachedWalletData['balance'];
    } catch (error) {
      logger.error('Error getting wallet balance:', error);
      return null;
    }
  }

  async cacheWalletTokens(
    address: string,
    tokens: CachedWalletData['tokens'],
    forceUpdate = false
  ): Promise<void> {
    try {
      const cacheKey = `tokens:${address}`;

      if (!forceUpdate) {
        const existing = await this.cacheManager.getCachedData(cacheKey);
        if (existing) {
          return;
        }
      }

      await this.cacheManager.setCachedData(cacheKey, tokens, this.CACHE_TTL.TOKENS);

      logger.debug(`Cached tokens for ${address}`);
    } catch (error) {
      logger.error('Error caching wallet tokens:', error);
    }
  }

  async getWalletTokens(address: string): Promise<CachedWalletData['tokens'] | null> {
    try {
      const cacheKey = `tokens:${address}`;
      return await this.cacheManager.getCachedData(cacheKey) as CachedWalletData['tokens'];
    } catch (error) {
      logger.error('Error getting wallet tokens:', error);
      return null;
    }
  }

  async cacheWalletActivity(
    address: string,
    activity: WalletActivity[],
    maxAgeMinutes = 60
  ): Promise<void> {
    try {
      const cacheKey = `activity:${address}`;
      const cutoffTime = new Date(Date.now() - (maxAgeMinutes * 60 * 1000));

      const recentActivity = activity.filter(a =>
        new Date(a.occurred_at) >= cutoffTime
      );

      await this.cacheManager.setCachedData(cacheKey, recentActivity, this.CACHE_TTL.ACTIVITY);

      logger.debug(`Cached ${recentActivity.length} activities for ${address}`);
    } catch (error) {
      logger.error('Error caching wallet activity:', error);
    }
  }

  async getWalletActivity(address: string): Promise<WalletActivity[] | null> {
    try {
      const cacheKey = `activity:${address}`;
      return await this.cacheManager.getCachedData(cacheKey) as WalletActivity[];
    } catch (error) {
      logger.error('Error getting wallet activity:', error);
      return null;
    }
  }

  async addWalletActivity(address: string, activity: WalletActivity): Promise<void> {
    try {
      const cacheKey = `activity:${address}`;
      const existingActivity = await this.getWalletActivity(address) || [];

      existingActivity.unshift(activity);

      const maxActivity = 100;
      if (existingActivity.length > maxActivity) {
        existingActivity.splice(maxActivity);
      }

      await this.cacheManager.setCachedData(cacheKey, existingActivity, this.CACHE_TTL.ACTIVITY);

      logger.debug(`Added activity to cache for ${address}`);
    } catch (error) {
      logger.error('Error adding wallet activity to cache:', error);
    }
  }

  async cacheWalletMetrics(
    address: string,
    metrics: WalletMetrics,
    forceUpdate = false
  ): Promise<void> {
    try {
      const cacheKey = `metrics:${address}`;

      if (!forceUpdate) {
        const existing = await this.cacheManager.getCachedData(cacheKey);
        if (existing) {
          return;
        }
      }

      await this.cacheManager.setCachedData(cacheKey, metrics, this.CACHE_TTL.METRICS);

      logger.debug(`Cached metrics for ${address}`);
    } catch (error) {
      logger.error('Error caching wallet metrics:', error);
    }
  }

  async getWalletMetrics(address: string): Promise<WalletMetrics | null> {
    try {
      const cacheKey = `metrics:${address}`;
      return await this.cacheManager.getCachedData(cacheKey) as WalletMetrics;
    } catch (error) {
      logger.error('Error getting wallet metrics:', error);
      return null;
    }
  }

  async cacheAddressValidation(address: string, isValid: boolean): Promise<void> {
    try {
      const cacheKey = `validation:${address}`;
      const validationData = {
        isValid,
        validatedAt: new Date(),
        address: address.toLowerCase()
      };

      await this.cacheManager.setCachedData(cacheKey, validationData, this.CACHE_TTL.VALIDATION);

      logger.debug(`Cached validation result for ${address}: ${isValid}`);
    } catch (error) {
      logger.error('Error caching address validation:', error);
    }
  }

  async getAddressValidation(address: string): Promise<{ isValid: boolean; validatedAt: Date } | null> {
    try {
      const cacheKey = `validation:${address}`;
      return await this.cacheManager.getCachedData(cacheKey);
    } catch (error) {
      logger.error('Error getting address validation:', error);
      return null;
    }
  }

  async cacheUserWallets(userId: number, wallets: TrackedWallet[]): Promise<void> {
    try {
      const cacheKey = `user_wallets:${userId}`;
      const walletMap: Record<string, TrackedWallet> = {};

      wallets.forEach(wallet => {
        walletMap[wallet.wallet_address] = wallet;
      });

      await this.cacheManager.setCachedData(cacheKey, walletMap, this.CACHE_TTL.WALLET_DATA);

      logger.debug(`Cached ${wallets.length} wallets for user ${userId}`);
    } catch (error) {
      logger.error('Error caching user wallets:', error);
    }
  }

  async getUserWallets(userId: number): Promise<TrackedWallet[]> {
    try {
      const cacheKey = `user_wallets:${userId}`;
      const walletMap = await this.cacheManager.getCachedData(cacheKey);

      if (walletMap) {
        return Object.values(walletMap) as TrackedWallet[];
      }

      return [];
    } catch (error) {
      logger.error('Error getting user wallets:', error);
      return [];
    }
  }

  async addUserWallet(userId: number, wallet: TrackedWallet): Promise<void> {
    try {
      const existingWallets = await this.getUserWallets(userId);
      const walletExists = existingWallets.some(w => w.wallet_address === wallet.wallet_address);

      if (!walletExists) {
        existingWallets.push(wallet);
        await this.cacheUserWallets(userId, existingWallets);
      }

      await this.cacheWalletData(wallet);
    } catch (error) {
      logger.error('Error adding user wallet to cache:', error);
    }
  }

  async removeUserWallet(userId: number, address: string): Promise<void> {
    try {
      const existingWallets = await this.getUserWallets(userId);
      const filteredWallets = existingWallets.filter(w => w.wallet_address !== address);

      await this.cacheUserWallets(userId, filteredWallets);
      await this.invalidateWalletCache(address);

      logger.debug(`Removed wallet ${address} from user ${userId} cache`);
    } catch (error) {
      logger.error('Error removing user wallet from cache:', error);
    }
  }

  async updateUserWallet(userId: number, wallet: TrackedWallet): Promise<void> {
    try {
      const existingWallets = await this.getUserWallets(userId);
      const walletIndex = existingWallets.findIndex(w => w.wallet_address === wallet.wallet_address);

      if (walletIndex >= 0) {
        existingWallets[walletIndex] = wallet;
        await this.cacheUserWallets(userId, existingWallets);
        await this.cacheWalletData(wallet);
      }
    } catch (error) {
      logger.error('Error updating user wallet in cache:', error);
    }
  }

  async invalidateWalletCache(address: string): Promise<void> {
    try {
      const keysToInvalidate = [
        `wallet_data:${address}`,
        `balance:${address}`,
        `tokens:${address}`,
        `activity:${address}`,
        `metrics:${address}`
      ];

      for (const key of keysToInvalidate) {
        await this.cacheManager.deleteCachedData(key);
      }

      logger.debug(`Invalidated cache for wallet ${address}`);
    } catch (error) {
      logger.error('Error invalidating wallet cache:', error);
    }
  }

  async invalidateUserCache(userId: number): Promise<void> {
    try {
      await this.cacheManager.deleteCachedData(`user_wallets:${userId}`);
      await this.cacheManager.deleteCachedData(`user_prefs:${userId}`);
      await this.cacheManager.deleteCachedData(`history_state:${userId}`);

      logger.debug(`Invalidated cache for user ${userId}`);
    } catch (error) {
      logger.error('Error invalidating user cache:', error);
    }
  }

  async refreshWalletCache(address: string): Promise<void> {
    try {
      await this.invalidateWalletCache(address);
      logger.info(`Refreshed cache for wallet ${address}`);
    } catch (error) {
      logger.error('Error refreshing wallet cache:', error);
    }
  }

  async getCachedAddressesCount(): Promise<number> {
    try {
      const pattern = 'wallet_data:*';
      const keys = await this.cacheManager.getKeysByPattern(pattern);
      return keys.length;
    } catch (error) {
      logger.error('Error getting cached addresses count:', error);
      return 0;
    }
  }

  async getUserCachedWalletsCount(userId: number): Promise<number> {
    try {
      const wallets = await this.getUserWallets(userId);
      return wallets.length;
    } catch (error) {
      logger.error('Error getting user cached wallets count:', error);
      return 0;
    }
  }

  async cleanupExpiredData(): Promise<void> {
    try {
      logger.info('Starting wallet cache cleanup...');

      const patterns = [
        'validation:*',
        'activity:*',
        'metrics:*'
      ];

      for (const pattern of patterns) {
        const keys = await this.cacheManager.getKeysByPattern(pattern);
        let cleanedCount = 0;

        for (const key of keys) {
          const data = await this.cacheManager.getCachedData(key);
          if (data && data.lastRefreshed) {
            const age = Date.now() - new Date(data.lastRefreshed).getTime();
            const maxAge = this.getMaxAgeForPattern(pattern);

            if (age > maxAge) {
              await this.cacheManager.deleteCachedData(key);
              cleanedCount++;
            }
          }
        }

        logger.debug(`Cleaned ${cleanedCount} expired entries for pattern ${pattern}`);
      }

      logger.info('Wallet cache cleanup completed');
    } catch (error) {
      logger.error('Error during wallet cache cleanup:', error);
    }
  }

  async getCacheStats(): Promise<{
    totalCachedWallets: number;
    totalCachedUsers: number;
    cacheHitRate: number;
    memoryUsage: number;
  }> {
    try {
      const totalCachedWallets = await this.getCachedAddressesCount();

      return {
        totalCachedWallets,
        totalCachedUsers: 0,
        cacheHitRate: 0,
        memoryUsage: 0
      };
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return {
        totalCachedWallets: 0,
        totalCachedUsers: 0,
        cacheHitRate: 0,
        memoryUsage: 0
      };
    }
  }

  private getMaxAgeForPattern(pattern: string): number {
    switch (pattern) {
      case 'validation:*':
        return this.CACHE_TTL.VALIDATION * 1000;
      case 'activity:*':
        return this.CACHE_TTL.ACTIVITY * 2 * 1000;
      case 'metrics:*':
        return this.CACHE_TTL.METRICS * 2 * 1000;
      default:
        return this.CACHE_TTL.WALLET_DATA * 2 * 1000;
    }
  }

  async batchCacheWalletData(wallets: TrackedWallet[]): Promise<void> {
    try {
      const promises = wallets.map(wallet => this.cacheWalletData(wallet));
      await Promise.all(promises);

      logger.info(`Batch cached ${wallets.length} wallets`);
    } catch (error) {
      logger.error('Error batch caching wallet data:', error);
    }
  }

  async batchInvalidateWallets(addresses: string[]): Promise<void> {
    try {
      const promises = addresses.map(address => this.invalidateWalletCache(address));
      await Promise.all(promises);

      logger.info(`Batch invalidated ${addresses.length} wallets`);
    } catch (error) {
      logger.error('Error batch invalidating wallets:', error);
    }
  }
}