/**
 * Smart Wallet Scanner
 * Daily batch job to scan predefined smart wallets and detect consensus signals
 */

import { Telegraf, Context } from 'telegraf';
import { PolymarketRestClient } from '@/services/polymarket/rest-client';
import { logger } from '@/utils/logger';
import { config } from '@/config';
import {
  SmartWalletRepository,
  getSmartWalletRepository,
  SmartWallet,
  ConsensusSignal as RepoConsensusSignal,
} from './smart-wallet-repository';
import {
  WalletPosition,
  ConsensusSignal,
  DetectorConfig,
  detectConsensus,
  calculateSide,
} from './consensus-detector';
import {
  formatConsensusNotification,
  formatScanStatus,
} from './consensus-notification';

export interface ScannerConfig {
  enabled: boolean;
  cronSchedule: string;       // e.g., '0 6 * * *' for 6 AM daily
  minWallets: number;         // Minimum wallets for consensus (default: 3)
  minOrderValue: number;      // Minimum order value in USD (default: 2000)
  minPortfolioPercent: number; // Minimum % of portfolio (default: 2)
  scanDelayMs: number;        // Delay between wallet fetches (default: 1000)
  notifyChat?: number;        // Chat ID for notifications (optional, broadcasts to all users if not set)
}

const DEFAULT_CONFIG: ScannerConfig = {
  enabled: true,
  cronSchedule: '0 6 * * *',
  minWallets: 3,
  minOrderValue: 2000,
  minPortfolioPercent: 2,
  scanDelayMs: 1000,
};

export class SmartWalletScanner {
  private repository: SmartWalletRepository;
  private polymarketClient: PolymarketRestClient;
  private bot: Telegraf<Context>;
  private config: ScannerConfig;
  private cronInterval: NodeJS.Timeout | null = null;
  private isScanning = false;
  private lastScanTime: Date | null = null;
  // Muted chats (opt-out list) - default behavior is broadcast to all
  private mutedChats: Set<number> = new Set();
  // Callback to get all active chat IDs for broadcast
  private getActiveChatIds: (() => Promise<number[]>) | null = null;

  constructor(
    bot: Telegraf<Context>,
    polymarketClient: PolymarketRestClient,
    scannerConfig?: Partial<ScannerConfig>
  ) {
    this.bot = bot;
    this.polymarketClient = polymarketClient;
    this.repository = getSmartWalletRepository();
    this.config = { ...DEFAULT_CONFIG, ...scannerConfig };
  }

  /**
   * Set callback to get active chat IDs for broadcast
   */
  setActiveChatIdsProvider(provider: () => Promise<number[]>): void {
    this.getActiveChatIds = provider;
  }

  /**
   * Subscribe a chat (remove from muted list)
   */
  subscribeChat(chatId: number): void {
    this.mutedChats.delete(chatId);
    logger.info('Chat subscribed to consensus notifications', { chatId });
  }

  /**
   * Unsubscribe (mute) a chat from consensus notifications
   */
  unsubscribeChat(chatId: number): void {
    this.mutedChats.add(chatId);
    logger.info('Chat muted consensus notifications', { chatId });
  }

  /**
   * Check if chat is subscribed (not muted)
   */
  isSubscribed(chatId: number): boolean {
    return !this.mutedChats.has(chatId);
  }

  /**
   * Get broadcast chat IDs (all active chats minus muted ones)
   */
  private async getBroadcastChatIds(): Promise<number[]> {
    if (!this.getActiveChatIds) {
      logger.warn('No active chat IDs provider set, no broadcasts will be sent');
      return [];
    }

    const allChats = await this.getActiveChatIds();
    return allChats.filter(chatId => !this.mutedChats.has(chatId));
  }

