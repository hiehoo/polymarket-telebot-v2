import PolymarketRestClient from '../../services/polymarket/rest-client';
import { NotificationService } from '../../services/notifications/notification-service';
import { NotificationTemplates } from '../../services/notifications/notification-templates';
import logger from '../../utils/logger';

export interface MarketResolution {
  marketId: string;
  marketTitle: string;
  outcome: string;
  finalPrice: number;
  currency: string;
  resolvedAt: Date;
  questionId: string;
}

export interface ResolutionImpact {
  userId: number;
  telegramId: number;
  walletAddress: string;
  walletAlias?: string;
  positionOutcome: 'won' | 'lost' | 'neutral';
  pnl: number;
  positionSize: number;
  isSignificant: boolean;
}

export class MarketResolutionTracker {
  private logger = logger;
  private activeResolutions = new Map<string, Promise<void>>();

  constructor(
    private polymarketService: PolymarketRestClient,
    private notificationService: NotificationService
  ) {}

  async trackMarketResolution(marketId: string): Promise<void> {
    if (this.activeResolutions.has(marketId)) {
      return;
    }

    const resolutionPromise = this.processMarketResolution(marketId);
    this.activeResolutions.set(marketId, resolutionPromise);

    try {
      await resolutionPromise;
    } finally {
      this.activeResolutions.delete(marketId);
    }
  }

  private async processMarketResolution(marketId: string): Promise<void> {
    try {
      const market = await this.polymarketService.getMarket(marketId);
      if (!market || !market.active) {
        return;
      }

      const resolution: MarketResolution = {
        marketId: market.id,
        marketTitle: market.title,
        outcome: market.outcome || 'pending',
        finalPrice: market.finalPrice || 0,
        currency: market.collateral || 'USDC',
        resolvedAt: new Date(),
        questionId: market.questionId
      };

      const affectedUsers = await this.getUsersWithPositions(marketId);

      for (const user of affectedUsers) {
        const impact = await this.calculateResolutionImpact(user, resolution);

        if (impact.isSignificant) {
          await this.sendResolutionNotification(user.telegramId, resolution, impact);
        }
      }

      await this.logResolutionAnalytics(resolution, affectedUsers);

    } catch (error) {
      this.logger.error('Error processing market resolution', {
        marketId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getUsersWithPositions(marketId: string): Promise<Array<{
    userId: number;
    telegramId: number;
    walletAddress: string;
    walletAlias?: string;
  }>> {
    // Query database for users tracking this market
    // This would integrate with the existing database service
    return [];
  }

  private async calculateResolutionImpact(
    user: any,
    resolution: MarketResolution
  ): Promise<ResolutionImpact> {
    try {
      const positions = await this.getUserPositions(user.walletAddress, resolution.marketId);
      const totalPositionSize = positions.reduce((sum, pos) => sum + pos.size, 0);

      let pnl = 0;
      let positionOutcome: 'won' | 'lost' | 'neutral' = 'neutral';

      for (const position of positions) {
        if (position.outcome === resolution.outcome) {
          pnl += position.size * (resolution.finalPrice / position.price);
          positionOutcome = 'won';
        } else {
          pnl -= position.size;
          positionOutcome = positionOutcome === 'won' ? 'neutral' : 'lost';
        }
      }

      return {
        userId: user.userId,
        telegramId: user.telegramId,
        walletAddress: user.walletAddress,
        walletAlias: user.walletAlias,
        positionOutcome,
        pnl,
        positionSize: totalPositionSize,
        isSignificant: Math.abs(pnl) > 100 || totalPositionSize > 1000
      };

    } catch (error) {
      this.logger.error('Error calculating resolution impact', {
        userId: user.userId,
        marketId: resolution.marketId,
        error
      });

      return {
        userId: user.userId,
        telegramId: user.telegramId,
        walletAddress: user.walletAddress,
        walletAlias: user.walletAlias,
        positionOutcome: 'neutral',
        pnl: 0,
        positionSize: 0,
        isSignificant: false
      };
    }
  }

  private async getUserPositions(walletAddress: string, marketId: string): Promise<Array<{
    outcome: string;
    size: number;
    price: number;
  }>> {
    // Get user's positions in the resolved market
    // This would integrate with the polymarket service
    return [];
  }

  private async sendResolutionNotification(
    telegramId: number,
    resolution: MarketResolution,
    impact: ResolutionImpact
  ): Promise<void> {
    const notification = NotificationTemplates.marketResolution({
      marketId: resolution.marketId,
      marketTitle: resolution.marketTitle,
      outcome: resolution.outcome,
      finalPrice: resolution.finalPrice,
      currency: resolution.currency,
      affectedWallets: [impact.walletAddress]
    });

    if (impact.positionOutcome !== 'neutral') {
      const outcomeIcon = impact.positionOutcome === 'won' ? '🎉' : '💸';
      notification.message += `\n\n${outcomeIcon} Your P/L: ${impact.pnl.toFixed(2)} ${resolution.currency}`;
    }

    notification.userId = telegramId;

    await this.notificationService.sendNotification(telegramId, notification);
  }

  private async logResolutionAnalytics(
    resolution: MarketResolution,
    affectedUsers: any[]
  ): Promise<void> {
    this.logger.info('Market resolution processed', {
      marketId: resolution.marketId,
      outcome: resolution.outcome,
      finalPrice: resolution.finalPrice,
      affectedUsers: affectedUsers.length,
      resolvedAt: resolution.resolvedAt.toISOString()
    });
  }

  async getResolutionHistory(
    walletAddress?: string,
    limit: number = 50
  ): Promise<MarketResolution[]> {
    // Get historical market resolutions
    // This would query the database for past resolutions
    return [];
  }

  async getResolutionImpactReport(marketId: string): Promise<{
    totalUsers: number;
    winners: number;
    losers: number;
    totalVolume: number;
    averagePosition: number;
  }> {
    // Generate impact report for a specific market resolution
    return {
      totalUsers: 0,
      winners: 0,
      losers: 0,
      totalVolume: 0,
      averagePosition: 0
    };
  }
}