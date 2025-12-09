/**
 * Consensus Detector
 * Detects when 3+ smart wallets agree on same market side
 * Calculates confidence scores based on multiple factors
 */

import { logger } from '@/utils/logger';

// Types
export interface WalletPosition {
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
  portfolioValue: number;
  portfolioPercent: number;
  side: 'YES' | 'NO' | 'NEUTRAL';
}

export interface ConsensusSignal {
  conditionId: string;
  marketTitle: string;
  marketSlug?: string;
  side: 'YES' | 'NO';
  walletCount: number;
  totalValue: number;
  avgValue: number;
  confidenceScore: number;
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  wallets: Array<{
    alias: string;
    address: string;
    value: number;
    shares: number;
    portfolioPercent: number;
  }>;
}

export interface DetectorConfig {
  minWallets: number;          // Minimum wallets for consensus (default: 3)
  minOrderValue: number;       // Minimum order value in USD (default: 2000)
  minPortfolioPercent: number; // Minimum % of portfolio (default: 2)
}

const DEFAULT_CONFIG: DetectorConfig = {
  minWallets: 3,
  minOrderValue: 2000,
  minPortfolioPercent: 2,
};

/**
 * Calculate side from net position
 */
export function calculateSide(netShares: number): 'YES' | 'NO' | 'NEUTRAL' {
  if (netShares > 0) return 'YES';
  if (netShares < 0) return 'NO';
  return 'NEUTRAL';
}

/**
 * Check if position is significant (>$2K OR 2%+ of portfolio)
 */
export function isSignificantPosition(
  position: WalletPosition,
  config: DetectorConfig = DEFAULT_CONFIG
): boolean {
  const absValue = Math.abs(position.netValue);

  // Check absolute value threshold
  if (absValue >= config.minOrderValue) {
    return true;
  }

  // Check portfolio percentage threshold
  if (position.portfolioPercent >= config.minPortfolioPercent) {
    return true;
  }

  return false;
}

/**
 * Calculate confidence score (0-100) based on multiple factors
 *
 * Factors:
 * - Wallet count (more wallets = higher confidence)
 * - Total value (more money = higher confidence)
 * - Average conviction (avg % of portfolio = higher confidence)
 * - Value concentration (evenly distributed = higher confidence)
 */
export function calculateConfidenceScore(
  wallets: Array<{ value: number; portfolioPercent: number }>,
  minWallets: number
): number {
  if (wallets.length < minWallets) return 0;

  // Factor 1: Wallet count (0-30 points)
  // 3 wallets = 10, 5 wallets = 20, 7+ wallets = 30
  const walletScore = Math.min(30, (wallets.length - 2) * 10);

  // Factor 2: Total value (0-30 points)
  // $5K = 10, $15K = 20, $30K+ = 30
  const totalValue = wallets.reduce((sum, w) => sum + Math.abs(w.value), 0);
  const valueScore = Math.min(30, Math.floor(totalValue / 1000));

  // Factor 3: Average conviction (0-25 points)
  // 2% = 5, 5% = 15, 10%+ = 25
  const avgConviction = wallets.reduce((sum, w) => sum + w.portfolioPercent, 0) / wallets.length;
  const convictionScore = Math.min(25, Math.floor(avgConviction * 2.5));

  // Factor 4: Distribution evenness (0-15 points)
  // Penalize if one wallet dominates (>70% of total value)
  const maxValue = Math.max(...wallets.map(w => Math.abs(w.value)));
  const maxPercent = maxValue / totalValue;
  const distributionScore = maxPercent > 0.7 ? 5 : maxPercent > 0.5 ? 10 : 15;

  const totalScore = walletScore + valueScore + convictionScore + distributionScore;

  return Math.min(100, totalScore);
}

/**
 * Get confidence level from score
 */
export function getConfidenceLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
  if (score >= 80) return 'VERY_HIGH';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

/**
 * Detect consensus signals from wallet positions
 */
export function detectConsensus(
  positions: WalletPosition[],
  config: DetectorConfig = DEFAULT_CONFIG
): ConsensusSignal[] {
  const signals: ConsensusSignal[] = [];

  // Filter to significant positions only (exclude NEUTRAL)
  const significantPositions = positions.filter(
    p => p.side !== 'NEUTRAL' && isSignificantPosition(p, config)
  );

  if (significantPositions.length === 0) {
    return signals;
  }

  // Group by market (conditionId)
  const byMarket = new Map<string, WalletPosition[]>();
  for (const pos of significantPositions) {
    const existing = byMarket.get(pos.conditionId) || [];
    existing.push(pos);
    byMarket.set(pos.conditionId, existing);
  }

  // Check each market for consensus
  for (const [conditionId, marketPositions] of byMarket) {
    // Separate by side
    const yesSide = marketPositions.filter(p => p.side === 'YES');
    const noSide = marketPositions.filter(p => p.side === 'NO');

    // Check YES consensus
    if (yesSide.length >= config.minWallets) {
      const walletData = yesSide.map(p => ({
        alias: p.walletAlias,
        address: p.walletAddress,
        value: p.netValue,
        shares: p.netShares,
        portfolioPercent: p.portfolioPercent,
      }));

      const totalValue = walletData.reduce((sum, w) => sum + w.value, 0);
      const confidenceScore = calculateConfidenceScore(
        walletData.map(w => ({ value: w.value, portfolioPercent: w.portfolioPercent })),
        config.minWallets
      );

      signals.push({
        conditionId,
        marketTitle: yesSide[0].marketTitle,
        marketSlug: yesSide[0].marketSlug,
        side: 'YES',
        walletCount: yesSide.length,
        totalValue,
        avgValue: totalValue / yesSide.length,
        confidenceScore,
        confidenceLevel: getConfidenceLevel(confidenceScore),
        wallets: walletData.sort((a, b) => b.value - a.value), // Sort by value desc
      });
    }

    // Check NO consensus
    if (noSide.length >= config.minWallets) {
      const walletData = noSide.map(p => ({
        alias: p.walletAlias,
        address: p.walletAddress,
        value: Math.abs(p.netValue),
        shares: Math.abs(p.netShares),
        portfolioPercent: p.portfolioPercent,
      }));

      const totalValue = walletData.reduce((sum, w) => sum + w.value, 0);
      const confidenceScore = calculateConfidenceScore(
        walletData.map(w => ({ value: w.value, portfolioPercent: w.portfolioPercent })),
        config.minWallets
      );

      signals.push({
        conditionId,
        marketTitle: noSide[0].marketTitle,
        marketSlug: noSide[0].marketSlug,
        side: 'NO',
        walletCount: noSide.length,
        totalValue,
        avgValue: totalValue / noSide.length,
        confidenceScore,
        confidenceLevel: getConfidenceLevel(confidenceScore),
        wallets: walletData.sort((a, b) => b.value - a.value),
      });
    }
  }

  // Sort signals by confidence score (highest first)
  signals.sort((a, b) => b.confidenceScore - a.confidenceScore);

  logger.info('Consensus detection complete', {
    totalPositions: positions.length,
    significantPositions: significantPositions.length,
    marketsAnalyzed: byMarket.size,
    signalsDetected: signals.length,
  });

  return signals;
}
