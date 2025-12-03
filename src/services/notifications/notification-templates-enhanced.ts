import { NotificationData, TelegramUserPreferences } from '@/types/telegram';
import { PolymarketEvent, ProcessingEvent } from '@/types/data-processing';
import { PolymarketPosition, PolymarketTransaction, PolymarketCondition, PolymarketMarketData } from '@/types/polymarket';

export interface NotificationTemplate {
  type: NotificationData['type'];
  title: string;
  message: string;
  formatMessage: (data: any, preferences?: TelegramUserPreferences) => string;
  getKeyboard: (data: any) => any;
  getPriority: (data: any) => NotificationData['priority'];
  getMetadata: (data: any) => any;
}

export interface TemplateContext {
  event: PolymarketEvent | ProcessingEvent;
  userPreferences?: TelegramUserPreferences;
  walletAlias?: string;
  marketContext?: {
    conditionId?: string;
    question?: string;
    description?: string;
    outcomePrices?: Record<string, number>;
    volume24h?: number;
  };
  isTruncated?: boolean;
}

export class EnhancedNotificationTemplates {
  private templates: Map<string, NotificationTemplate> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    // Transaction templates
    this.templates.set('transaction_large', this.createLargeTransactionTemplate());
    this.templates.set('transaction_medium', this.createMediumTransactionTemplate());
    this.templates.set('transaction_small', this.createSmallTransactionTemplate());
    this.templates.set('transaction_first_time', this.createFirstTimeTransactionTemplate());

    // Position templates
    this.templates.set('position_opened', this.createPositionOpenedTemplate());
    this.templates.set('position_increased', this.createPositionIncreasedTemplate());
    this.templates.set('position_decreased', this.createPositionDecreasedTemplate());
    this.templates.set('position_closed', this.createPositionClosedTemplate());
    this.templates.set('position_profit_taking', this.createProfitTakingTemplate());
    this.templates.set('position_stop_loss', this.createStopLossTemplate());

    // Market resolution templates
    this.templates.set('market_resolved_yes', this.createMarketResolvedYesTemplate());
    this.templates.set('market_resolved_no', this.createMarketResolvedNoTemplate());
    this.templates.set('market_resolved_ambiguous', this.createMarketResolvedAmbiguousTemplate());
    this.templates.set('market_resolved_cancelled', this.createMarketResolvedCancelledTemplate());

    // Price alert templates
    this.templates.set('price_spike_up', this.createPriceSpikeUpTemplate());
    this.templates.set('price_spike_down', this.createPriceSpikeDownTemplate());
    this.templates.set('price_threshold_crossed', this.createPriceThresholdCrossedTemplate());
    this.templates.set('volume_surge', this.createVolumeSurgeTemplate());

    // System templates
    this.templates.set('system_maintenance', this.createSystemMaintenanceTemplate());
    this.templates.set('system_feature_update', this.createFeatureUpdateTemplate());
    this.templates.set('system_security_alert', this.createSecurityAlertTemplate());
    this.templates.set('system_wallet_synced', this.createWalletSyncedTemplate());

    // Analytics templates
    this.templates.set('analytics_portfolio_summary', this.createPortfolioSummaryTemplate());
    this.templates.set('analytics_performance_report', this.createPerformanceReportTemplate());
    this.templates.set('analytics_risk_alert', this.createRiskAlertTemplate());

