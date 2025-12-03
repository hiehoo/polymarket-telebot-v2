import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { sanitizeInput } from '../utils';
import { RedisCacheManager } from '../../services/redis/cache-manager';
import { TrackedWallet, WalletActivity } from '../../types/database';

interface HistoryState {
  page: number;
  totalPages: number;
  activities: WalletActivity[];
  filter: 'all' | 'transactions' | 'positions' | 'resolutions' | 'notifications';
  sortBy: 'occurred_at' | 'activity_type';
  sortOrder: 'desc' | 'asc';
  walletAddress?: string;
}

interface HistoryItem {
  id: string;
  type: 'transaction' | 'position_update' | 'resolution' | 'price_alert' | 'notification';
  walletAddress: string;
  walletAlias?: string;
  title: string;
  description: string;
  amount?: number;
  currency?: string;
  timestamp: Date;
  status: 'confirmed' | 'pending' | 'failed';
  metadata?: any;
}

export class HistoryHandler extends BaseCommandHandler {
  private cacheManager: RedisCacheManager;
  private readonly commandName = '/history';
  private readonly ITEMS_PER_PAGE = 10;

  constructor(bot: Telegraf) {
    super(bot, '/history');
    this.cacheManager = new RedisCacheManager();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handleHistory(ctx);
    });

    this.bot.action(/^history_page_(\d+)$/, async (ctx) => {
      const page = parseInt(ctx.match?.[1] || '1');
      await this.handleHistoryPagination(ctx, page);
    });

    this.bot.action(/^history_filter_(.+)$/, async (ctx) => {
      const filter = ctx.match?.[1] as HistoryState['filter'];
      if (filter) {
        await this.handleHistoryFilter(ctx, filter);
      }
    });

    this.bot.action(/^history_wallet_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.showWalletHistory(ctx, address);
      }
    });

    this.bot.action(/^history_sort_(.+)$/, async (ctx) => {
      const sortBy = ctx.match?.[1] as HistoryState['sortBy'];
      if (sortBy) {
        await this.handleHistorySort(ctx, sortBy);
      }
    });

    this.bot.action(/^history_details_(.+)$/, async (ctx) => {
      const itemId = ctx.match?.[1];
      if (itemId) {
        await this.showHistoryDetails(ctx, itemId);
      }
    });

    logger.info('History handler registered');
  }

  private async handleHistory(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }

      const messageText = ctx.message?.text || '';
      const parts = messageText.trim().split(/\s+/);

      const filter = this.extractFilter(parts);
      const address = this.extractAddress(parts);

      await ctx.reply('📜 Loading your history...');

      const historyState: HistoryState = {
        page: 1,
        totalPages: 1,
        activities: [],
        filter: filter || 'all',
        sortBy: 'occurred_at',
        sortOrder: 'desc',
        walletAddress: address
      };

      await this.loadAndShowHistory(ctx, userId, historyState);

    } catch (error) {
      logger.error('Error in /history command:', error);
      await ctx.reply('❌ An error occurred while loading your history. Please try again later.');
    }
  }

  private async handleHistoryPagination(ctx: Context, page: number): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const cachedState = await this.getHistoryState(userId);
      if (!cachedState) return;

      cachedState.page = Math.max(1, page);
      await this.saveHistoryState(userId, cachedState);

      await this.showHistoryPage(ctx, cachedState);

    } catch (error) {
      logger.error('Error handling history pagination:', error);
      await ctx.reply('❌ Error loading history page.');
    }
  }

  private async handleHistoryFilter(ctx: Context, filter: HistoryState['filter']): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const cachedState = await this.getHistoryState(userId);
      const historyState: HistoryState = {
        ...cachedState,
        page: 1,
        filter
      };

      await this.saveHistoryState(userId, historyState);
      await this.loadAndShowHistory(ctx, userId, historyState);

    } catch (error) {
      logger.error('Error handling history filter:', error);
      await ctx.reply('❌ Error applying history filter.');
    }
  }

  private async showWalletHistory(ctx: Context, address: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await ctx.editMessageText('📜 Loading wallet history...');

      const historyState: HistoryState = {
        page: 1,
        totalPages: 1,
        activities: [],
        filter: 'all',
        sortBy: 'occurred_at',
        sortOrder: 'desc',
        walletAddress: address
      };

      await this.loadAndShowHistory(ctx, userId, historyState);

    } catch (error) {
      logger.error('Error showing wallet history:', error);
      await ctx.editMessageText('❌ Error loading wallet history.');
    }
  }

  private async handleHistorySort(ctx: Context, sortBy: HistoryState['sortBy']): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const cachedState = await this.getHistoryState(userId);
      if (!cachedState) return;

      const historyState: HistoryState = {
        ...cachedState,
        page: 1,
        sortBy,
        sortOrder: cachedState.sortOrder === 'desc' ? 'asc' : 'desc'
      };

      await this.saveHistoryState(userId, historyState);
      await this.loadAndShowHistory(ctx, userId, historyState);

    } catch (error) {
      logger.error('Error handling history sort:', error);
      await ctx.reply('❌ Error sorting history.');
    }
  }

  private async showHistoryDetails(ctx: Context, itemId: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await ctx.editMessageText('📋 Loading history details...');

      const item = await this.getHistoryItem(userId, itemId);
      if (!item) {
        await ctx.editMessageText('❌ History item not found.');
        return;
      }

      await this.sendHistoryDetails(ctx, item);

    } catch (error) {
      logger.error('Error showing history details:', error);
      await ctx.editMessageText('❌ Error loading history details.');
    }
  }

  private async loadAndShowHistory(ctx: Context, userId: number, state: HistoryState): Promise<void> {
    try {
      const activities = await this.getUserActivities(userId, state);
      state.activities = activities;
      state.totalPages = Math.ceil(activities.length / this.ITEMS_PER_PAGE);

      await this.saveHistoryState(userId, state);
      await this.showHistoryPage(ctx, state);

    } catch (error) {
      logger.error('Error loading and showing history:', error);
      await ctx.reply('❌ Error loading history data.');
    }
  }

  private async showHistoryPage(ctx: Context, state: HistoryState): Promise<void> {
    try {
      const startIndex = (state.page - 1) * this.ITEMS_PER_PAGE;
      const endIndex = startIndex + this.ITEMS_PER_PAGE;
      const pageActivities = state.activities.slice(startIndex, endIndex);

      if (pageActivities.length === 0 && state.page === 1) {
        await this.sendNoHistoryMessage(ctx, state);
        return;
      }

      const historyItems = await this.convertActivitiesToItems(pageActivities);
      const messageText = this.buildHistoryMessage(state, historyItems);
      const replyMarkup = this.buildHistoryKeyboard(state, historyItems);

      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });

    } catch (error) {
      logger.error('Error showing history page:', error);
      await ctx.reply('❌ Error displaying history.');
    }
  }

  private buildHistoryMessage(state: HistoryState, items: HistoryItem[]): string {
    const walletInfo = state.walletAddress
      ? ` for ${this.formatAddress(state.walletAddress)}`
      : '';

    let message = `📜 *Activity History${walletInfo}*\n\n`;
    message += `📊 *Filter:* ${this.formatFilter(state.filter)} | 📖 *Page:* ${state.page}/${state.totalPages}\n\n`;

    if (items.length === 0) {
      message += 'No activities found for this page.\n';
    } else {
      items.forEach((item, index) => {
        const time = this.formatTime(item.timestamp);
        const typeEmoji = this.getTypeEmoji(item.type);
        const statusEmoji = this.getStatusEmoji(item.status);

        message += `${startIndex + index + 1}. ${typeEmoji} ${statusEmoji} *${item.title}*\n`;
        message += `   📅 ${time} | ${this.formatAddress(item.walletAddress)}\n`;
        if (item.amount && item.currency) {
          message += `   💰 ${this.formatAmount(item.amount, item.currency)}\n`;
        }
        message += '\n';
      });
    }

    message += `*Sorted by:* ${this.formatSortBy(state.sortBy)} (${state.sortOrder})`;
    return message;
  }

  private buildHistoryKeyboard(state: HistoryState, items: HistoryItem[]): any {
    const keyboard = [];

    items.forEach(item => {
      const shortAddress = this.formatAddress(item.walletAddress);
      const buttonRow = [
        {
          text: `${this.getTypeEmoji(item.type)} ${this.getStatusEmoji(item.status)} ${item.title.substring(0, 20)}...`,
          callback_data: `history_details_${item.id}`
        }
      ];
      keyboard.push(buttonRow);
    });

    const paginationRow = [];
    if (state.page > 1) {
      paginationRow.push({
        text: '⬅️ Previous',
        callback_data: `history_page_${state.page - 1}`
      });
    }

    paginationRow.push({
      text: `${state.page}/${state.totalPages}`,
      callback_data: 'history_info'
    });

    if (state.page < state.totalPages) {
      paginationRow.push({
        text: 'Next ➡️',
        callback_data: `history_page_${state.page + 1}`
      });
    }

    if (paginationRow.length > 0) {
      keyboard.push(paginationRow);
    }

    const filterRow = [
      { text: `${state.filter === 'all' ? '✅' : ''} All`, callback_data: 'history_filter_all' },
      { text: `${state.filter === 'transactions' ? '✅' : ''} 💰`, callback_data: 'history_filter_transactions' },
      { text: `${state.filter === 'positions' ? '✅' : ''} 📊`, callback_data: 'history_filter_positions' }
    ];
    keyboard.push(filterRow);

    const moreFiltersRow = [
      { text: `${state.filter === 'resolutions' ? '✅' : ''} 🎯`, callback_data: 'history_filter_resolutions' },
      { text: `${state.filter === 'notifications' ? '✅' : ''} 🔔`, callback_data: 'history_filter_notifications' },
      { text: `📅 ${state.sortBy === 'occurred_at' ? '↕️' : ''}`, callback_data: 'history_sort_occurred_at' }
    ];
    keyboard.push(moreFiltersRow);

    const actionRow = [
      { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
      { text: '💳 Balance', callback_data: 'balance_all' },
      { text: '⚙️ Preferences', callback_data: 'open_preferences' }
    ];
    keyboard.push(actionRow);

    return { inline_keyboard: keyboard };
  }

  private async sendHistoryDetails(ctx: Context, item: HistoryItem): Promise<void> {
    const messageText =
      `📋 *History Details*\n\n` +
      `🏷️ *Title:* ${item.title}\n` +
      `📝 *Description:* ${item.description}\n\n` +
      `📍 *Wallet:* \`${item.walletAddress}\`\n` +
      `🏷️ *Alias:* ${item.walletAlias || this.formatAddress(item.walletAddress)}\n` +
      `🎯 *Type:* ${this.formatType(item.type)}\n` +
      `✅ *Status:* ${this.formatStatus(item.status)}\n\n` +
      `💰 *Amount:* ${item.amount && item.currency ? this.formatAmount(item.amount, item.currency) : 'N/A'}\n` +
      `📅 *Time:* ${item.timestamp.toLocaleString()}\n` +
      `🆔 *ID:* \`${item.id}\`\n\n` +
      `*Actions:*`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '💳 Check Balance', callback_data: `balance_${item.walletAddress}` },
          { text: '📊 Wallet Activity', callback_data: `history_wallet_${item.walletAddress}` }
        ],
        [
          { text: '⚙️ Wallet Settings', callback_data: `wallet_settings_${item.walletAddress}` },
          { text: '⬅️ Back to History', callback_data: 'history_page_1' }
        ]
      ]
    };

    await ctx.editMessageText(messageText, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  }

  private async sendNoHistoryMessage(ctx: Context, state: HistoryState): Promise<void> {
    const walletInfo = state.walletAddress
      ? ` for ${this.formatAddress(state.walletAddress)}`
      : '';

    await ctx.editMessageText(
      `📭 *No Activity History${walletInfo}*\n\n` +
      `${state.walletAddress
        ? `No activity found for wallet ${this.formatAddress(state.walletAddress)}.\n\n`
        : "You don't have any tracked activity yet.\n\n"
      }` +
      '*Get started:*\n' +
      '• ➕ Use /track to add wallets\n' +
      '• 💳 Use /balance to check balances\n' +
      '• 🔔 Enable notifications for alerts\n\n' +
      '*Types of activity tracked:*\n' +
      '• 💰 Transactions and transfers\n' +
      '• 📊 Position updates and changes\n' +
      '• 🎯 Market resolutions\n' +
      '• 🔔 Price alerts and notifications',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: state.walletAddress ? [
            [
              { text: '💳 Check Balance', callback_data: `balance_${state.walletAddress}` },
              { text: '⚙️ Settings', callback_data: `wallet_settings_${state.walletAddress}` }
            ],
            [
              { text: '📋 All Wallets', callback_data: 'list_my_wallets' },
              { text: '➕ Add More', callback_data: 'track_new_wallet' }
            ]
          ] : [
            [
              { text: '➕ Add Wallet', callback_data: 'track_new_wallet' },
              { text: '💳 Check Balance', callback_data: 'balance_all' }
            ],
            [
              { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
              { text: '⚙️ Preferences', callback_data: 'open_preferences' }
            ]
          ]
        }
      }
    );
  }

  private async getUserActivities(userId: number, state: HistoryState): Promise<WalletActivity[]> {
    try {
      const cacheKey = `user_activities:${userId}:${state.filter}:${state.walletAddress || 'all'}`;
      const cached = await this.cacheManager.getCachedData(cacheKey);

      if (cached) {
        return this.sortActivities(cached, state.sortBy, state.sortOrder);
      }

      const activities = this.generateMockActivities(userId, state);
      await this.cacheManager.setCachedData(cacheKey, activities, 300);

      return this.sortActivities(activities, state.sortBy, state.sortOrder);

    } catch (error) {
      logger.error('Error getting user activities:', error);
      return [];
    }
  }

  private async convertActivitiesToItems(activities: WalletActivity[]): Promise<HistoryItem[]> {
    return activities.map(activity => ({
      id: activity.id,
      type: activity.activity_type as HistoryItem['type'],
      walletAddress: activity.wallet_address,
      title: this.generateActivityTitle(activity),
      description: this.generateActivityDescription(activity),
      amount: activity.activity_data?.amount,
      currency: activity.activity_data?.currency || 'USD',
      timestamp: new Date(activity.occurred_at),
      status: this.getActivityStatus(activity),
      metadata: activity.activity_data
    }));
  }

  private generateMockActivities(userId: number, state: HistoryState): WalletActivity[] {
    const activities: WalletActivity[] = [];
    const now = Date.now();
    const filters = {
      all: ['transaction', 'position_update', 'resolution', 'notification'],
      transactions: ['transaction'],
      positions: ['position_update'],
      resolutions: ['resolution'],
      notifications: ['notification']
    };

    const allowedTypes = filters[state.filter];
    const count = Math.floor(Math.random() * 30) + 10;

    for (let i = 0; i < count; i++) {
      const type = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
      const timestamp = new Date(now - (i * 3600000));

      activities.push({
        id: `activity_${i}_${userId}`,
        wallet_address: state.walletAddress || `0x${Math.random().toString(16).substr(2, 40)}`,
        activity_type: type,
        activity_data: this.generateMockActivityData(type),
        occurred_at: timestamp,
        processed_at: timestamp,
        is_processed: true
      });
    }

    return activities;
  }

  private generateMockActivityData(type: string): any {
    switch (type) {
      case 'transaction':
        return {
          amount: Math.random() * 10000,
          currency: 'USD',
          hash: `0x${Math.random().toString(16).substr(2, 64)}`,
          from: `0x${Math.random().toString(16).substr(2, 40)}`,
          to: `0x${Math.random().toString(16).substr(2, 40)}`
        };
      case 'position_update':
        return {
          condition_id: `cond_${Math.random().toString(16).substr(2, 16)}`,
          old_shares: Math.random() * 100,
          new_shares: Math.random() * 100,
          price: Math.random() * 100
        };
      case 'resolution':
        return {
          condition_id: `cond_${Math.random().toString(16).substr(2, 16)}`,
          outcome: Math.random() > 0.5 ? 'YES' : 'NO',
          probability: Math.random()
        };
      case 'notification':
        return {
          type: 'price_alert',
          threshold: Math.random() * 100,
          current_value: Math.random() * 100
        };
      default:
        return {};
    }
  }

  private sortActivities(activities: WalletActivity[], sortBy: string, sortOrder: string): WalletActivity[] {
    return [...activities].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'occurred_at':
          comparison = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
          break;
        case 'activity_type':
          comparison = a.activity_type.localeCompare(b.activity_type);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  private async getHistoryItem(userId: number, itemId: string): Promise<HistoryItem | null> {
    try {
      const activities = await this.getUserActivities(userId, { filter: 'all' } as any);
      const items = await this.convertActivitiesToItems(activities);
      return items.find(item => item.id === itemId) || null;

    } catch (error) {
      logger.error('Error getting history item:', error);
      return null;
    }
  }

  private async getHistoryState(userId: number): Promise<HistoryState | null> {
    try {
      return await this.cacheManager.getCachedData(`history_state:${userId}`);
    } catch (error) {
      logger.error('Error getting history state:', error);
      return null;
    }
  }

  private async saveHistoryState(userId: number, state: HistoryState): Promise<void> {
    try {
      await this.cacheManager.setCachedData(`history_state:${userId}`, state, 1800);
    } catch (error) {
      logger.error('Error saving history state:', error);
    }
  }

  private extractFilter(parts: string[]): HistoryState['filter'] | null {
    const filters = ['all', 'transactions', 'positions', 'resolutions', 'notifications'];
    const found = parts.find(part => filters.includes(part.toLowerCase()));
    return found?.toLowerCase() as HistoryState['filter'] || null;
  }

  private extractAddress(parts: string[]): string | null {
    const addressRegex = /^0x[a-f0-9]{40}$|^[1-9a-hj-np-z]{32,44}$/;
    const found = parts.find(part => addressRegex.test(part));
    return found || null;
  }

  private generateActivityTitle(activity: WalletActivity): string {
    switch (activity.activity_type) {
      case 'transaction':
        return `Transaction ${activity.activity_data?.hash?.slice(0, 10) || 'Unknown'}`;
      case 'position_update':
        return `Position Update - ${activity.activity_data?.condition_id || 'Unknown'}`;
      case 'resolution':
        return `Market Resolution - ${activity.activity_data?.outcome || 'Unknown'}`;
      case 'notification':
        return `${activity.activity_data?.type || 'Alert'} Notification`;
      default:
        return 'Activity';
    }
  }

  private generateActivityDescription(activity: WalletActivity): string {
    switch (activity.activity_type) {
      case 'transaction':
        return `Transfer of ${activity.activity_data?.amount || 0} ${activity.activity_data?.currency || 'USD'}`;
      case 'position_update':
        return `Position changed from ${activity.activity_data?.old_shares || 0} to ${activity.activity_data?.new_shares || 0} shares`;
      case 'resolution':
        return `Market resolved with outcome: ${activity.activity_data?.outcome || 'Unknown'}`;
      case 'notification':
        return `Alert triggered: ${activity.activity_data?.type || 'Unknown'}`;
      default:
        return 'Unknown activity';
    }
  }

  private getActivityStatus(activity: WalletActivity): HistoryItem['status'] {
    if (activity.is_processed) {
      return 'confirmed';
    } else if (activity.processed_at) {
      return 'pending';
    } else {
      return 'failed';
    }
  }

  private getTypeEmoji(type: HistoryItem['type']): string {
    const emojis = {
      transaction: '💰',
      position_update: '📊',
      resolution: '🎯',
      price_alert: '📈',
      notification: '🔔'
    };
    return emojis[type] || '📋';
  }

  private getStatusEmoji(status: HistoryItem['status']): string {
    const emojis = {
      confirmed: '✅',
      pending: '⏳',
      failed: '❌'
    };
    return emojis[status] || '❓';
  }

  private formatFilter(filter: string): string {
    const filters = {
      all: 'All Activity',
      transactions: '💰 Transactions',
      positions: '📊 Positions',
      resolutions: '🎯 Resolutions',
      notifications: '🔔 Notifications'
    };
    return filters[filter as keyof typeof filters] || filter;
  }

  private formatType(type: HistoryItem['type']): string {
    const types = {
      transaction: 'Transaction',
      position_update: 'Position Update',
      resolution: 'Market Resolution',
      price_alert: 'Price Alert',
      notification: 'Notification'
    };
    return types[type] || type;
  }

  private formatStatus(status: HistoryItem['status']): string {
    const statuses = {
      confirmed: 'Confirmed ✅',
      pending: 'Pending ⏳',
      failed: 'Failed ❌'
    };
    return statuses[status] || status;
  }

  private formatSortBy(sortBy: string): string {
    const sortByOptions = {
      occurred_at: 'Date',
      activity_type: 'Type'
    };
    return sortByOptions[sortBy as keyof typeof sortByOptions] || sortBy;
  }

  private formatAmount(amount: number, currency: string): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(amount);
  }

  private formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else {
      return 'Recently';
    }
  }

  private formatAddress(address: string): string {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  getCommandDescription(): string {
    return 'View recent wallet activity and transaction history - Usage: /history [filter] [address]';
  }

  getCommandExamples(): string[] {
    return [
      '/history - Show all recent activity',
      '/history transactions - Show only transactions',
      '/history 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0 - Show wallet history',
      '/history positions 0x742d... - Show positions for specific wallet'
    ];
  }
}