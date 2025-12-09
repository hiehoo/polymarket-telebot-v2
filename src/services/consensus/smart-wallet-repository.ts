/**
 * Smart Wallet Repository
 * PostgreSQL persistence for smart wallet tracking and consensus signal detection
 */

import { query } from '@/services/database/connection-pool';
import { logger } from '@/utils/logger';

// Types
export interface SmartWallet {
  id: string;
  address: string;
  alias: string;
  isActive: boolean;
  createdAt: Date;
}

export interface PositionSnapshot {
  walletId: string;
  walletAddress: string;
  walletAlias: string;
  conditionId: string;
  marketTitle: string;
  marketSlug?: string;
  yesShares: number;
  noShares: number;
  yesValue: number;
  noValue: number;
  snapshotDate: Date;
}

export interface ConsensusSignal {
  id?: string;
  conditionId: string;
  marketTitle: string;
  marketSlug?: string;
  side: 'YES' | 'NO';
  walletCount: number;
  totalValue: number;
  wallets: Array<{
    alias: string;
    address: string;
    value: number;
    shares: number;
  }>;
  detectedAt?: Date;
  notifiedAt?: Date;
}

/**
 * SmartWalletRepository
 * Handles PostgreSQL persistence for smart wallet consensus tracking
 */
export class SmartWalletRepository {
  /**
   * Get all active smart wallets
   */
  async getActiveWallets(): Promise<SmartWallet[]> {
    try {
      const results = await query<{
        id: string;
        address: string;
        alias: string;
        is_active: boolean;
        created_at: Date;
      }>(
        `SELECT id, address, alias, is_active, created_at
         FROM smart_wallets
         WHERE is_active = true
         ORDER BY created_at ASC`
      );

      return results.map(r => ({
        id: r.id,
        address: r.address,
        alias: r.alias,
        isActive: r.is_active,
        createdAt: r.created_at,
      }));
    } catch (error) {
      logger.error('Failed to get active smart wallets', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Add a smart wallet
   */
  async addSmartWallet(
    address: string,
    alias: string
  ): Promise<{ success: boolean; message: string }> {
    const normalizedAddress = address.toLowerCase();

    try {
      // Check if already exists
      const existing = await query<{ id: string }>(
        `SELECT id FROM smart_wallets WHERE address = $1`,
        [normalizedAddress]
      );

      if (existing.length > 0) {
        // Reactivate if inactive
        await query(
          `UPDATE smart_wallets
           SET is_active = true, alias = $2, updated_at = NOW()
           WHERE address = $1`,
          [normalizedAddress, alias]
        );
        return { success: true, message: `Smart wallet ${alias} reactivated.` };
      }

      // Insert new wallet
      await query(
        `INSERT INTO smart_wallets (address, alias, is_active, created_at, updated_at)
         VALUES ($1, $2, true, NOW(), NOW())`,
        [normalizedAddress, alias]
      );

      logger.info('Added smart wallet', { address: normalizedAddress, alias });
      return { success: true, message: `Added smart wallet: ${alias}` };
    } catch (error) {
      logger.error('Failed to add smart wallet', {
        address: normalizedAddress,
        alias,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { success: false, message: 'Failed to add smart wallet.' };
    }
  }

  /**
   * Remove (deactivate) a smart wallet
   */
  async removeSmartWallet(address: string): Promise<{ success: boolean; message: string }> {
    const normalizedAddress = address.toLowerCase();

    try {
      const result = await query(
        `UPDATE smart_wallets
         SET is_active = false, updated_at = NOW()
         WHERE address = $1 AND is_active = true`,
        [normalizedAddress]
      );

      if ((result as any).rowCount === 0) {
        return { success: false, message: 'Smart wallet not found.' };
      }

      logger.info('Removed smart wallet', { address: normalizedAddress });
      return { success: true, message: 'Smart wallet removed.' };
    } catch (error) {
      logger.error('Failed to remove smart wallet', {
        address: normalizedAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { success: false, message: 'Failed to remove smart wallet.' };
    }
  }

  /**
   * Save position snapshot for a wallet
   */
  async savePositionSnapshot(snapshot: PositionSnapshot): Promise<void> {
    try {
      await query(
        `INSERT INTO smart_wallet_positions
         (wallet_id, condition_id, market_title, market_slug, yes_shares, no_shares, yes_value, no_value, snapshot_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (wallet_id, condition_id, snapshot_date)
         DO UPDATE SET
           market_title = EXCLUDED.market_title,
           market_slug = EXCLUDED.market_slug,
           yes_shares = EXCLUDED.yes_shares,
           no_shares = EXCLUDED.no_shares,
           yes_value = EXCLUDED.yes_value,
           no_value = EXCLUDED.no_value,
           created_at = NOW()`,
        [
          snapshot.walletId,
          snapshot.conditionId,
          snapshot.marketTitle,
          snapshot.marketSlug || null,
          snapshot.yesShares,
          snapshot.noShares,
          snapshot.yesValue,
          snapshot.noValue,
          snapshot.snapshotDate,
        ]
      );
    } catch (error) {
      logger.error('Failed to save position snapshot', {
        walletId: snapshot.walletId,
        conditionId: snapshot.conditionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get today's positions for all smart wallets
   */
  async getTodayPositions(): Promise<
    Array<{
      walletId: string;
      walletAddress: string;
      walletAlias: string;
      conditionId: string;
      marketTitle: string;
      marketSlug?: string;
      yesShares: number;
      noShares: number;
      yesValue: number;
      noValue: number;
      netShares: number;
      netValue: number;
    }>
  > {
    try {
      const results = await query<{
        wallet_id: string;
        wallet_address: string;
        wallet_alias: string;
        condition_id: string;
        market_title: string;
        market_slug: string | null;
        yes_shares: string;
        no_shares: string;
        yes_value: string;
        no_value: string;
        net_shares: string;
        net_value: string;
      }>(
        `SELECT
           p.wallet_id,
           w.address as wallet_address,
           w.alias as wallet_alias,
           p.condition_id,
           p.market_title,
           p.market_slug,
           p.yes_shares,
           p.no_shares,
           p.yes_value,
           p.no_value,
           p.net_shares,
           p.net_value
         FROM smart_wallet_positions p
         JOIN smart_wallets w ON p.wallet_id = w.id
         WHERE p.snapshot_date = CURRENT_DATE
           AND w.is_active = true
         ORDER BY w.alias, p.condition_id`
      );

      return results.map(r => ({
        walletId: r.wallet_id,
        walletAddress: r.wallet_address,
        walletAlias: r.wallet_alias,
        conditionId: r.condition_id,
        marketTitle: r.market_title,
        marketSlug: r.market_slug || undefined,
        yesShares: parseFloat(r.yes_shares),
        noShares: parseFloat(r.no_shares),
        yesValue: parseFloat(r.yes_value),
        noValue: parseFloat(r.no_value),
        netShares: parseFloat(r.net_shares),
        netValue: parseFloat(r.net_value),
      }));
    } catch (error) {
      logger.error('Failed to get today positions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Save a detected consensus signal
   */
  async saveConsensusSignal(signal: ConsensusSignal): Promise<string | null> {
    try {
      const results = await query<{ id: string }>(
        `INSERT INTO consensus_signals
         (condition_id, market_title, market_slug, consensus_side, wallet_count, total_value, wallets, detected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (condition_id, consensus_side, (detected_at::DATE))
         DO NOTHING
         RETURNING id`,
        [
          signal.conditionId,
          signal.marketTitle,
          signal.marketSlug || null,
          signal.side,
          signal.walletCount,
          signal.totalValue,
          JSON.stringify(signal.wallets),
        ]
      );

      if (results.length === 0) {
        // Already notified today
        return null;
      }

      return results[0].id;
    } catch (error) {
      logger.error('Failed to save consensus signal', {
        conditionId: signal.conditionId,
        side: signal.side,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Check if consensus was already notified today
   */
  async isAlreadyNotified(conditionId: string, side: string): Promise<boolean> {
    try {
      const results = await query<{ id: string }>(
        `SELECT id FROM consensus_signals
         WHERE condition_id = $1
           AND consensus_side = $2
           AND detected_at::DATE = CURRENT_DATE
           AND notified_at IS NOT NULL`,
        [conditionId, side]
      );

      return results.length > 0;
    } catch (error) {
      logger.error('Failed to check if already notified', {
        conditionId,
        side,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Mark consensus as notified
   */
  async markAsNotified(signalId: string): Promise<void> {
    try {
      await query(
        `UPDATE consensus_signals SET notified_at = NOW() WHERE id = $1`,
        [signalId]
      );
    } catch (error) {
      logger.error('Failed to mark as notified', {
        signalId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get recent consensus signals
   */
  async getRecentSignals(days: number = 7): Promise<ConsensusSignal[]> {
    try {
      const results = await query<{
        id: string;
        condition_id: string;
        market_title: string;
        market_slug: string | null;
        consensus_side: string;
        wallet_count: number;
        total_value: string;
        wallets: string;
        detected_at: Date;
        notified_at: Date | null;
      }>(
        `SELECT id, condition_id, market_title, market_slug, consensus_side,
                wallet_count, total_value, wallets, detected_at, notified_at
         FROM consensus_signals
         WHERE detected_at >= NOW() - INTERVAL '${days} days'
         ORDER BY detected_at DESC`
      );

      return results.map(r => ({
        id: r.id,
        conditionId: r.condition_id,
        marketTitle: r.market_title,
        marketSlug: r.market_slug || undefined,
        side: r.consensus_side as 'YES' | 'NO',
        walletCount: r.wallet_count,
        totalValue: parseFloat(r.total_value),
        wallets: typeof r.wallets === 'string' ? JSON.parse(r.wallets) : r.wallets,
        detectedAt: r.detected_at,
        notifiedAt: r.notified_at || undefined,
      }));
    } catch (error) {
      logger.error('Failed to get recent signals', {
        days,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Clean up old position snapshots (keep last N days)
   */
  async cleanupOldSnapshots(keepDays: number = 30): Promise<number> {
    try {
      const result = await query(
        `DELETE FROM smart_wallet_positions
         WHERE snapshot_date < CURRENT_DATE - INTERVAL '${keepDays} days'`
      );

      const deleted = (result as any).rowCount || 0;
      if (deleted > 0) {
        logger.info('Cleaned up old position snapshots', { deleted, keepDays });
      }
      return deleted;
    } catch (error) {
      logger.error('Failed to cleanup old snapshots', {
        keepDays,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}

// Singleton
let repositoryInstance: SmartWalletRepository | null = null;

export function getSmartWalletRepository(): SmartWalletRepository {
  if (!repositoryInstance) {
    repositoryInstance = new SmartWalletRepository();
  }
  return repositoryInstance;
}
