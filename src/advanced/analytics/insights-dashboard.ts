import { logger } from '../../utils/logger';

export interface DashboardMetrics {
  overview: {
    totalValue: number;
    dailyChange: number;
    weeklyChange: number;
    monthlyChange: number;
    totalPnL: number;
    winRate: number;
    activePositions: number;
    totalTransactions: number;
  };
  performance: {
    periods: Array<{
      period: '1d' | '7d' | '30d' | '90d' | '1y';
      return: number;
      winRate: number;
      sharpeRatio: number;
      maxDrawdown: number;
      volatility: number;
    }>;
    trends: {
      value: 'up' | 'down' | 'stable';
      pnl: 'up' | 'down' | 'stable';
      activity: 'up' | 'down' | 'stable';
    };
  };
  markets: {
    topMarkets: Array<{
      marketId: string;
      title: string;
      exposure: number;
      pnl: number;
      winRate: number;
    }>;
    sectorDistribution: Array<{
      sector: string;
      value: number;
      percentage: number;
    }>;
    recentActivity: Array<{
      marketId: string;
      title: string;
      type: 'position_opened' | 'position_closed' | 'alert_triggered' | 'market_resolved';
      timestamp: Date;
      value: number;
    }>;
  };
  alerts: {
    activeAlerts: number;
    triggeredToday: number;
    successRate: number;
    averageResponseTime: number;
    topAlertTypes: Array<{
      type: string;
      count: number;
      successRate: number;
    }>;
  };
  risks: {
    concentrationRisk: number;
    volatilityRisk: number;
    liquidityRisk: number;
    overallRiskScore: number;
    recommendations: string[];
  };
  insights: {
    keyInsights: string[];
    recommendations: Array<{
      category: 'optimization' | 'risk_management' | 'opportunity' | 'alert';
      priority: 'high' | 'medium' | 'low';
      message: string;
      action?: string;
    }>;
    anomalies: Array<{
      type: string;
      description: string;
      severity: 'high' | 'medium' | 'low';
      detectedAt: Date;
    }>;
  };
}

export interface DashboardConfig {
  userId: number;
  refreshInterval: number; // minutes
  showAdvancedMetrics: boolean;
  enablePredictions: boolean;
  riskThreshold: number;
  displayCurrency: string;
  customWidgets: Array<{
    type: string;
    position: 'top' | 'middle' | 'bottom';
    enabled: boolean;
  }>;
}

export class InsightsDashboard {
  private logger = logger;
  private refreshIntervals = new Map<number, NodeJS.Timeout>();

  constructor(
    private portfolioAnalytics: any,
    private priceAlerts: any,
    private walletGroups: any
  ) {}