  /**
   * Start the scanner with cron schedule
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Smart Wallet Scanner is disabled');
      return;
    }

    // Parse cron schedule and set up interval
    // For simplicity, we'll check every hour and run if it matches the schedule
    const checkInterval = 60 * 60 * 1000; // 1 hour

    this.cronInterval = setInterval(async () => {
      if (this.shouldRunNow()) {
        await this.scan();
      }
    }, checkInterval);

    logger.info('Smart Wallet Scanner started', {
      cronSchedule: this.config.cronSchedule,
      minWallets: this.config.minWallets,
    });
  }

  /**
   * Stop the scanner
   */
  stop(): void {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }
    logger.info('Smart Wallet Scanner stopped');
  }

  /**
   * Check if scanner should run now based on cron schedule
   */
  private shouldRunNow(): boolean {
    const now = new Date();

    // Parse simple cron: '0 6 * * *' = 6:00 AM daily
    const [minute, hour] = this.config.cronSchedule.split(' ').map(Number);

    if (now.getHours() === hour && now.getMinutes() === minute) {
      // Check if we already ran today
      if (this.lastScanTime) {
        const lastDate = this.lastScanTime.toDateString();
        const todayDate = now.toDateString();
        if (lastDate === todayDate) {
          return false; // Already ran today
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Manually trigger a scan
   */
  async scan(): Promise<ConsensusSignal[]> {
    if (this.isScanning) {
      logger.warn('Scan already in progress, skipping');
      return [];
    }

    this.isScanning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting smart wallet consensus scan...');

      // 1. Load smart wallets
      const wallets = await this.repository.getActiveWallets();
      if (wallets.length === 0) {
        logger.info('No smart wallets configured');
        return [];
      }

      logger.info(`Scanning ${wallets.length} smart wallets`);

      // 2. Fetch positions for each wallet
      const allPositions = await this.fetchAllWalletPositions(wallets);

      // 3. Detect consensus signals
      const detectorConfig: DetectorConfig = {
        minWallets: this.config.minWallets,
        minOrderValue: this.config.minOrderValue,
        minPortfolioPercent: this.config.minPortfolioPercent,
      };

      const signals = detectConsensus(allPositions, detectorConfig);

      // 4. Notify for new signals
      await this.notifySignals(signals);

      // 5. Update last scan time
      this.lastScanTime = new Date();
      const duration = Date.now() - startTime;

      logger.info('Consensus scan complete', {
        walletsScanned: wallets.length,
        positionsFound: allPositions.length,
        signalsDetected: signals.length,
        durationMs: duration,
      });

      // 6. Send status to subscribed chats
      const statusMessage = formatScanStatus(
        wallets.length,
        allPositions.length,
        signals.length,
        duration
      );

      // Broadcast status to all active (non-muted) chats
      const broadcastChats = await this.getBroadcastChatIds();
      for (const chatId of broadcastChats) {
        try {
          await this.bot.telegram.sendMessage(chatId, statusMessage, {
            parse_mode: 'Markdown',
          });
        } catch (error) {
          logger.error('Failed to send scan status', { chatId, error });
        }
      }

      return signals;
    } catch (error) {
      logger.error('Consensus scan failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Fetch positions for all wallets
   */
  private async fetchAllWalletPositions(wallets: SmartWallet[]): Promise<WalletPosition[]> {
    const allPositions: WalletPosition[] = [];

    for (const wallet of wallets) {
      try {
        const positions = await this.fetchWalletPositions(wallet);
        allPositions.push(...positions);

        // Delay between API calls to respect rate limits
        await this.delay(this.config.scanDelayMs);
      } catch (error) {
        logger.error('Failed to fetch positions for wallet', {
          wallet: wallet.address,
          alias: wallet.alias,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other wallets
      }
    }

    return allPositions;
  }

  /**
   * Fetch and process positions for a single wallet
   */
  private async fetchWalletPositions(wallet: SmartWallet): Promise<WalletPosition[]> {
    // Fetch positions from Polymarket API
    const rawPositions = await this.polymarketClient.getPositions({
      user: wallet.address,
      limit: 500,
    });

    if (!rawPositions || rawPositions.length === 0) {
      return [];
    }

    // Calculate total portfolio value
    const portfolioValue = rawPositions.reduce((sum, p) => {
      const value = (p.size || 0) * (p.avgPrice || p.price || 0);
      return sum + value;
    }, 0);

    // Group positions by conditionId to calculate net position
    const byCondition = new Map<string, {
      yesShares: number;
      noShares: number;
      yesValue: number;
      noValue: number;
      marketTitle: string;
      marketSlug?: string;
    }>();

    for (const pos of rawPositions) {
      const conditionId = pos.conditionId;
      if (!conditionId) continue;

      const existing = byCondition.get(conditionId) || {
        yesShares: 0,
        noShares: 0,
        yesValue: 0,
        noValue: 0,
        marketTitle: pos.title || 'Unknown',
        marketSlug: pos.slug || pos.eventSlug,
      };

      const shares = pos.size || 0;
      const price = pos.avgPrice || pos.price || 0;
      const value = shares * price;
      const outcome = (pos.outcome || pos.side || '').toUpperCase();

      if (outcome === 'YES' || outcome === 'Y' || outcome === '1') {
        existing.yesShares += shares;
        existing.yesValue += value;
      } else if (outcome === 'NO' || outcome === 'N' || outcome === '0') {
        existing.noShares += shares;
        existing.noValue += value;
      }

      byCondition.set(conditionId, existing);
    }

    // Convert to WalletPosition format
    const positions: WalletPosition[] = [];

    for (const [conditionId, data] of byCondition) {
      const netShares = data.yesShares - data.noShares;
      const netValue = data.yesValue - data.noValue;
      const side = calculateSide(netShares);

      // Skip neutral positions
      if (side === 'NEUTRAL') continue;

      const absValue = Math.abs(netValue);
      const portfolioPercent = portfolioValue > 0 ? (absValue / portfolioValue) * 100 : 0;

      positions.push({
        walletId: wallet.id,
        walletAddress: wallet.address,
        walletAlias: wallet.alias,
        conditionId,
        marketTitle: data.marketTitle,
        marketSlug: data.marketSlug,
        yesShares: data.yesShares,
        noShares: data.noShares,
        yesValue: data.yesValue,
        noValue: data.noValue,
        netShares,
        netValue,
        portfolioValue,
        portfolioPercent,
        side,
      });

      // Save snapshot to database (optional, for historical tracking)
      try {
        await this.repository.savePositionSnapshot({
          walletId: wallet.id,
          walletAddress: wallet.address,
          walletAlias: wallet.alias,
          conditionId,
          marketTitle: data.marketTitle,
          marketSlug: data.marketSlug,
          yesShares: data.yesShares,
          noShares: data.noShares,
          yesValue: data.yesValue,
          noValue: data.noValue,
          snapshotDate: new Date(),
        });
      } catch (error) {
        // Non-critical, continue
        logger.debug('Failed to save position snapshot', { conditionId, error });
      }
    }

    return positions;
  }

  /**
   * Notify all users about detected consensus signals (broadcast by default)
   */
  private async notifySignals(signals: ConsensusSignal[]): Promise<void> {
    if (signals.length === 0) return;

    // Get broadcast chat IDs once (all active minus muted)
    const broadcastChats = await this.getBroadcastChatIds();
    if (broadcastChats.length === 0) {
      logger.info('No chats to broadcast consensus signals to');
      return;
    }

    for (const signal of signals) {
      // Check if already notified today
      const alreadyNotified = await this.repository.isAlreadyNotified(
        signal.conditionId,
        signal.side
      );

      if (alreadyNotified) {
        logger.debug('Signal already notified today, skipping', {
          conditionId: signal.conditionId,
          side: signal.side,
        });
        continue;
      }

      // Save signal to database
      const signalId = await this.repository.saveConsensusSignal({
        conditionId: signal.conditionId,
        marketTitle: signal.marketTitle,
        marketSlug: signal.marketSlug,
        side: signal.side,
        walletCount: signal.walletCount,
        totalValue: signal.totalValue,
        wallets: signal.wallets.map(w => ({
          alias: w.alias,
          address: w.address,
          value: w.value,
          shares: w.shares,
        })),
      });

      if (!signalId) {
        // Already exists or failed to save
        continue;
      }

      // Format and broadcast notification to all non-muted users
      const message = formatConsensusNotification(signal);

      for (const chatId of broadcastChats) {
        try {
          await this.bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
          });

          logger.info('Sent consensus notification', {
            chatId,
            conditionId: signal.conditionId,
            side: signal.side,
            walletCount: signal.walletCount,
          });
        } catch (error) {
          logger.error('Failed to send consensus notification', {
            chatId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Mark as notified
      await this.repository.markAsNotified(signalId);
    }
  }

  /**
   * Get scanner status
   */
  getStatus(): {
    enabled: boolean;
    isScanning: boolean;
    lastScanTime: Date | null;
    mutedChats: number;
    config: ScannerConfig;
  } {
    return {
      enabled: this.config.enabled,
      isScanning: this.isScanning,
      lastScanTime: this.lastScanTime,
      mutedChats: this.mutedChats.size,
      config: this.config,
    };
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton
let scannerInstance: SmartWalletScanner | null = null;

export function createSmartWalletScanner(
  bot: Telegraf<Context>,
  polymarketClient: PolymarketRestClient,
  config?: Partial<ScannerConfig>
): SmartWalletScanner {
  if (!scannerInstance) {
    scannerInstance = new SmartWalletScanner(bot, polymarketClient, config);
  }
  return scannerInstance;
}

export function getSmartWalletScanner(): SmartWalletScanner | null {
  return scannerInstance;
}
