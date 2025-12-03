import { logger } from '../../utils/logger';

export interface Position {
  marketId: string;
  marketTitle: string;
  outcome: string;
  size: number;
  price: number;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export interface PortfolioMetrics {
  totalValue: number;
  totalPositions: number;
  totalPnL: number;
  totalWinRate: number;
  averagePositionSize: number;
  biggestWin: number;
  biggestLoss: number;
  activeMarkets: number;
  currency: string;
}

export interface PerformancePeriod {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  startDate: Date;
  endDate: Date;
  totalReturn: number;
  winRate: number;
  totalTrades: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface MarketPerformance {
  marketId: string;
  marketTitle: string;
  positions: Position[];
  totalVolume: number;
  realizedPnL: number;
  unrealizedPnL: number;
  winRate: number;
  averageHoldTime: number;
}

export class PortfolioAnalytics {
  private logger = logger;
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(private databaseService: any) {}

  async calculatePortfolioMetrics(
    walletAddress: string,
    includeInactive: boolean = false
  ): Promise<PortfolioMetrics> {
    try {
      const positions = await this.getPositions(walletAddress, includeInactive);
      const closedPositions = await this.getClosedPositions(walletAddress);

      const totalValue = positions.reduce((sum, pos) => sum + (pos.size * pos.price), 0);
      const totalPnL = this.calculateTotalPnL(closedPositions);
      const wins = closedPositions.filter(pos => pos.pnl > 0).length;
      const totalWinRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;

      const realizedPnLs = closedPositions.map(pos => pos.pnl || 0);
      const biggestWin = Math.max(0, ...realizedPnLs);
      const biggestLoss = Math.min(0, ...realizedPnLs);

      const activeMarkets = new Set(positions.map(pos => pos.marketId)).size;
      const averagePositionSize = positions.length > 0
        ? totalValue / positions.length
        : 0;

      const currency = positions[0]?.currency || 'USDC';

      return {
        totalValue,
        totalPositions: positions.length,
        totalPnL,
        totalWinRate,
        averagePositionSize,
        biggestWin,
        biggestLoss,
        activeMarkets,
        currency
      };

    } catch (error) {
      this.logger.error('Error calculating portfolio metrics', {
        walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async calculatePerformancePeriods(
    walletAddress: string,
    periods: Array<'daily' | 'weekly' | 'monthly' | 'yearly'> = ['daily', 'weekly', 'monthly']
  ): Promise<PerformancePeriod[]> {
    const results: PerformancePeriod[] = [];

    for (const period of periods) {
      try {
        const periodData = await this.calculatePeriodPerformance(walletAddress, period);
        results.push(periodData);
      } catch (error) {
        this.logger.error(`Error calculating ${period} performance`, {
          walletAddress,
          error
        });
      }
    }

    return results;
  }

  async getTopPerformingMarkets(
    walletAddress: string,
    limit: number = 10,
    sortBy: 'volume' | 'pnl' | 'winRate' = 'pnl'
  ): Promise<MarketPerformance[]> {
    try {
      const positions = await this.getAllPositions(walletAddress);
      const marketGroups = this.groupPositionsByMarket(positions);

      let marketPerformances = Array.from(marketGroups.values()).map(market =>
        this.calculateMarketPerformance(market)
      );

      // Sort by specified metric
      marketPerformances.sort((a, b) => {
        switch (sortBy) {
          case 'volume':
            return b.totalVolume - a.totalVolume;
          case 'pnl':
            return (b.realizedPnL + b.unrealizedPnL) - (a.realizedPnL + a.unrealizedPnL);
          case 'winRate':
            return b.winRate - a.winRate;
          default:
            return 0;
        }
      });

      return marketPerformances.slice(0, limit);

    } catch (error) {
      this.logger.error('Error getting top performing markets', {
        walletAddress,
        error
      });
      return [];
    }
  }

  async generatePortfolioReport(
    walletAddress: string,
    period: '7d' | '30d' | '90d' | '1y' = '30d'
  ): Promise<{
    summary: PortfolioMetrics;
    performance: PerformancePeriod[];
    topMarkets: MarketPerformance[];
    riskMetrics: {
      volatility: number;
      maxDrawdown: number;
      sharpeRatio: number;
      concentrationRisk: number;
    };
  }> {
    const startDate = this.getStartDateFromPeriod(period);

    const [summary, performance, topMarkets] = await Promise.all([
      this.calculatePortfolioMetrics(walletAddress),
      this.calculatePerformancePeriods(walletAddress),
      this.getTopPerformingMarkets(walletAddress, 5)
    ]);

    const riskMetrics = await this.calculateRiskMetrics(walletAddress, startDate);

    return {
      summary,
      performance,
      topMarkets,
      riskMetrics
    };
  }

  private async getPositions(walletAddress: string, includeInactive: boolean): Promise<Position[]> {
    // Get active positions from database
    return [];
  }

  private async getClosedPositions(walletAddress: string): Promise<Array<Position & { pnl: number }>> {
    // Get closed positions with realized P/L
    return [];
  }

  private calculateTotalPnL(closedPositions: Array<Position & { pnl: number }>): number {
    return closedPositions.reduce((total, pos) => total + (pos.pnl || 0), 0);
  }

  private async calculatePeriodPerformance(
    walletAddress: string,
    period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  ): Promise<PerformancePeriod> {
    const endDate = new Date();
    const startDate = this.getStartDateFromPeriod(period);

    const periodPositions = await this.getPositionsInPeriod(walletAddress, startDate, endDate);
    const closedInPeriod = periodPositions.filter(pos => this.isPositionClosedInPeriod(pos, startDate, endDate));

    const totalReturn = this.calculateTotalPnL(closedInPeriod);
    const totalTrades = closedInPeriod.length;
    const wins = closedInPeriod.filter(pos => (pos as any).pnl > 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    const sharpeRatio = this.calculateSharpeRatio(closedInPeriod);
    const maxDrawdown = this.calculateMaxDrawdown(closedInPeriod);

    return {
      period,
      startDate,
      endDate,
      totalReturn,
      winRate,
      totalTrades,
      sharpeRatio,
      maxDrawdown
    };
  }

  private getStartDateFromPeriod(period: '7d' | '30d' | '90d' | '1y' | 'daily' | 'weekly' | 'monthly' | 'yearly'): Date {
    const now = new Date();
    const startDate = new Date(now);

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'daily':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'yearly':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }

    return startDate;
  }

  private async getPositionsInPeriod(walletAddress: string, startDate: Date, endDate: Date): Promise<Position[]> {
    // Get positions within the specified period
    return [];
  }

  private isPositionClosedInPeriod(position: Position, startDate: Date, endDate: Date): boolean {
    // Check if position was closed within the period
    return false;
  }

  private calculateSharpeRatio(positions: Array<Position & { pnl: number }>): number {
    if (positions.length < 2) return 0;

    const returns = positions.map(pos => (pos.pnl || 0) / (pos.size * pos.price));
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  private calculateMaxDrawdown(positions: Array<Position & { pnl: number }>): number {
    if (positions.length < 2) return 0;

    let maxDrawdown = 0;
    let peak = 0;

    for (const position of positions) {
      const value = position.pnl || 0;
      peak = Math.max(peak, value);
      const drawdown = (peak - value) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown * 100; // Return as percentage
  }

  private async getAllPositions(walletAddress: string): Promise<Position[]> {
    // Get all positions (active and closed) for the wallet
    return [];
  }

  private groupPositionsByMarket(positions: Position[]): Map<string, Position[]> {
    const groups = new Map<string, Position[]>();

    for (const position of positions) {
      const existing = groups.get(position.marketId) || [];
      existing.push(position);
      groups.set(position.marketId, existing);
    }

    return groups;
  }

  private calculateMarketPerformance(positions: Position[]): MarketPerformance {
    const totalVolume = positions.reduce((sum, pos) => sum + (pos.size * pos.price), 0);
    const closedPositions = positions.filter(pos => this.isPositionClosed(pos));
    const realizedPnL = closedPositions.reduce((sum, pos) => sum + ((pos as any).pnl || 0), 0);
    const wins = closedPositions.filter(pos => ((pos as any).pnl || 0) > 0).length;
    const winRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;

    const avgHoldTime = positions.reduce((sum, pos) => {
      const holdTime = pos.updated_at.getTime() - pos.created_at.getTime();
      return sum + holdTime;
    }, 0) / positions.length / (1000 * 60 * 60 * 24); // Convert to days

    return {
      marketId: positions[0].marketId,
      marketTitle: positions[0].marketTitle,
      positions,
      totalVolume,
      realizedPnL,
      unrealizedPnL: 0, // Would need current market prices to calculate
      winRate,
      averageHoldTime: avgHoldTime
    };
  }

  private isPositionClosed(position: Position): boolean {
    // Logic to determine if position is closed
    // This would depend on how closed positions are tracked
    return false;
  }

  private async calculateRiskMetrics(walletAddress: string, startDate: Date): Promise<{
    volatility: number;
    maxDrawdown: number;
    sharpeRatio: number;
    concentrationRisk: number;
  }> {
    const positions = await this.getPositionsInPeriod(walletAddress, startDate, new Date());
    const closedPositions = positions.filter(pos => this.isPositionClosedInPeriod(pos, startDate, new Date()));

    const returns = closedPositions.map(pos => ((pos as any).pnl || 0) / (pos.size * pos.price));
    const volatility = this.calculateVolatility(returns);
    const maxDrawdown = this.calculateMaxDrawdown(closedPositions);
    const sharpeRatio = this.calculateSharpeRatio(closedPositions);
    const concentrationRisk = this.calculateConcentrationRisk(positions);

    return {
      volatility: volatility * 100,
      maxDrawdown,
      sharpeRatio,
      concentrationRisk: concentrationRisk * 100
    };
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  private calculateConcentrationRisk(positions: Position[]): number {
    if (positions.length === 0) return 0;

    const totalValue = positions.reduce((sum, pos) => sum + (pos.size * pos.price), 0);
    const marketValues = new Map<string, number>();

    for (const position of positions) {
      const existing = marketValues.get(position.marketId) || 0;
      marketValues.set(position.marketId, existing + (position.size * position.price));
    }

    // Calculate Herfindahl-Hirschman Index
    let hhi = 0;
    for (const value of marketValues.values()) {
      const share = value / totalValue;
      hhi += share * share;
    }

    return hhi;
  }
}