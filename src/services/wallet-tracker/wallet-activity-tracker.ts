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
  getPositionKey,
} from './position-diff-detector';
import {
  ConsensusSignalDetector,
  ConsensusSignal,
  formatConsensusNotification,
  createConsensusSignalDetector,
} from './consensus-signal-detector';
import {
  WalletTrackerRepository,
  getWalletTrackerRepository,
} from './wallet-tracker-repository';
import { config } from '@/config';

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

// Redis key patterns - only for ephemeral cache data (snapshots)
const REDIS_KEYS = {
  snapshot: (wallet: string) => `wallet_tracker:snapshot:${wallet.toLowerCase()}`,
};

export class WalletActivityTracker {
  private redis: SimpleRedisClient;
  private polymarketService: PolymarketService;
  private bot: Telegraf<Context>;
  private repository: WalletTrackerRepository;
  private pollIntervalMs: number;
  private maxWallets: number;
  private enabled: boolean;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private pollIndex = 0;
  private trackedWallets: string[] = [];
  private consensusDetector: ConsensusSignalDetector;
  private isInitialLoad = true;

  constructor(trackerConfig: TrackerConfig) {
    this.redis = trackerConfig.redis;
    this.polymarketService = trackerConfig.polymarketService;
    this.bot = trackerConfig.bot;
    this.repository = getWalletTrackerRepository();
    this.pollIntervalMs = trackerConfig.pollIntervalMs || 60000; // 60 seconds default
    this.maxWallets = trackerConfig.maxWallets || 100;
    this.enabled = trackerConfig.enabled !== false;

    // Initialize consensus detector
    this.consensusDetector = createConsensusSignalDetector({
      enabled: config.consensus.enabled,
      minTraders: config.consensus.minTraders,
      minValue: config.consensus.minValue,
      cooldownMs: config.consensus.cooldownMs,
    });

    // Listen for consensus signals
    this.consensusDetector.on('consensus', (signal: ConsensusSignal) => {
      this.handleConsensusSignal(signal);
    });
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

      // Build initial consensus index from existing snapshots
      await this.buildInitialConsensusIndex();

      // Mark initial load complete - consensus detector can now emit signals
      this.isInitialLoad = false;
      this.consensusDetector.markInitialized();

      // Start polling
      this.startPolling();

      logger.info('Wallet Activity Tracker initialized', {
        trackedWallets: this.trackedWallets.length,
        pollIntervalMs: this.pollIntervalMs,
        consensusStats: this.consensusDetector.getStats(),
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
   * Uses PostgreSQL for persistent storage
   */
  async startTracking(
    walletAddress: string,
    userId: number,
    chatId: number,
    alias?: string
  ): Promise<{ success: boolean; message: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      // Check global max wallets
      if (this.trackedWallets.length >= this.maxWallets) {
        return {
          success: false,
          message: 'System wallet tracking limit reached. Try again later.',
        };
      }

      // Add to PostgreSQL (handles limit check internally)
      const result = await this.repository.addTrackedWallet(userId, chatId, normalizedWallet, alias);

      if (!result.success) {
        return result;
      }

      // Fetch and store initial snapshot in Redis cache
      await this.fetchAndStoreSnapshot(normalizedWallet);

      // Update local cache
      if (!this.trackedWallets.includes(normalizedWallet)) {
        this.trackedWallets.push(normalizedWallet);
      }

      // Set wallet alias in consensus detector
      if (alias) {
        this.consensusDetector.setWalletAlias(normalizedWallet, alias);
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
   * Uses PostgreSQL for persistent storage
   */
  async stopTracking(
    walletAddress: string,
    userId: number
  ): Promise<{ success: boolean; message: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    try {
      // Remove from PostgreSQL
      const result = await this.repository.removeTrackedWallet(userId, normalizedWallet);

      if (result.success) {
        // Check if any other users are tracking this wallet
        const subscribers = await this.repository.getWalletSubscribers(normalizedWallet);
        if (subscribers.length === 0) {
          // No more subscribers, clean up Redis snapshot cache
          await this.redis.del(REDIS_KEYS.snapshot(normalizedWallet));

          // Update local cache
          this.trackedWallets = this.trackedWallets.filter(w => w !== normalizedWallet);
        }

        logger.info('Stopped tracking wallet', { wallet: normalizedWallet, userId });
      }

      return result;
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
   * Uses PostgreSQL for persistent storage
   */
  async getUserTrackedWallets(userId: number): Promise<string[]> {
    try {
      const wallets = await this.repository.getUserTrackedWallets(userId);
      return wallets.map(w => w.address);
    } catch (error) {
      logger.error('Failed to get user tracked wallets', { userId, error });
      return [];
    }
  }

  /**
   * Check if user is tracking a wallet
   * Uses PostgreSQL for persistent storage
   */
  async isUserTrackingWallet(userId: number, walletAddress: string): Promise<boolean> {
    try {
      return await this.repository.isUserTrackingWallet(userId, walletAddress);
    } catch (error) {
      logger.error('Failed to check if user is tracking wallet', { userId, walletAddress, error });
      return false;
    }
  }

  /**
   * Load tracked wallets from PostgreSQL
   */
  private async loadTrackedWallets(): Promise<void> {
    try {
      this.trackedWallets = await this.repository.getAllTrackedWallets();
      logger.info('Loaded tracked wallets from PostgreSQL', { count: this.trackedWallets.length });
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

    // Update consensus detector with current positions (always, for index maintenance)
    this.updateConsensusIndex(walletAddress, currentSnapshot, changes);

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
   * Uses PostgreSQL for subscriber lookup
   */
  private async notifySubscribers(
    walletAddress: string,
    changes: PositionChange[]
  ): Promise<void> {
    try {
      const subscribers = await this.repository.getWalletSubscribers(walletAddress);

      for (const subscriber of subscribers) {
        try {
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
            odoo: subscriber.userId,
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
   * Build initial consensus index from existing snapshots
   * Uses PostgreSQL for wallet aliases
   */
  private async buildInitialConsensusIndex(): Promise<void> {
    logger.info('Building initial consensus index...');

    // Load all wallet aliases from PostgreSQL
    const aliases = await this.repository.getAllWalletAliases();
    for (const [wallet, alias] of aliases) {
      this.consensusDetector.setWalletAlias(wallet, alias);
    }

    for (const wallet of this.trackedWallets) {
      try {
        const snapshotJson = await this.redis.get(REDIS_KEYS.snapshot(wallet));
        if (!snapshotJson) continue;

        const snapshot = this.deserializeSnapshot(snapshotJson);

        // Add all positions to index as EXISTING
        for (const position of snapshot.values()) {
          this.consensusDetector.updatePosition(wallet, position, 'EXISTING' as any);
        }
      } catch (error) {
        logger.error('Failed to load snapshot for consensus index', {
          wallet,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Consensus index built', {
      stats: this.consensusDetector.getStats(),
    });
  }

  /**
   * Update consensus index with position changes
   */
  private updateConsensusIndex(
    walletAddress: string,
    currentSnapshot: Map<string, PositionSnapshot>,
    changes: PositionChange[]
  ): void {
    // Create a map of changes by position key for quick lookup
    const changeMap = new Map<string, PositionChange>();
    for (const change of changes) {
      const key = `${change.conditionId}:${change.outcome}`;
      changeMap.set(key, change);
    }

    // Update all current positions
    for (const [positionKey, position] of currentSnapshot) {
      const change = changeMap.get(positionKey);
      const changeType = change?.type || 'EXISTING';
      this.consensusDetector.updatePosition(walletAddress, position, changeType as any);
    }

    // Handle closed positions
    for (const change of changes) {
      if (change.type === 'CLOSED') {
        const positionKey = `${change.conditionId}:${change.outcome}`;
        this.consensusDetector.removePosition(walletAddress, positionKey);
      }
    }
  }

  /**
   * Handle consensus signal - send notifications to all relevant subscribers
   * Uses PostgreSQL for subscriber lookup
   */
  private async handleConsensusSignal(signal: ConsensusSignal): Promise<void> {
    try {
      logger.info('Handling consensus signal', {
        market: signal.marketTitle,
        outcome: signal.outcome,
        traders: signal.traderCount,
        totalValue: signal.totalEntryValue,
      });

      // Get all unique subscribers across all traders in the consensus
      const allSubscribers = new Map<number, { chatId: number; alias?: string }>();

      for (const trader of signal.traders) {
        const subscribers = await this.repository.getWalletSubscribers(trader.wallet);

        for (const subscriber of subscribers) {
          // Only add if not already present (avoid duplicate notifications)
          if (!allSubscribers.has(subscriber.userId)) {
            allSubscribers.set(subscriber.userId, {
              chatId: subscriber.chatId,
              alias: subscriber.alias,
            });
          }
        }
      }

      // Send consensus notification to all subscribers
      const message = formatConsensusNotification(signal);

      for (const [userId, subscriber] of allSubscribers) {
        try {
          await this.bot.telegram.sendMessage(subscriber.chatId, message, {
            parse_mode: 'MarkdownV2',
            link_preview_options: { is_disabled: true },
          });
        } catch (error) {
          logger.error('Failed to send consensus notification', {
            userId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info('Consensus notifications sent', {
        signalId: signal.signalId,
        recipientCount: allSubscribers.size,
      });
    } catch (error) {
      logger.error('Failed to handle consensus signal', {
        signalId: signal.signalId,
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
    consensus: {
      enabled: boolean;
      totalMarkets: number;
      totalPositions: number;
      activeConsensuses: number;
    };
  } {
    const consensusStats = this.consensusDetector.getStats();
    return {
      enabled: this.enabled,
      isPolling: this.isPolling,
      trackedWallets: this.trackedWallets.length,
      pollIntervalMs: this.pollIntervalMs,
      consensus: {
        enabled: config.consensus.enabled,
        totalMarkets: consensusStats.totalMarkets,
        totalPositions: consensusStats.totalPositions,
        activeConsensuses: consensusStats.activeConsensuses,
      },
    };
  }

  /**
   * Get active consensus signals
   */
  getActiveConsensuses(): ReturnType<ConsensusSignalDetector['getActiveConsensuses']> {
    return this.consensusDetector.getActiveConsensuses();
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
