/**
 * Wallet Activity Tracker Service
 * Polls tracked wallets and sends Telegram notifications on position changes
 */

import { Telegraf, Context } from 'telegraf';
import { SimpleRedisClient } from '@/services/redis/simple-redis-client';
import { PolymarketService } from '@/services/polymarket';
import { logger } from '@/utils/logger';
import {
  PositionSnapshot,
  PositionChange,
  detectChanges,
  createSnapshotFromPositions,
  formatNotification,
} from './position-diff-detector';

export interface TrackerConfig {
  redis: SimpleRedisClient;
  polymarketService: PolymarketService;
  bot: Telegraf<Context>;
  pollIntervalMs?: number;
  maxWallets?: number;
  enabled?: boolean;
}

interface TrackedWallet {
  walletAddress: string;
  userId: number;
  chatId: number;
  alias?: string;
  addedAt: number;
}

interface WalletSubscriber {
  userId: number;
  chatId: number;
  alias?: string;
}

// Redis key patterns
const REDIS_KEYS = {
  snapshot: (wallet: string) => `wallet_tracker:snapshot:${wallet.toLowerCase()}`,
  userWallets: (userId: number) => `wallet_tracker:user:${userId}`,
  walletSubscribers: (wallet: string) => `wallet_tracker:subscribers:${wallet.toLowerCase()}`,
  allTrackedWallets: 'wallet_tracker:all_wallets',
};

export class WalletActivityTracker {
  private redis: SimpleRedisClient;
  private polymarketService: PolymarketService;
  private bot: Telegraf<Context>;
  private pollIntervalMs: number;
  private maxWallets: number;
  private enabled: boolean;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private pollIndex = 0;
  private trackedWallets: string[] = [];

  constructor(config: TrackerConfig) {
    this.redis = config.redis;
    this.polymarketService = config.polymarketService;
    this.bot = config.bot;
    this.pollIntervalMs = config.pollIntervalMs || 60000; // 60 seconds default
    this.maxWallets = config.maxWallets || 100;
    this.enabled = config.enabled !== false;
  }

