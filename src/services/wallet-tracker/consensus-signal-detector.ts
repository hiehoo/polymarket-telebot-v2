/**
 * Consensus Signal Detector
 * Detects when multiple tracked traders hold/buy the same market position
 * Signals when 2+ traders have same-side positions with combined value >= threshold
 */

import { EventEmitter } from 'events';
import { PositionSnapshot, PositionChange } from './position-diff-detector';
import { logger } from '@/utils/logger';

// Configuration defaults
const DEFAULT_MIN_TRADERS = 2;
const DEFAULT_MIN_VALUE = 500; // $500 minimum combined entry value
const DEFAULT_COOLDOWN_MS = 3600000; // 1 hour cooldown per market

export interface ConsensusConfig {
  minTraders: number;
  minValue: number;
  cooldownMs: number;
  enabled: boolean;
}

export interface TraderPosition {
  wallet: string;
  alias?: string;
  size: number;
  avgPrice: number;
  entryValue: number; // size * avgPrice
  lastChange: 'NEW' | 'BUY' | 'SELL' | 'EXISTING';
  timestamp: number;
}

export interface MarketConsensus {
  conditionId: string;
  positionKey: string; // conditionId:outcome
  marketTitle: string;
  outcome: string;
  traders: TraderPosition[];
  totalEntryValue: number;
  traderCount: number;
  hasRecentActivity: boolean; // Any trader just bought
}

export interface ConsensusSignal extends MarketConsensus {
  signalId: string;
  triggeredAt: number;
  triggeredBy: string; // Wallet that triggered the signal
}

/**
 * ConsensusSignalDetector
 * Maintains market position index and detects consensus across traders
 */
export class ConsensusSignalDetector extends EventEmitter {
  // Map<positionKey, Map<wallet, TraderPosition>>
  private marketIndex: Map<string, Map<string, TraderPosition>> = new Map();

  // Map<positionKey, timestamp> - Tracks last signal time per market
  private signalCooldowns: Map<string, number> = new Map();

  // Wallet aliases cache
  private walletAliases: Map<string, string> = new Map();

  private config: ConsensusConfig;
  private isInitializing: boolean = true;

  constructor(config?: Partial<ConsensusConfig>) {
    super();
    this.config = {
      minTraders: config?.minTraders ?? DEFAULT_MIN_TRADERS,
      minValue: config?.minValue ?? DEFAULT_MIN_VALUE,
      cooldownMs: config?.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      enabled: config?.enabled ?? true,
    };

    logger.info('ConsensusSignalDetector initialized', {
      minTraders: this.config.minTraders,
      minValue: this.config.minValue,
      cooldownMs: this.config.cooldownMs,
    });
  }

  /**
   * Mark initialization complete - start detecting signals
   */
  markInitialized(): void {
    this.isInitializing = false;
    logger.info('ConsensusSignalDetector ready for signal detection');
  }

  /**
   * Set wallet alias for display purposes
   */
  setWalletAlias(wallet: string, alias: string): void {
    this.walletAliases.set(wallet.toLowerCase(), alias);
  }

  /**
   * Update position in the market index
   * Called when a position change is detected
   */
  updatePosition(
    wallet: string,
    position: PositionSnapshot,
    changeType: PositionChange['type']
  ): ConsensusSignal | null {
    if (!this.config.enabled) return null;

    const walletLower = wallet.toLowerCase();
    const positionKey = `${position.conditionId}:${position.outcome}`;

    // Get or create market entry
    let marketPositions = this.marketIndex.get(positionKey);
    if (!marketPositions) {
      marketPositions = new Map();
      this.marketIndex.set(positionKey, marketPositions);
    }

    // Update trader position
    const entryValue = position.size * position.avgPrice;
    const traderPosition: TraderPosition = {
      wallet: walletLower,
      alias: this.walletAliases.get(walletLower),
      size: position.size,
      avgPrice: position.avgPrice,
      entryValue,
      lastChange: changeType === 'CLOSED' || changeType === 'SELL' ? 'SELL' : changeType,
      timestamp: Date.now(),
    };

    if (changeType === 'CLOSED') {
      // Remove position
      marketPositions.delete(walletLower);
      if (marketPositions.size === 0) {
        this.marketIndex.delete(positionKey);
      }
      return null;
    }

    marketPositions.set(walletLower, traderPosition);

    // Check for consensus signal
    return this.checkConsensus(positionKey, walletLower, position.title);
  }

  /**
   * Remove wallet's position from index
   */
  removePosition(wallet: string, positionKey: string): void {
    const walletLower = wallet.toLowerCase();
    const marketPositions = this.marketIndex.get(positionKey);

    if (marketPositions) {
      marketPositions.delete(walletLower);
      if (marketPositions.size === 0) {
        this.marketIndex.delete(positionKey);
      }
    }
  }