    // Batch notification templates
    this.templates.set('batch_multiple_updates', this.createMultipleUpdatesTemplate());
    this.templates.set('batch_hourly_digest', this.createHourlyDigestTemplate());
    this.templates.set('batch_daily_summary', this.createDailySummaryTemplate());
  }

  public generateNotification(
    eventType: string,
    context: TemplateContext
  ): NotificationData | null {
    const template = this.templates.get(eventType);
    if (!template) {
      console.warn(`No template found for event type: ${eventType}`);
      return null;
    }

    const message = template.formatMessage(context.event.data, context.userPreferences);
    const priority = template.getPriority(context.event.data);
    const keyboard = template.getKeyboard(context.event.data);
    const metadata = template.getMetadata(context.event);

    return {
      userId: 0, // Will be set by caller
      type: template.type,
      title: this.formatTitle(template.title, context),
      message: this.truncateMessage(message, context.isTruncated),
      data: context.event.data,
      priority,
      metadata
    };
  }

  private formatTitle(title: string, context: TemplateContext): string {
    // Replace placeholders in title
    return title
      .replace('{{wallet}}', context.walletAlias || 'Unknown Wallet')
      .replace('{{market}}', context.marketContext?.question?.substring(0, 50) || 'Unknown Market')
      .replace('{{amount}}', this.formatAmount(context.event.data?.amount || 0));
  }

  private truncateMessage(message: string, isTruncated?: boolean): string {
    const maxLength = 4000; // Telegram message limit
    if (message.length <= maxLength) {
      return message;
    }

    const truncated = message.substring(0, maxLength - 100);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('\n')
    );

    const finalMessage = lastSentenceEnd > 0
      ? truncated.substring(0, lastSentenceEnd + 1)
      : truncated;

    return finalMessage + '\n\n*Message truncated. Tap for full details.*';
  }

  private formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    } else if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}K`;
    }
    return `$${amount.toLocaleString()}`;
  }

  private formatPercentage(change: number): string {
    const absChange = Math.abs(change);
    const sign = change >= 0 ? '+' : '-';
    return `${sign}${absChange.toFixed(2)}%`;
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    });
  }

  private createLargeTransactionTemplate(): NotificationTemplate {
    return {
      type: 'transaction',
      title: '🚀 Large Transaction Detected',
      message: (data: PolymarketTransaction, preferences?: TelegramUserPreferences) => {
        const transaction = data;
        const percentageChange = this.calculateTransactionSignificance(transaction);
        const isOutbound = transaction.type === 'sell';

        return `💰 *Large Transaction Alert*\n\n` +
          `${isOutbound ? '⬇️' : '⬆️'} *${isOutbound ? 'Sold' : 'Bought'}* ${this.formatAmount(transaction.amount || 0)}\n\n` +
          `📊 *Significance:* ${this.formatPercentage(percentageChange)}\n` +
          `📍 *Wallet:* \`${transaction.user}\`\n` +
          `⏰ *Time:* ${this.formatTime(transaction.timestamp)}\n\n` +
          `_This represents a significant position change in this market._`;
      },
      getKeyboard: (data: PolymarketTransaction) => ({
        inline_keyboard: [
          [
            { text: '🔍 View Transaction', callback_data: `tx_view_${data.hash}` },
            { text: '📊 Market Details', callback_data: `market_${data.conditionId}` }
          ],
          [
            { text: '📍 Track Wallet', callback_data: `wallet_track_${data.user}` }
          ]
        ]
      }),
      getPriority: (data: PolymarketTransaction) => {
        const significance = this.calculateTransactionSignificance(data);
        return significance > 50 ? 'urgent' : significance > 20 ? 'high' : 'medium';
      },
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        transactionHash: (context.event.data as PolymarketTransaction)?.hash,
        conditionId: context.event.conditionId,
        amount: (context.event.data as PolymarketTransaction)?.amount,
        type: 'large_transaction',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createMediumTransactionTemplate(): NotificationTemplate {
    return {
      type: 'transaction',
      title: '💵 Transaction Activity',
      message: (data: PolymarketTransaction) => {
        const isOutbound = data.type === 'sell';
        return `💵 *Transaction Activity*\n\n` +
          `${isOutbound ? '⬇️' : '⬆️'} *${isOutbound ? 'Sold' : 'Bought'}* ${this.formatAmount(data.amount || 0)}\n` +
          `📍 *Wallet:* \`${data.user}\`\n` +
          `⏰ *Time:* ${this.formatTime(data.timestamp)}`;
      },
      getKeyboard: (data: PolymarketTransaction) => ({
        inline_keyboard: [
          [
            { text: '🔗 Transaction', callback_data: `tx_view_${data.hash}` }
          ],
          [
            { text: '🚫 Mute Wallet', callback_data: `wallet_mute_${data.user}` }
          ]
        ]
      }),
      getPriority: () => 'medium',
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        transactionHash: (context.event.data as PolymarketTransaction)?.hash,
        conditionId: context.event.conditionId,
        type: 'medium_transaction',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createSmallTransactionTemplate(): NotificationTemplate {
    return {
      type: 'transaction',
      title: '💸 Small Transaction',
      message: (data: PolymarketTransaction) => {
        const isOutbound = data.type === 'sell';
        return `💸 *Small Transaction*\n\n` +
          `${isOutbound ? '⬇️' : '⬆️'} *${isOutbound ? 'Sold' : 'Bought'}* ${this.formatAmount(data.amount || 0)}\n` +
          `📍 *Wallet:* \`${data.user}\``;
      },
      getKeyboard: () => undefined,
      getPriority: () => 'low',
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        conditionId: context.event.conditionId,
        type: 'small_transaction',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createFirstTimeTransactionTemplate(): NotificationTemplate {
    return {
      type: 'transaction',
      title: '🌟 New Wallet Activity',
      message: (data: PolymarketTransaction) => {
        return `🌟 *First Transaction Alert*\n\n` +
          `🎉 *New wallet detected with initial activity*\n\n` +
          `💰 *Amount:* ${this.formatAmount(data.amount || 0)}\n` +
          `📍 *Wallet:* \`${data.user}\`\n` +
          `⏰ *First Seen:* ${this.formatTime(data.timestamp)}\n\n` +
          `_This is the first transaction we've detected from this wallet. Consider tracking for future activity._`;
      },
      getKeyboard: (data: PolymarketTransaction) => ({
        inline_keyboard: [
          [
            { text: '👁️ Track Wallet', callback_data: `wallet_track_${data.user}` },
            { text: '📊 View Profile', callback_data: `wallet_profile_${data.user}` }
          ]
        ]
      }),
      getPriority: () => 'high',
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        transactionHash: (context.event.data as PolymarketTransaction)?.hash,
        conditionId: context.event.conditionId,
        type: 'first_transaction',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createPositionOpenedTemplate(): NotificationTemplate {
    return {
      type: 'position',
      title: '📈 New Position Opened',
      message: (data: PolymarketPosition) => {
        const outcome = data.outcome || 'Unknown';
        const size = data.size || 0;
        const price = data.price || 0;

        return `📈 *New Position Opened*\n\n` +
          `🎯 *Outcome:* ${outcome}\n` +
          `💰 *Size:* ${this.formatAmount(size)}\n` +
          `💵 *Price:* ${price.toFixed(3)}\n` +
          `📍 *Wallet:* \`${data.user}\`\n` +
          `⏰ *Time:* ${this.formatTime(data.timestamp)}`;
      },
      getKeyboard: (data: PolymarketPosition) => ({
        inline_keyboard: [
          [
            { text: '📊 Position Details', callback_data: `position_view_${data.id}` },
            { text: '📈 Market Chart', callback_data: `market_chart_${data.conditionId}` }
          ]
        ]
      }),
      getPriority: (data: PolymarketPosition) => {
        const size = data.size || 0;
        return size > 10000 ? 'high' : 'medium';
      },
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        conditionId: context.event.conditionId,
        positionId: (context.event.data as PolymarketPosition)?.id,
        type: 'position_opened',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createPositionIncreasedTemplate(): NotificationTemplate {
    return {
      type: 'position',
      title: '📊 Position Increased',
      message: (data: PolymarketPosition) => {
        const outcome = data.outcome || 'Unknown';
        const size = data.size || 0;
        const price = data.price || 0;
        const previousSize = data.previousSize || 0;
        const increase = size - previousSize;
        const percentage = previousSize > 0 ? (increase / previousSize) * 100 : 0;

        return `📊 *Position Increased*\n\n` +
          `🎯 *Outcome:* ${outcome}\n` +
          `💰 *New Size:* ${this.formatAmount(size)}\n` +
          `📈 *Increase:* ${this.formatAmount(increase)} (${this.formatPercentage(percentage)})\n` +
          `💵 *Price:* ${price.toFixed(3)}\n` +
          `📍 *Wallet:* \`${data.user}\``;
      },
      getKeyboard: (data: PolymarketPosition) => ({
        inline_keyboard: [
          [
            { text: '📊 Position Details', callback_data: `position_view_${data.id}` }
          ]
        ]
      }),
      getPriority: (data: PolymarketPosition) => {
        const percentage = data.previousSize > 0 ? ((data.size! - data.previousSize) / data.previousSize) * 100 : 0;
        return percentage > 100 ? 'high' : 'medium';
      },
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        conditionId: context.event.conditionId,
        positionId: (context.event.data as PolymarketPosition)?.id,
        type: 'position_increased',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createPositionDecreasedTemplate(): NotificationTemplate {
    return {
      type: 'position',
      title: '📉 Position Decreased',
      message: (data: PolymarketPosition) => {
        const outcome = data.outcome || 'Unknown';
        const size = data.size || 0;
        const price = data.price || 0;
        const previousSize = data.previousSize || 0;
        const decrease = previousSize - size;
        const percentage = previousSize > 0 ? (decrease / previousSize) * 100 : 0;

        return `📉 *Position Decreased*\n\n` +
          `🎯 *Outcome:* ${outcome}\n` +
          `💰 *New Size:* ${this.formatAmount(size)}\n` +
          `📉 *Decrease:* ${this.formatAmount(decrease)} (${this.formatPercentage(percentage)})\n` +
          `💵 *Price:* ${price.toFixed(3)}\n` +
          `📍 *Wallet:* \`${data.user}\``;
      },
      getKeyboard: (data: PolymarketPosition) => ({
        inline_keyboard: [
          [
            { text: '💰 Profit Analysis', callback_data: `position_profit_${data.id}` }
          ]
        ]
      }),
      getPriority: () => 'medium',
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        conditionId: context.event.conditionId,
        positionId: (context.event.data as PolymarketPosition)?.id,
        type: 'position_decreased',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createPositionClosedTemplate(): NotificationTemplate {
    return {
      type: 'position',
      title: '✅ Position Closed',
      message: (data: PolymarketPosition) => {
        const outcome = data.outcome || 'Unknown';
        const size = data.previousSize || 0;
        const price = data.price || 0;
        const pnl = data.pnl || 0;
        const pnlPercentage = data.pnlPercentage || 0;

        return `✅ *Position Closed*\n\n` +
          `🎯 *Outcome:* ${outcome}\n` +
          `💰 *Size:* ${this.formatAmount(size)}\n` +
          `💵 *Close Price:* ${price.toFixed(3)}\n` +
          `📈 *PnL:* ${this.formatAmount(pnl)} (${this.formatPercentage(pnlPercentage)})\n` +
          `📍 *Wallet:* \`${data.user}\`\n\n` +
          `${pnl >= 0 ? '🎉' : '📉'} *${pnl >= 0 ? 'Profit' : 'Loss'} realized*`;
      },
      getKeyboard: (data: PolymarketPosition) => ({
        inline_keyboard: [
          [
            { text: '📊 Trade History', callback_data: `position_history_${data.id}` },
            { text: '📈 Performance', callback_data: `wallet_performance_${data.user}` }
          ]
        ]
      }),
      getPriority: (data: PolymarketPosition) => {
        const pnlAbsolute = Math.abs(data.pnl || 0);
        return pnlAbsolute > 5000 ? 'high' : 'medium';
      },
      getMetadata: (context: TemplateContext) => ({
        walletId: context.event.userId,
        conditionId: context.event.conditionId,
        positionId: (context.event.data as PolymarketPosition)?.id,
        pnl: (context.event.data as PolymarketPosition)?.pnl,
        type: 'position_closed',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createMarketResolvedYesTemplate(): NotificationTemplate {
    return {
      type: 'resolution',
      title: '✅ Market Resolved: YES',
      message: (data: PolymarketCondition) => {
        return `✅ *Market Resolved*\n\n` +
          `🎯 *Outcome:* YES\n` +
          `❓ *Question:* ${data.question?.substring(0, 200) || 'Unknown'}\n` +
          `🏷️ *Condition:* \`${data.id}\`\n` +
          `⏰ *Resolved:* ${this.formatTime(data.resolutionTimestamp || Date.now())}\n\n` +
          `_Positions on YES outcome have been settled._`;
      },
      getKeyboard: (data: PolymarketCondition) => ({
        inline_keyboard: [
          [
            { text: '📊 Resolution Details', callback_data: `resolution_${data.id}` },
            { text: '🔍 Similar Markets', callback_data: `similar_${data.id}` }
          ]
        ]
      }),
      getPriority: () => 'urgent',
      getMetadata: (context: TemplateContext) => ({
        conditionId: context.event.conditionId,
        resolution: 'YES',
        type: 'market_resolution',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createMarketResolvedNoTemplate(): NotificationTemplate {
    return {
      type: 'resolution',
      title: '❌ Market Resolved: NO',
      message: (data: PolymarketCondition) => {
        return `❌ *Market Resolved*\n\n` +
          `🎯 *Outcome:* NO\n` +
          `❓ *Question:* ${data.question?.substring(0, 200) || 'Unknown'}\n` +
          `🏷️ *Condition:* \`${data.id}\`\n` +
          `⏰ *Resolved:* ${this.formatTime(data.resolutionTimestamp || Date.now())}\n\n` +
          `_Positions on NO outcome have been settled._`;
      },
      getKeyboard: (data: PolymarketCondition) => ({
        inline_keyboard: [
          [
            { text: '📊 Resolution Details', callback_data: `resolution_${data.id}` }
          ]
        ]
      }),
      getPriority: () => 'urgent',
      getMetadata: (context: TemplateContext) => ({
        conditionId: context.event.conditionId,
        resolution: 'NO',
        type: 'market_resolution',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createPriceSpikeUpTemplate(): NotificationTemplate {
    return {
      type: 'price_alert',
      title: '📈 Price Spike Up',
      message: (data: PolymarketMarketData) => {
        const priceChange = data.priceChange || 0;
        const currentPrice = data.price || 0;
        const volume = data.volume24h || 0;

        return `📈 *Price Spike Alert*\n\n` +
          `💹 *Price Change:* ${this.formatPercentage(priceChange)}\n` +
          `💵 *Current Price:* ${currentPrice.toFixed(4)}\n` +
          `📊 *24h Volume:* ${this.formatAmount(volume)}\n` +
          `🏷️ *Market:* ${data.question?.substring(0, 100) || 'Unknown'}`;
      },
      getKeyboard: (data: PolymarketMarketData) => ({
        inline_keyboard: [
          [
            { text: '📊 Price Chart', callback_data: `chart_${data.conditionId}` },
            { text: '📈 Trade Now', callback_data: `trade_${data.conditionId}` }
          ]
        ]
      }),
      getPriority: (data: PolymarketMarketData) => {
        const change = Math.abs(data.priceChange || 0);
        return change > 20 ? 'high' : 'medium';
      },
      getMetadata: (context: TemplateContext) => ({
        conditionId: context.event.conditionId,
        priceChange: (context.event.data as PolymarketMarketData)?.priceChange,
        currentPrice: (context.event.data as PolymarketMarketData)?.price,
        type: 'price_spike',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createVolumeSurgeTemplate(): NotificationTemplate {
    return {
      type: 'price_alert',
      title: '🚀 Volume Surge Detected',
      message: (data: PolymarketMarketData) => {
        const volume24h = data.volume24h || 0;
        const volumeChange = data.volumeChange || 0;
        const price = data.price || 0;

        return `🚀 *Volume Surge Alert*\n\n` +
          `📊 *24h Volume:* ${this.formatAmount(volume24h)}\n` +
          `📈 *Volume Change:* ${this.formatPercentage(volumeChange)}\n` +
          `💵 *Current Price:* ${price.toFixed(4)}\n` +
          `🏷️ *Market:* ${data.question?.substring(0, 100) || 'Unknown'}\n\n` +
          `_Unusual trading activity detected in this market._`;
      },
      getKeyboard: (data: PolymarketMarketData) => ({
        inline_keyboard: [
          [
            { text: '📊 Volume Analysis', callback_data: `volume_${data.conditionId}` },
            { text: '🔍 Trade Activity', callback_data: `activity_${data.conditionId}` }
          ]
        ]
      }),
      getPriority: () => 'medium',
      getMetadata: (context: TemplateContext) => ({
        conditionId: context.event.conditionId,
        volume: (context.event.data as PolymarketMarketData)?.volume24h,
        volumeChange: (context.event.data as PolymarketMarketData)?.volumeChange,
        type: 'volume_surge',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createMultipleUpdatesTemplate(): NotificationTemplate {
    return {
      type: 'system',
      title: '📊 Multiple Updates',
      message: (data: any, preferences?: TelegramUserPreferences) => {
        const updates = data.notifications || [];
        const updateCounts = updates.reduce((counts: any, update: any) => {
          counts[update.type] = (counts[update.type] || 0) + 1;
          return counts;
        }, {});

        const summary = Object.entries(updateCounts)
          .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
          .join(', ');

        return `📊 *Multiple Updates*\n\n` +
          `📈 *${updates.length} notifications pending*\n` +
          `📝 *Summary:* ${summary}\n\n` +
          `_Tap to view all updates._`;
      },
      getKeyboard: (data: any) => {
        const updates = data.notifications || [];
        const buttons = updates.slice(0, 5).map((update: any) => ({
          text: `📋 ${update.title?.substring(0, 20) || 'Update'}`,
          callback_data: `notification_${update.id}`
        }));

        if (updates.length > 5) {
          buttons.push({ text: `📚 ${updates.length - 5} more...`, callback_data: 'view_all' });
        }

        return { inline_keyboard: [buttons] };
      },
      getPriority: () => 'medium',
      getMetadata: (context: TemplateContext) => ({
        batchSize: (context.event.data as any)?.notifications?.length || 0,
        type: 'batch_notification',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createSystemMaintenanceTemplate(): NotificationTemplate {
    return {
      type: 'system',
      title: '🔧 System Maintenance',
      message: (data: any) => {
        return `🔧 *System Maintenance Notice*\n\n` +
          `⚠️ *Scheduled maintenance in progress*\n\n` +
          `📅 *Start:* ${data.startTime || 'TBA'}\n` +
          `⏰ *Duration:* ${data.duration || 'Unknown'}\n` +
          `📝 *Reason:* ${data.reason || 'System improvements'}\n\n` +
          `_Some features may be temporarily unavailable. We apologize for the inconvenience._`;
      },
      getKeyboard: () => ({
        inline_keyboard: [
          [
            { text: '📊 System Status', callback_data: 'system_status' }
          ]
        ]
      }),
      getPriority: () => 'medium',
      getMetadata: (context: TemplateContext) => ({
        maintenanceType: (context.event.data as any)?.type,
        type: 'system_maintenance',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  private createPortfolioSummaryTemplate(): NotificationTemplate {
    return {
      type: 'system',
      title: '📊 Portfolio Summary',
      message: (data: any, preferences?: TelegramUserPreferences) => {
        const portfolio = data.portfolio || {};
        const totalValue = portfolio.totalValue || 0;
        const totalPnL = portfolio.totalPnL || 0;
        const pnlPercentage = portfolio.pnlPercentage || 0;
        const positionCount = portfolio.positionCount || 0;

        return `📊 *Portfolio Summary*\n\n` +
          `💰 *Total Value:* ${this.formatAmount(totalValue)}\n` +
          `📈 *Total PnL:* ${this.formatAmount(totalPnL)} (${this.formatPercentage(pnlPercentage)})\n` +
          `📊 *Active Positions:* ${positionCount}\n` +
          `⏰ *Last Updated:* ${this.formatTime(data.timestamp || Date.now())}\n\n` +
          `${totalPnL >= 0 ? '🎉' : '📉'} *Overall portfolio is ${totalPnL >= 0 ? 'profitable' : 'at a loss'}*`;
      },
      getKeyboard: (data: any) => ({
        inline_keyboard: [
          [
            { text: '📈 Detailed View', callback_data: 'portfolio_detailed' },
            { text: '📊 Performance', callback_data: 'portfolio_performance' }
          ],
          [
            { text: '🔄 Refresh', callback_data: 'portfolio_refresh' }
          ]
        ]
      }),
      getPriority: () => 'low',
      getMetadata: (context: TemplateContext) => ({
        totalValue: (context.event.data as any)?.portfolio?.totalValue,
        totalPnL: (context.event.data as any)?.portfolio?.totalPnL,
        type: 'portfolio_summary',
        timestamp: context.event.timestamp.getTime()
      })
    };
  }

  // Helper methods
  private calculateTransactionSignificance(transaction: PolymarketTransaction): number {
    // Calculate significance based on transaction amount relative to market size
    const amount = transaction.amount || 0;
    const marketVolume = transaction.marketVolume24h || 100000; // Default assumption

    return (amount / marketVolume) * 100;
  }

  public getAvailableTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  public addCustomTemplate(name: string, template: NotificationTemplate): void {
    this.templates.set(name, template);
  }

  public removeTemplate(name: string): boolean {
    return this.templates.delete(name);
  }
}

export default EnhancedNotificationTemplates;