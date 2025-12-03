import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { RedisCacheManager } from '../../services/redis/cache-manager';
import { TrackedWallet } from '../../types/database';

interface ListState {
  page: number;
  totalPages: number;
  wallets: TrackedWallet[];
  sortBy: 'created_at' | 'updated_at' | 'alias';
  sortOrder: 'asc' | 'desc';
}

export class ListHandler extends BaseCommandHandler {
  private cacheManager: RedisCacheManager;
  private readonly commandName = '/list';
  private readonly WALLETS_PER_PAGE = 8;

  constructor(bot: Telegraf) {
    super(bot, '/list');
    this.cacheManager = new RedisCacheManager();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handleList(ctx);
    });

    this.bot.action(/^list_page_(\d+)$/, async (ctx) => {
      const page = parseInt(ctx.match?.[1] || '1');
      await this.handleListPagination(ctx, page);
    });

    this.bot.action(/^list_sort_(.+)$/, async (ctx) => {
      const sortBy = ctx.match?.[1] as 'created_at' | 'updated_at' | 'alias';
      if (sortBy) {
        await this.handleListSort(ctx, sortBy);
      }
    });

    this.bot.action('list_my_wallets', async (ctx) => {
      await this.handleList(ctx);
    });

    this.bot.action('wallet_details_(.+)', async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.showWalletDetails(ctx, address);
      }
    });

    logger.info('List handler registered');
  }

  private async handleList(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }

      await ctx.reply('📋 Loading your wallets...');

      const userWallets = await this.getUserWallets(userId);

      if (userWallets.length === 0) {
        await this.sendNoWalletsList(ctx);
        return;
      }

      const listState: ListState = {
        page: 1,
        totalPages: Math.ceil(userWallets.length / this.WALLETS_PER_PAGE),
        wallets: userWallets,
        sortBy: 'created_at',
        sortOrder: 'desc'
      };

      await this.sendWalletList(ctx, listState, userId);

    } catch (error) {
      logger.error('Error in /list command:', error);
      await ctx.reply('❌ An error occurred while loading your wallets. Please try again later.');
    }
  }

  private async handleListPagination(ctx: Context, page: number): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const userWallets = await this.getUserWallets(userId);
      if (userWallets.length === 0) {
        await this.sendNoWalletsList(ctx);
        return;
      }

      const cachedState = await this.cacheManager.getCachedData(`list_state:${userId}`);
      const sortBy = cachedState?.sortBy || 'created_at';
      const sortOrder = cachedState?.sortOrder || 'desc';

      const listState: ListState = {
        page: Math.max(1, Math.min(page, Math.ceil(userWallets.length / this.WALLETS_PER_PAGE))),
        totalPages: Math.ceil(userWallets.length / this.WALLETS_PER_PAGE),
        wallets: userWallets,
        sortBy,
        sortOrder
      };

      await this.sendWalletList(ctx, listState, userId);

    } catch (error) {
      logger.error('Error handling list pagination:', error);
      await ctx.reply('❌ Error loading wallet list page.');
    }
  }

  private async handleListSort(ctx: Context, sortBy: 'created_at' | 'updated_at' | 'alias'): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const userWallets = await this.getUserWallets(userId);
      if (userWallets.length === 0) {
        await this.sendNoWalletsList(ctx);
        return;
      }

      const cachedState = await this.cacheManager.getCachedData(`list_state:${userId}`);
      const sortOrder = cachedState?.sortOrder || 'desc';

      const listState: ListState = {
        page: 1,
        totalPages: Math.ceil(userWallets.length / this.WALLETS_PER_PAGE),
        wallets: userWallets,
        sortBy,
        sortOrder
      };

      await this.cacheManager.setCachedData(`list_state:${userId}`, {
        sortBy,
        sortOrder
      }, 3600);

      await this.sendWalletList(ctx, listState, userId);

    } catch (error) {
      logger.error('Error handling list sort:', error);
      await ctx.reply('❌ Error sorting wallet list.');
    }
  }

  private async sendWalletList(ctx: Context, state: ListState, userId: number): Promise<void> {
    try {
      const sortedWallets = this.sortWallets(state.wallets, state.sortBy, state.sortOrder);
      const startIndex = (state.page - 1) * this.WALLETS_PER_PAGE;
      const endIndex = startIndex + this.WALLETS_PER_PAGE;
      const pageWallets = sortedWallets.slice(startIndex, endIndex);

      const messageText = this.buildListMessage(state, pageWallets);
      const replyMarkup = this.buildListKeyboard(state, pageWallets);

      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });

      await this.cacheManager.setCachedData(`list_state:${userId}`, {
        sortBy: state.sortBy,
        sortOrder: state.sortOrder
      }, 3600);

    } catch (error) {
      logger.error('Error sending wallet list:', error);
      await ctx.reply('❌ Error displaying wallet list.');
    }
  }

  private buildListMessage(state: ListState, wallets: TrackedWallet[]): string {
    let message = `💼 *Your Tracked Wallets*\n\n`;
    message += `📊 *Total:* ${state.wallets.length} wallets | 📖 *Page:* ${state.page}/${state.totalPages}\n\n`;

    if (wallets.length === 0) {
      message += 'No wallets on this page.\n';
    } else {
      wallets.forEach((wallet, index) => {
        const address = wallet.wallet_address;
        const shortAddress = this.formatAddress(address);
        const alias = wallet.alias || 'No alias';
        const status = wallet.is_active ? '🟢' : '🔴';
        const created = new Date(wallet.created_at).toLocaleDateString();
        const lastActivity = wallet.last_activity_at
          ? new Date(wallet.last_activity_at).toLocaleDateString()
          : 'Never';

        message += `${startIndex + index + 1}. ${status} *${alias}*\n`;
        message += `   📍 \`${shortAddress}\`\n`;
        message += `   📅 Added: ${created} | 💬 Activity: ${lastActivity}\n\n`;
      });
    }

    message += `*Sorted by:* ${this.formatSortBy(state.sortBy)} (${state.sortOrder})\n`;
    message += `*Page ${state.page} of ${state.totalPages}*`;

    return message;
  }

  private buildListKeyboard(state: ListState, wallets: TrackedWallet[]): any {
    const keyboard = [];

    wallets.forEach(wallet => {
      const shortAddress = this.formatAddress(wallet.wallet_address);
      const alias = wallet.alias || shortAddress;
      const buttonRow = [
        {
          text: `${wallet.is_active ? '🟢' : '🔴'} ${alias}`,
          callback_data: `wallet_details_${wallet.wallet_address}`
        },
        {
          text: '💳',
          callback_data: `balance_${wallet.wallet_address}`
        },
        {
          text: '⚙️',
          callback_data: `wallet_settings_${wallet.wallet_address}`
        }
      ];
      keyboard.push(buttonRow);
    });

    const paginationRow = [];
    if (state.page > 1) {
      paginationRow.push({
        text: '⬅️ Previous',
        callback_data: `list_page_${state.page - 1}`
      });
    }

    paginationRow.push({
      text: `${state.page}/${state.totalPages}`,
      callback_data: 'list_info'
    });

    if (state.page < state.totalPages) {
      paginationRow.push({
        text: 'Next ➡️',
        callback_data: `list_page_${state.page + 1}`
      });
    }

    if (paginationRow.length > 0) {
      keyboard.push(paginationRow);
    }

    const sortRow = [
      {
        text: `📅 ${state.sortBy === 'created_at' ? '✓' : ''} Date`,
        callback_data: 'list_sort_created_at'
      },
      {
        text: `🏷️ ${state.sortBy === 'alias' ? '✓' : ''} Name`,
        callback_data: 'list_sort_alias'
      },
      {
        text: `↕️ ${state.sortOrder === 'asc' ? '↑' : '↓'}`,
        callback_data: `list_sort_order_${state.sortOrder === 'asc' ? 'desc' : 'asc'}`
      }
    ];
    keyboard.push(sortRow);

    const actionRow = [
      {
        text: '➕ Add Wallet',
        callback_data: 'track_new_wallet'
      },
      {
        text: '📊 Stats',
        callback_data: 'show_statistics'
      },
      {
        text: '⚙️ Preferences',
        callback_data: 'open_preferences'
      }
    ];
    keyboard.push(actionRow);

    return { inline_keyboard: keyboard };
  }

  private async showWalletDetails(ctx: Context, address: string): Promise<void> {
    try {
      await ctx.editMessageText(
        `🔍 *Wallet Details*\n\n` +
        `📍 *Address:* \`${address}\`\n` +
        `🏷️ *Short:* ${this.formatAddress(address)}\n\n` +
        `*Actions:*\n` +
        `• 💳 Check balance\n` +
        `• 📊 View activity\n` +
        `• ⚙️ Edit settings\n` +
        `• 🗑️ Remove tracking`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💳 Balance', callback_data: `balance_${address}` },
                { text: '📊 Activity', callback_data: `activity_${address}` }
              ],
              [
                { text: '⚙️ Settings', callback_data: `wallet_settings_${address}` },
                { text: '🗑️ Untrack', callback_data: `confirm_untrack_${address}` }
              ],
              [
                { text: '⬅️ Back to List', callback_data: 'list_my_wallets' }
              ]
            ]
          }
        }
      );

    } catch (error) {
      logger.error('Error showing wallet details:', error);
      await ctx.reply('❌ Error loading wallet details.');
    }
  }

  private async sendNoWalletsList(ctx: Context): Promise<void> {
    await ctx.reply(
      '📭 *No Tracked Wallets*\n\n' +
      "You don't have any wallets currently being tracked.\n\n" +
      '*Get started:*\n' +
      '• ➕ Use /track to add a wallet\n' +
      '• 📱 Send a wallet address directly\n' +
      '• 🔍 Scan QR code with wallet address\n\n' +
      '*Benefits of tracking:*\n' +
      '• 💰 Real-time transaction alerts\n' +
      '• 📊 Position tracking\n' +
      '• 📈 Price movement notifications\n' +
      '• 📋 Activity history',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add First Wallet', callback_data: 'track_new_wallet' },
              { text: '📖 Learn More', callback_data: 'help_tracking' }
            ],
            [
              { text: '⚙️ Preferences', callback_data: 'open_preferences' },
              { text: '❓ Help', callback_data: 'show_help' }
            ]
          ]
        }
      }
    );
  }

  private async getUserWallets(userId: number): Promise<TrackedWallet[]> {
    try {
      const cached = await this.cacheManager.getCachedData(`user_wallets:${userId}`);
      if (cached) {
        return Object.values(cached) as TrackedWallet[];
      }

      const wallets: TrackedWallet[] = [];
      return wallets;

    } catch (error) {
      logger.error('Error getting user wallets:', error);
      return [];
    }
  }

  private sortWallets(
    wallets: TrackedWallet[],
    sortBy: 'created_at' | 'updated_at' | 'alias',
    sortOrder: 'asc' | 'desc'
  ): TrackedWallet[] {
    return [...wallets].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'created_at':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'updated_at':
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
        case 'alias':
          const aliasA = (a.alias || a.wallet_address).toLowerCase();
          const aliasB = (b.alias || b.wallet_address).toLowerCase();
          comparison = aliasA.localeCompare(aliasB);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  private formatSortBy(sortBy: string): string {
    switch (sortBy) {
      case 'created_at': return 'Date Added';
      case 'updated_at': return 'Last Updated';
      case 'alias': return 'Name';
      default: return sortBy;
    }
  }

  private formatAddress(address: string): string {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  getCommandDescription(): string {
    return 'List all tracked wallets with pagination - Usage: /list [page]';
  }

  getCommandExamples(): string[] {
    return [
      '/list - Show first page of wallets',
      '/list 2 - Show second page of wallets'
    ];
  }
}