  /**
   * Check if a market position has consensus
   * Returns signal if criteria met and not in cooldown
   */
  private checkConsensus(
    positionKey: string,
    triggeredBy: string,
    marketTitle: string
  ): ConsensusSignal | null {
    // Skip during initialization to avoid false signals
    if (this.isInitializing) return null;

    const marketPositions = this.marketIndex.get(positionKey);
    if (!marketPositions || marketPositions.size < this.config.minTraders) {
      return null;
    }

    // Calculate totals
    const traders = Array.from(marketPositions.values());
    const totalEntryValue = traders.reduce((sum, t) => sum + t.entryValue, 0);

    // Check threshold
    if (totalEntryValue < this.config.minValue) {
      return null;
    }

    // Check cooldown
    if (!this.shouldSignal(positionKey)) {
      logger.debug('Consensus signal skipped - in cooldown', { positionKey });
      return null;
    }

    // Parse position key
    const [conditionId, outcome] = positionKey.split(':');

    // Check if any trader has recent activity (NEW or BUY)
    const hasRecentActivity = traders.some(
      t => t.lastChange === 'NEW' || t.lastChange === 'BUY'
    );

    const consensus: MarketConsensus = {
      conditionId,
      positionKey,
      marketTitle,
      outcome,
      traders,
      totalEntryValue,
      traderCount: traders.length,
      hasRecentActivity,
    };

    const signal: ConsensusSignal = {
      ...consensus,
      signalId: `${positionKey}:${Date.now()}`,
      triggeredAt: Date.now(),
      triggeredBy,
    };

    // Update cooldown
    this.signalCooldowns.set(positionKey, Date.now());

    // Emit signal event
    this.emit('consensus', signal);

    logger.info('Consensus signal detected', {
      positionKey,
      traderCount: signal.traderCount,
      totalValue: signal.totalEntryValue.toFixed(2),
      triggeredBy,
    });

    return signal;
  }

  /**
   * Check if signal should be emitted (not in cooldown)
   */
  private shouldSignal(positionKey: string): boolean {
    const lastSignal = this.signalCooldowns.get(positionKey);
    if (!lastSignal) return true;

    return Date.now() - lastSignal >= this.config.cooldownMs;
  }

  /**
   * Get all current market consensuses (for status/debugging)
   */
  getActiveConsensuses(): MarketConsensus[] {
    const consensuses: MarketConsensus[] = [];

    for (const [positionKey, positions] of this.marketIndex) {
      if (positions.size < this.config.minTraders) continue;

      const traders = Array.from(positions.values());
      const totalEntryValue = traders.reduce((sum, t) => sum + t.entryValue, 0);

      if (totalEntryValue < this.config.minValue) continue;

      const [conditionId, outcome] = positionKey.split(':');
      const hasRecentActivity = traders.some(
        t => t.lastChange === 'NEW' || t.lastChange === 'BUY'
      );

      consensuses.push({
        conditionId,
        positionKey,
        marketTitle: traders[0]?.alias || 'Unknown', // TODO: Store title
        outcome,
        traders,
        totalEntryValue,
        traderCount: traders.length,
        hasRecentActivity,
      });
    }

    return consensuses;
  }

  /**
   * Get market positions for a specific condition
   */
  getMarketPositions(conditionId: string): Map<string, TraderPosition[]> {
    const result = new Map<string, TraderPosition[]>();

    for (const [positionKey, positions] of this.marketIndex) {
      if (positionKey.startsWith(conditionId)) {
        const [, outcome] = positionKey.split(':');
        result.set(outcome, Array.from(positions.values()));
      }
    }

    return result;
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    totalMarkets: number;
    totalPositions: number;
    activeConsensuses: number;
    cooldownCount: number;
  } {
    let totalPositions = 0;
    for (const positions of this.marketIndex.values()) {
      totalPositions += positions.size;
    }

    return {
      totalMarkets: this.marketIndex.size,
      totalPositions,
      activeConsensuses: this.getActiveConsensuses().length,
      cooldownCount: this.signalCooldowns.size,
    };
  }

  /**
   * Clear all data (for testing or reset)
   */
  clear(): void {
    this.marketIndex.clear();
    this.signalCooldowns.clear();
    this.walletAliases.clear();
    this.isInitializing = true;
  }

  /**
   * Prune stale data older than maxAge
   */
  prune(maxAgeMs: number = 86400000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [positionKey, positions] of this.marketIndex) {
      for (const [wallet, position] of positions) {
        if (position.timestamp < cutoff) {
          positions.delete(wallet);
          pruned++;
        }
      }
      if (positions.size === 0) {
        this.marketIndex.delete(positionKey);
      }
    }

    // Prune old cooldowns
    for (const [key, timestamp] of this.signalCooldowns) {
      if (timestamp < cutoff) {
        this.signalCooldowns.delete(key);
      }
    }

    if (pruned > 0) {
      logger.info('Pruned stale consensus data', { pruned });
    }

    return pruned;
  }
}

/**
 * Format consensus signal for Telegram notification
 */
export function formatConsensusNotification(signal: ConsensusSignal): string {
  const lines: string[] = [];

  // Header
  lines.push('🔔 *CONSENSUS SIGNAL*');
  lines.push('');

  // Market info
  lines.push(`📊 *Market:* ${escapeMarkdown(signal.marketTitle)}`);
  lines.push(`📈 *Side:* ${signal.outcome}`);
  lines.push(`👥 *Traders:* ${signal.traderCount}`);
  lines.push(`💰 *Combined:* $${signal.totalEntryValue.toFixed(0)}`);
  lines.push('');

  // Positions
  lines.push('*Positions:*');
  for (const trader of signal.traders) {
    const shortWallet = `${trader.wallet.slice(0, 6)}...${trader.wallet.slice(-4)}`;
    const name = trader.alias || shortWallet;
    const value = trader.entryValue.toFixed(0);
    const changeIcon = trader.lastChange === 'NEW' || trader.lastChange === 'BUY' ? '🟢' : '⚪';
    lines.push(`${changeIcon} ${escapeMarkdown(name)}: $${value}`);
  }

  lines.push('');
  lines.push(`🕐 ${new Date(signal.triggeredAt).toLocaleTimeString()}`);

  return lines.join('\n');
}

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// Factory function
export function createConsensusSignalDetector(
  config?: Partial<ConsensusConfig>
): ConsensusSignalDetector {
  return new ConsensusSignalDetector(config);
}