  /**
   * Initialize the tracker and start polling
   */
  async initialize(): Promise<void> {
    if (!this.enabled) {
      logger.info('Wallet Activity Tracker is disabled');
      return;
    }

    try {
      logger.info('Initializing Wallet Activity Tracker...');

      // Load tracked wallets from Redis
      await this.loadTrackedWallets();

      // Start polling
      this.startPolling();

      logger.info('Wallet Activity Tracker initialized', {
        trackedWallets: this.trackedWallets.length,
        pollIntervalMs: this.pollIntervalMs,
      });
    } catch (error) {
      logger.error('Failed to initialize Wallet Activity Tracker', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Stop the tracker
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Wallet Activity Tracker...');
    this.stopPolling();
  }

  /**
   * Start tracking a wallet for a user
   */
  async startTracking(
    walletAddress: string,
    userId: number,
    chatId: number,
    alias?: string
  ): Promise<{ success: boolean; message: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      // Check max wallets limit
      const userWallets = await this.getUserTrackedWallets(userId);
      if (userWallets.length >= 10) {
        return {
          success: false,
          message: 'Maximum 10 wallets per user. Remove a wallet first.',
        };
      }

      // Check global max wallets
      if (this.trackedWallets.length >= this.maxWallets) {
        return {
          success: false,
          message: 'System wallet tracking limit reached. Try again later.',
        };
      }

      // Add to user's tracked wallets
      const subscriber: WalletSubscriber = { userId, chatId, alias };
      await this.redis.hset(
        REDIS_KEYS.walletSubscribers(normalizedWallet),
        String(userId),
        subscriber
      );

      // Add wallet to user's list
      await this.redis.sadd(REDIS_KEYS.userWallets(userId), normalizedWallet);

      // Add to global tracked wallets set
      await this.redis.sadd(REDIS_KEYS.allTrackedWallets, normalizedWallet);

      // Fetch and store initial snapshot
      await this.fetchAndStoreSnapshot(normalizedWallet);

      // Update local cache
      if (!this.trackedWallets.includes(normalizedWallet)) {
        this.trackedWallets.push(normalizedWallet);
      }

      logger.info('Started tracking wallet', {
        wallet: normalizedWallet,
        userId,
        alias,
      });

      return {
        success: true,
        message: `Now tracking ${alias || this.formatShortAddress(normalizedWallet)}. You'll receive notifications when positions change.`,
      };
    } catch (error) {
      logger.error('Failed to start tracking wallet', {
        wallet: normalizedWallet,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        success: false,
        message: 'Failed to start tracking. Please try again.',
      };
    }
  }

  /**
   * Stop tracking a wallet for a user
   */
  async stopTracking(
    walletAddress: string,
    userId: number
  ): Promise<{ success: boolean; message: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      // Remove from user's tracked wallets
      await this.redis.hdel(REDIS_KEYS.walletSubscribers(normalizedWallet), String(userId));
      await this.redis.srem(REDIS_KEYS.userWallets(userId), normalizedWallet);

      // Check if any other users are tracking this wallet
      const subscribers = await this.redis.hgetall(REDIS_KEYS.walletSubscribers(normalizedWallet));
      if (Object.keys(subscribers).length === 0) {
        // No more subscribers, remove from global list and clean up snapshot
        await this.redis.srem(REDIS_KEYS.allTrackedWallets, normalizedWallet);
        await this.redis.del(REDIS_KEYS.snapshot(normalizedWallet));

        // Update local cache
        this.trackedWallets = this.trackedWallets.filter(w => w !== normalizedWallet);
      }

      logger.info('Stopped tracking wallet', { wallet: normalizedWallet, userId });

      return {
        success: true,
        message: `Stopped tracking ${this.formatShortAddress(normalizedWallet)}.`,
      };
    } catch (error) {
      logger.error('Failed to stop tracking wallet', {
        wallet: normalizedWallet,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        success: false,
        message: 'Failed to stop tracking. Please try again.',
      };
    }
  }

  /**
   * Get list of wallets tracked by a user
   */
  async getUserTrackedWallets(userId: number): Promise<string[]> {
    try {
      return await this.redis.smembers(REDIS_KEYS.userWallets(userId));
    } catch (error) {
      logger.error('Failed to get user tracked wallets', { userId, error });
      return [];
    }
  }

  /**
   * Check if user is tracking a wallet
   */
  async isUserTrackingWallet(userId: number, walletAddress: string): Promise<boolean> {
    const normalizedWallet = walletAddress.toLowerCase();
    try {
      const result = await this.redis.sismember(REDIS_KEYS.userWallets(userId), normalizedWallet);
      return result === 1;
    } catch (error) {
      logger.error('Failed to check if user is tracking wallet', { userId, walletAddress, error });
      return false;
    }
  }

  /**
   * Load tracked wallets from Redis
   */
  private async loadTrackedWallets(): Promise<void> {
    try {
      this.trackedWallets = await this.redis.smembers(REDIS_KEYS.allTrackedWallets);
      logger.info('Loaded tracked wallets', { count: this.trackedWallets.length });
    } catch (error) {
      logger.error('Failed to load tracked wallets', { error });
      this.trackedWallets = [];
    }
  }

  /**
   * Start the polling loop
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      return;
    }

    // Calculate poll delay based on number of wallets
    // Goal: poll each wallet every pollIntervalMs, but stagger to avoid rate limits
    const pollDelay = this.calculatePollDelay();

    logger.info('Starting wallet polling', {
      totalWallets: this.trackedWallets.length,
      pollDelay,
    });

    this.pollingInterval = setInterval(async () => {
      if (this.isPolling || this.trackedWallets.length === 0) {
        return;
      }

      this.isPolling = true;
      try {
        await this.pollNextWallet();
      } catch (error) {
        logger.error('Polling error', { error });
      } finally {
        this.isPolling = false;
      }
    }, pollDelay);
  }

  /**
   * Stop the polling loop
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Calculate delay between polling each wallet
   */
  private calculatePollDelay(): number {
    const walletCount = Math.max(1, this.trackedWallets.length);
    // At least 1 second between API calls, spread evenly across poll interval
    const minDelay = 1000;
    const calculatedDelay = Math.floor(this.pollIntervalMs / walletCount);
    return Math.max(minDelay, calculatedDelay);
  }

  /**
   * Poll the next wallet in the queue
   */
  private async pollNextWallet(): Promise<void> {
    if (this.trackedWallets.length === 0) {
      return;
    }

    // Round-robin through wallets
    this.pollIndex = this.pollIndex % this.trackedWallets.length;
    const wallet = this.trackedWallets[this.pollIndex];
    this.pollIndex++;

    try {
      await this.checkWalletActivity(wallet);
    } catch (error) {
      logger.error('Failed to poll wallet', {
        wallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check a wallet for activity and send notifications
   */
  private async checkWalletActivity(walletAddress: string): Promise<void> {
    // Get previous snapshot
    const previousSnapshotJson = await this.redis.get(REDIS_KEYS.snapshot(walletAddress));
    const previousSnapshot: Map<string, PositionSnapshot> = previousSnapshotJson
      ? this.deserializeSnapshot(previousSnapshotJson)
      : new Map();

    // Fetch current positions
    const positions = await this.polymarketService.getWalletPositions(walletAddress, 500);
    const currentSnapshot = createSnapshotFromPositions(
      positions.map(p => ({
        conditionId: p.marketId,
        asset: p.marketId,
        size: p.shares,
        avgPrice: p.entryPrice || 0,
        title: p.market,
        eventSlug: p.eventSlug || p.slug || '',
        outcome: p.position,
        side: p.position,
      }))
    );

    // Detect changes
    const changes = detectChanges(previousSnapshot, currentSnapshot);

    if (changes.length > 0) {
      logger.info('Detected position changes', {
        wallet: walletAddress,
        changeCount: changes.length,
      });

      // Get subscribers and send notifications
      await this.notifySubscribers(walletAddress, changes);
    }

    // Update snapshot
    await this.redis.set(
      REDIS_KEYS.snapshot(walletAddress),
      this.serializeSnapshot(currentSnapshot),
      3600 * 24 // 24 hour TTL
    );
  }

  /**
   * Fetch and store initial snapshot for a wallet
   */
  private async fetchAndStoreSnapshot(walletAddress: string): Promise<void> {
    try {
      const positions = await this.polymarketService.getWalletPositions(walletAddress, 500);
      const snapshot = createSnapshotFromPositions(
        positions.map(p => ({
          conditionId: p.marketId,
          asset: p.marketId,
          size: p.shares,
          avgPrice: p.entryPrice || 0,
          title: p.market,
          eventSlug: p.eventSlug || p.slug || '',
          outcome: p.position,
          side: p.position,
        }))
      );

      await this.redis.set(
        REDIS_KEYS.snapshot(walletAddress),
        this.serializeSnapshot(snapshot),
        3600 * 24 // 24 hour TTL
      );

      logger.info('Stored initial snapshot', {
        wallet: walletAddress,
        positionCount: snapshot.size,
      });
    } catch (error) {
      logger.error('Failed to fetch initial snapshot', {
        wallet: walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send notifications to all subscribers of a wallet
   */
  private async notifySubscribers(
    walletAddress: string,
    changes: PositionChange[]
  ): Promise<void> {
    try {
      const subscribersData = await this.redis.hgetall(REDIS_KEYS.walletSubscribers(walletAddress));

      for (const [userId, subscriberJson] of Object.entries(subscribersData)) {
        try {
          const subscriber: WalletSubscriber = JSON.parse(subscriberJson);

          for (const change of changes) {
            const displayWallet = subscriber.alias || walletAddress;
            const message = formatNotification(change, displayWallet);

            await this.bot.telegram.sendMessage(subscriber.chatId, message, {
              parse_mode: 'Markdown',
              link_preview_options: { is_disabled: true },
            });
          }
        } catch (error) {
          logger.error('Failed to notify subscriber', {
            userId,
            wallet: walletAddress,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } catch (error) {
      logger.error('Failed to notify subscribers', {
        wallet: walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Serialize snapshot to JSON string
   */
  private serializeSnapshot(snapshot: Map<string, PositionSnapshot>): string {
    return JSON.stringify(Array.from(snapshot.entries()));
  }

  /**
   * Deserialize JSON string to snapshot map
   */
  private deserializeSnapshot(json: string): Map<string, PositionSnapshot> {
    try {
      const parsed = JSON.parse(json);
      // Handle case where it's already parsed from Redis set
      if (typeof parsed === 'string') {
        return new Map(JSON.parse(parsed));
      }
      return new Map(parsed);
    } catch (error) {
      logger.error('Failed to deserialize snapshot', { error });
      return new Map();
    }
  }

  /**
   * Format wallet address to short form
   */
  private formatShortAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  /**
   * Get tracker status
   */
  getStatus(): {
    enabled: boolean;
    isPolling: boolean;
    trackedWallets: number;
    pollIntervalMs: number;
  } {
    return {
      enabled: this.enabled,
      isPolling: this.isPolling,
      trackedWallets: this.trackedWallets.length,
      pollIntervalMs: this.pollIntervalMs,
    };
  }
}

// Export singleton factory
let trackerInstance: WalletActivityTracker | null = null;

export function createWalletActivityTracker(config: TrackerConfig): WalletActivityTracker {
  if (!trackerInstance) {
    trackerInstance = new WalletActivityTracker(config);
  }
  return trackerInstance;
}

export function getWalletActivityTracker(): WalletActivityTracker | null {
  return trackerInstance;
}