  async generateDashboard(
    userId: number,
    config?: Partial<DashboardConfig>
  ): Promise<DashboardMetrics> {
    try {
      const dashboardConfig = await this.getDashboardConfig(userId, config);
      const startTime = Date.now();

      const [
        overview,
        performance,
        markets,
        alerts,
        risks,
        insights
      ] = await Promise.all([
        this.generateOverviewMetrics(userId),
        this.generatePerformanceMetrics(userId),
        this.generateMarketMetrics(userId),
        this.generateAlertMetrics(userId),
        this.generateRiskMetrics(userId),
        this.generateInsights(userId)
      ]);

      const metrics: DashboardMetrics = {
        overview,
        performance,
        markets,
        alerts,
        risks,
        insights
      };

      const duration = Date.now() - startTime;
      this.logger.info('Dashboard generated', {
        userId,
        duration,
        config: dashboardConfig
      });

      return metrics;

    } catch (error) {
      this.logger.error('Error generating dashboard', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async startAutoRefresh(
    userId: number,
    refreshInterval: number = 15 // minutes
  ): Promise<void> {
    // Stop existing refresh for this user
    this.stopAutoRefresh(userId);

    const interval = setInterval(async () => {
      try {
        await this.generateDashboard(userId);
        this.logger.debug('Dashboard auto-refreshed', { userId });
      } catch (error) {
        this.logger.error('Error in auto-refresh', {
          userId,
          error
        });
      }
    }, refreshInterval * 60 * 1000);

    this.refreshIntervals.set(userId, interval);

    this.logger.info('Dashboard auto-refresh started', {
      userId,
      refreshInterval
    });
  }

  stopAutoRefresh(userId: number): void {
    const interval = this.refreshIntervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.refreshIntervals.delete(userId);
      this.logger.info('Dashboard auto-refresh stopped', { userId });
    }
  }

  async generateQuickSummary(userId: number): Promise<string> {
    try {
      const dashboard = await this.generateDashboard(userId);

      let summary = `📊 *Portfolio Summary*\n\n`;

      summary += `💰 *Portfolio Value*: ${dashboard.overview.totalValue.toFixed(2)} ${dashboard.overview.currency}\n`;

      const pnlIcon = dashboard.overview.totalPnL >= 0 ? '📈' : '📉';
      summary += `${pnlIcon} *Total P/L*: ${dashboard.overview.totalPnL >= 0 ? '+' : ''}${dashboard.overview.totalPnL.toFixed(2)}\n`;

      const winRateIcon = dashboard.overview.winRate >= 50 ? '✅' : '⚠️';
      summary += `${winRateIcon} *Win Rate*: ${dashboard.overview.winRate.toFixed(1)}%\n`;

      summary += `🔥 *Active Positions*: ${dashboard.overview.activePositions}\n`;
      summary += `🔄 *Transactions Today*: ${dashboard.overview.totalTransactions}\n\n`;

      if (dashboard.insights.recommendations.length > 0) {
        summary += `💡 *Key Recommendations*\n`;
        const topRecommendations = dashboard.insights.recommendations
          .filter(rec => rec.priority === 'high')
          .slice(0, 2);

        for (const rec of topRecommendations) {
          summary += `• ${rec.message}\n`;
        }
        summary += '\n';
      }

      if (dashboard.risks.overallRiskScore > 7) {
        summary += `⚠️ *Risk Alert*: High risk score (${dashboard.risks.overallRiskScore}/10)\n\n`;
      }

      summary += `🕒 *Last Updated*: ${new Date().toLocaleTimeString()}`;

      return summary;

    } catch (error) {
      this.logger.error('Error generating quick summary', {
        userId,
        error
      });
      return '❌ Unable to generate portfolio summary';
    }
  }

  async generateDetailedReport(
    userId: number,
    reportType: 'performance' | 'risk' | 'opportunities' | 'comprehensive'
  ): Promise<string> {
    try {
      const dashboard = await this.generateDashboard(userId);
      let report = '';

      switch (reportType) {
        case 'performance':
          report = this.generatePerformanceReport(dashboard);
          break;
        case 'risk':
          report = this.generateRiskReport(dashboard);
          break;
        case 'opportunities':
          report = this.generateOpportunitiesReport(dashboard);
          break;
        case 'comprehensive':
          report = this.generateComprehensiveReport(dashboard);
          break;
      }

      return report;

    } catch (error) {
      this.logger.error('Error generating detailed report', {
        userId,
        reportType,
        error
      });
      return '❌ Unable to generate report';
    }
  }

  private async generateOverviewMetrics(userId: number): Promise<DashboardMetrics['overview']> {
    // This would integrate with existing portfolio analytics
    const portfolioMetrics = await this.portfolioAnalytics.calculatePortfolioMetrics(userId);
    const todayMetrics = await this.portfolioAnalytics.calculatePerformancePeriods(userId, ['daily']);
    const weeklyMetrics = await this.portfolioAnalytics.calculatePerformancePeriods(userId, ['weekly']);
    const monthlyMetrics = await this.portfolioAnalytics.calculatePerformancePeriods(userId, ['monthly']);

    const today = todayMetrics[0];
    const week = weeklyMetrics[0];
    const month = monthlyMetrics[0];

    return {
      totalValue: portfolioMetrics.totalValue,
      dailyChange: today?.totalReturn || 0,
      weeklyChange: week?.totalReturn || 0,
      monthlyChange: month?.totalReturn || 0,
      totalPnL: portfolioMetrics.totalPnL,
      winRate: portfolioMetrics.totalWinRate,
      activePositions: portfolioMetrics.totalPositions,
      totalTransactions: today?.totalTrades || 0,
      currency: portfolioMetrics.currency
    };
  }

  private async generatePerformanceMetrics(userId: number): Promise<DashboardMetrics['performance']> {
    const periods = await this.portfolioAnalytics.calculatePerformancePeriods(userId, ['daily', 'weekly', 'monthly', 'yearly']);

    const calculateTrend = (current: number, previous: number): 'up' | 'down' | 'stable' => {
      const change = (current - previous) / previous;
      if (Math.abs(change) < 0.02) return 'stable';
      return change > 0 ? 'up' : 'down';
    };

    return {
      periods: periods.map(period => ({
        period: period.period === 'daily' ? '1d' : period.period === 'weekly' ? '7d' : period.period === 'monthly' ? '30d' : '1y',
        return: period.totalReturn,
        winRate: period.winRate,
        sharpeRatio: period.sharpeRatio,
        maxDrawdown: period.maxDrawdown,
        volatility: 0 // Would calculate from portfolio data
      })),
      trends: {
        value: calculateTrend(periods[1]?.totalReturn || 0, periods[2]?.totalReturn || 0),
        pnl: calculateTrend(periods[0]?.totalReturn || 0, periods[1]?.totalReturn || 0),
        activity: 'stable' // Would calculate from transaction data
      }
    };
  }

  private async generateMarketMetrics(userId: number): Promise<DashboardMetrics['markets']> {
    // This would integrate with market data services
    const topMarkets = await this.portfolioAnalytics.getTopPerformingMarkets(userId, 5);

    return {
      topMarkets: topMarkets.map(market => ({
        marketId: market.marketId,
        title: market.marketTitle,
        exposure: market.totalVolume,
        pnl: market.realizedPnL + market.unrealizedPnL,
        winRate: market.winRate
      })),
      sectorDistribution: [
        { sector: 'Crypto', value: 1000, percentage: 60 },
        { sector: 'Sports', value: 500, percentage: 30 },
        { sector: 'Politics', value: 200, percentage: 10 }
      ],
      recentActivity: [
        {
          marketId: 'market1',
          title: 'BTC Price Prediction',
          type: 'position_opened',
          timestamp: new Date(),
          value: 100
        },
        {
          marketId: 'market2',
          title: 'Election Outcome',
          type: 'alert_triggered',
          timestamp: new Date(Date.now() - 3600000),
          value: 50
        }
      ]
    };
  }

  private async generateAlertMetrics(userId: number): Promise<DashboardMetrics['alerts']> {
    const alertStats = await this.priceAlerts.getAlertStatistics(userId);

    return {
      activeAlerts: alertStats.activeAlerts,
      triggeredToday: alertStats.triggeredToday,
      successRate: alertStats.successRate,
      averageResponseTime: alertStats.averageTriggerTime,
      topAlertTypes: [
        { type: 'Price Above', count: 15, successRate: 85 },
        { type: 'Price Below', count: 12, successRate: 78 },
        { type: 'Change Percent', count: 8, successRate: 92 }
      ]
    };
  }

  private async generateRiskMetrics(userId: number): Promise<DashboardMetrics['risks']> {
    // This would integrate with risk assessment services
    const portfolioRisk = await this.portfolioAnalytics.calculateRiskMetrics(userId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const concentrationRisk = portfolioRisk.concentrationRisk;
    const volatilityRisk = portfolioRisk.volatility;
    const liquidityRisk = 2; // Would calculate from market data
    const overallRiskScore = Math.max(concentrationRisk, volatilityRisk, liquidityRisk);

    const recommendations: string[] = [];
    if (concentrationRisk > 7) recommendations.push('Consider diversifying positions across different markets');
    if (volatilityRisk > 6) recommendations.push('Reduce position sizes in volatile markets');
    if (liquidityRisk > 5) recommendations.push('Monitor liquidity in less popular markets');

    return {
      concentrationRisk,
      volatilityRisk,
      liquidityRisk,
      overallRiskScore,
      recommendations
    };
  }

  private async generateInsights(userId: number): Promise<DashboardMetrics['insights']> {
    const keyInsights: string[] = [];
    const recommendations: DashboardMetrics['insights']['recommendations'] = [];
    const anomalies: DashboardMetrics['insights']['anomalies'] = [];

    // Generate insights based on patterns and anomalies
    try {
      const dashboard = await this.generateDashboard(userId);

      // Performance insights
      if (dashboard.overview.winRate < 40) {
        keyInsights.push('Win rate below 40% - consider reviewing trading strategy');
        recommendations.push({
          category: 'optimization',
          priority: 'high',
          message: 'Review recent losing trades to identify patterns'
        });
      }

      if (dashboard.overview.dailyChange < -5) {
        keyInsights.push('Significant daily loss detected');
        recommendations.push({
          category: 'risk_management',
          priority: 'high',
          message: 'Consider reducing exposure after recent losses',
          action: '/risk:reduce'
        });
      }

      // Risk insights
      if (dashboard.risks.overallRiskScore > 7) {
        keyInsights.push('High risk exposure detected');
        recommendations.push({
          category: 'risk_management',
          priority: 'high',
          message: 'Portfolio risk score is elevated - review position sizes'
        });
      }

      // Opportunity insights
      if (dashboard.alerts.successRate > 90 && dashboard.alerts.activeAlerts < 3) {
        keyInsights.push('Alert performance is excellent - consider expanding alert coverage');
        recommendations.push({
          category: 'opportunity',
          priority: 'medium',
          message: 'Set up additional price alerts for key markets',
          action: '/alerts:setup'
        });
      }

      // Anomaly detection
      if (dashboard.overview.totalTransactions > 50) {
        anomalies.push({
          type: 'High Activity',
          description: 'Unusually high transaction volume detected today',
          severity: 'medium',
          detectedAt: new Date()
        });
      }

    } catch (error) {
      this.logger.error('Error generating insights', {
        userId,
        error
      });
    }

    return {
      keyInsights,
      recommendations,
      anomalies
    };
  }

  private async getDashboardConfig(
    userId: number,
    customConfig?: Partial<DashboardConfig>
  ): Promise<DashboardConfig> {
    // Load user's dashboard configuration from database or use defaults
    const defaultConfig: DashboardConfig = {
      userId,
      refreshInterval: 15,
      showAdvancedMetrics: false,
      enablePredictions: false,
      riskThreshold: 7,
      displayCurrency: 'USDC',
      customWidgets: [
        { type: 'overview', position: 'top', enabled: true },
        { type: 'performance', position: 'middle', enabled: true },
        { type: 'alerts', position: 'bottom', enabled: true }
      ]
    };

    return customConfig ? { ...defaultConfig, ...customConfig } : defaultConfig;
  }

  private generatePerformanceReport(dashboard: DashboardMetrics): string {
    let report = `📈 *Performance Report*\n\n`;

    report += `💰 *Portfolio Value*: ${dashboard.overview.totalValue.toFixed(2)} ${dashboard.overview.currency}\n`;
    report += `📊 *Total P/L*: ${dashboard.overview.totalPnL >= 0 ? '+' : ''}${dashboard.overview.totalPnL.toFixed(2)}\n`;
    report += `🎯 *Win Rate*: ${dashboard.overview.winRate.toFixed(1)}%\n\n`;

    report += `📅 *Performance by Period*\n`;
    for (const period of dashboard.performance.periods) {
      const icon = period.return >= 0 ? '📈' : '📉';
      report += `${icon} ${period.period}: ${period.return >= 0 ? '+' : ''}${period.return.toFixed(2)}% (${period.winRate.toFixed(1)}% WR)\n`;
    }

    return report;
  }

  private generateRiskReport(dashboard: DashboardMetrics): string {
    let report = `⚠️ *Risk Analysis*\n\n`;

    report += `🎯 *Overall Risk Score*: ${dashboard.risks.overallRiskScore}/10\n`;
    report += `📊 *Concentration Risk*: ${dashboard.risks.concentrationRisk.toFixed(1)}/10\n`;
    report += `📈 *Volatility Risk*: ${dashboard.risks.volatilityRisk.toFixed(1)}/10\n`;
    report += `💧 *Liquidity Risk*: ${dashboard.risks.liquidityRisk.toFixed(1)}/10\n\n`;

    if (dashboard.risks.recommendations.length > 0) {
      report += `💡 *Risk Recommendations*\n`;
      for (const rec of dashboard.risks.recommendations) {
        report += `• ${rec}\n`;
      }
    }

    return report;
  }

  private generateOpportunitiesReport(dashboard: DashboardMetrics): string {
    let report = `🚀 *Opportunities & Insights*\n\n`;

    if (dashboard.insights.keyInsights.length > 0) {
      report += `💡 *Key Insights*\n`;
      for (const insight of dashboard.insights.keyInsights) {
        report += `• ${insight}\n`;
      }
      report += '\n';
    }

    const opportunities = dashboard.insights.recommendations.filter(rec => rec.category === 'opportunity');
    if (opportunities.length > 0) {
      report += `🎯 *Opportunities*\n`;
      for (const opp of opportunities) {
        report += `• ${opp.message}\n`;
      }
    }

    return report;
  }

  private generateComprehensiveReport(dashboard: DashboardMetrics): string {
    let report = `📊 *Comprehensive Portfolio Report*\n\n`;

    report += this.generatePerformanceReport(dashboard);
    report += '\n' + this.generateRiskReport(dashboard);
    report += '\n' + this.generateOpportunitiesReport(dashboard);

    return report;
  }

  // Cleanup
  shutdown(): void {
    for (const [userId, interval] of this.refreshIntervals) {
      clearInterval(interval);
      this.logger.debug('Stopped dashboard auto-refresh', { userId });
    }
    this.refreshIntervals.clear();
  }
}