import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { sanitizeInput } from '../utils';
import { RedisCacheManager } from '../../services/redis/cache-manager';
import { TrackedWallet } from '../../types/database';

export class UntrackHandler extends BaseCommandHandler {
  private cacheManager: RedisCacheManager;
  private readonly commandName = '/untrack';

  constructor(bot: Telegraf) {
    super(bot, '/untrack');
    this.cacheManager = new RedisCacheManager();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handleUntrack(ctx);
    });

    this.bot.action(/^confirm_untrack_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.confirmUntrack(ctx, address);
      }
    });

    this.bot.action(/^untrack_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.executeUntrack(ctx, address);
      }
    });

    logger.info('Untrack handler registered');
  }

  private async handleUntrack(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }

      const messageText = ctx.message?.text || '';
      const address = this.extractAddressFromCommand(messageText);

      if (!address) {
        await this.sendWalletSelection(ctx, userId);
        return;
      }

      const sanitizedAddress = sanitizeInput(address.trim());
      await this.confirmUntrack(ctx, sanitizedAddress);

    } catch (error) {
      logger.error('Error in /untrack command:', error);
      await ctx.reply('❌ An error occurred while processing your request. Please try again later.');
    }
  }

  private async confirmUntrack(ctx: Context, address: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const isTracked = await this.checkIfWalletTracked(userId, address);
      if (!isTracked) {
        await this.sendNotTrackedError(ctx, address);
        return;
      }

      const shortAddress = this.formatAddress(address);

      await ctx.reply(
        '⚠️ *Confirm Untrack Wallet*\n\n' +
        `Are you sure you want to stop tracking:\n` +
        `📍 *Address:* \`${address}\`\n` +
        `🏷️ *Short:* ${shortAddress}\n\n` +
        '*This will:*\n' +
        '• ❌ Stop all monitoring\n' +
        '• 🗑️ Delete notification history\n' +
        '• 📊 Remove from statistics\n\n' +
        '*This action cannot be undone.*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🗑️ Yes, Untrack', callback_data: `untrack_${address}` },
                { text: '❌ Cancel', callback_data: 'cancel_action' }
              ],
              [
                { text: '📋 View Details', callback_data: `wallet_details_${address}` },
                { text: '⚙️ Settings', callback_data: `wallet_settings_${address}` }
              ]
            ]
          }
        }
      );

    } catch (error) {
      logger.error('Error confirming untrack:', error);
      await ctx.reply('❌ Error processing untrack confirmation.');
    }
  }

  private async executeUntrack(ctx: Context, address: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await ctx.reply('⏳ Removing wallet from tracking...');

      const success = await this.removeWalletFromTracking(userId, address);

      if (success) {
        await this.removeWalletFromCache(userId, address);
        await this.sendUntrackSuccessMessage(ctx, address);
      } else {
        await ctx.reply('❌ Failed to remove wallet from tracking. Please try again later.');
      }

    } catch (error) {
      logger.error('Error executing untrack:', error);
      await ctx.reply('❌ An error occurred while removing the wallet.');
    }
  }

  private async sendWalletSelection(ctx: Context, userId: number): Promise<void> {
    try {
      const userWallets = await this.getUserWallets(userId);

      if (userWallets.length === 0) {
        await this.sendNoWalletsMessage(ctx);
        return;
      }

      const walletButtons = userWallets.map(wallet => [
        {
          text: `${this.formatAddress(wallet.wallet_address)} ${wallet.alias ? `(${wallet.alias})` : ''}`,
          callback_data: `untrack_${wallet.wallet_address}`
        }
      ]);

      await ctx.reply(
        '🗑️ *Select Wallet to Untrack*\n\n' +
        `You currently have ${userWallets.length} tracked wallet(s).\n\n` +
        '*Choose a wallet to remove:*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              ...walletButtons,
              [
                { text: '➕ Add New Wallet', callback_data: 'track_new_wallet' },
                { text: '📋 List All', callback_data: 'list_my_wallets' }
              ]
            ]
          }
        }
      );

    } catch (error) {
      logger.error('Error sending wallet selection:', error);
      await ctx.reply('❌ Error loading your wallet list. Please try again.');
    }
  }

  private async sendNoWalletsMessage(ctx: Context): Promise<void> {
    await ctx.reply(
      '📭 *No Tracked Wallets*\n\n' +
      "You don't have any wallets currently being tracked.\n\n" +
      '*Get started:*\n' +
      '• ➕ Use /track to add a wallet\n' +
      '• 📱 Send a wallet address directly\n' +
      '• 🔍 Scan QR code with wallet address\n\n' +
      '*Need help?* Use /help for examples.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Track Wallet', callback_data: 'track_new_wallet' },
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

  private async sendNotTrackedError(ctx: Context, address: string): Promise<void> {
    await ctx.reply(
      '❌ *Wallet Not Tracked*\n\n' +
      `The address \`${address}\` is not in your tracking list.\n\n` +
      '*Actions:*\n' +
      '• 📋 View your tracked wallets with /list\n' +
      '• ➕ Add this wallet with /track\n' +
      '• 📊 Check balance without tracking',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
              { text: '➕ Track This', callback_data: `track_address_${address}` }
            ],
            [
              { text: '💳 Check Balance', callback_data: `balance_${address}` }
            ]
          ]
        }
      }
    );
  }

  private async sendUntrackSuccessMessage(ctx: Context, address: string): Promise<void> {
    const shortAddress = this.formatAddress(address);

    await ctx.reply(
      '✅ *Wallet Untracked Successfully*\n\n' +
      `📍 *Address:* \`${address}\`\n` +
      `🏷️ *Short:* ${shortAddress}\n\n` +
      '*Removed:*\n' +
      '• ✅ Real-time monitoring\n' +
      '• ✅ Transaction notifications\n' +
      '• ✅ Position alerts\n' +
      '• ✅ Price notifications\n\n' +
      '*Data retained:*\n' +
      '• 📊 Historical statistics\n' +
      '• 📝 Transaction history\n\n' +
      '*Next steps:*\n' +
      '• Use /track to add new wallets\n' +
      '• Use /list to see remaining wallets',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
              { text: '➕ Add New', callback_data: 'track_new_wallet' }
            ],
            [
              { text: '⚙️ Preferences', callback_data: 'open_preferences' },
              { text: '📊 Statistics', callback_data: 'show_statistics' }
            ]
          ]
        }
      }
    );
  }

  private extractAddressFromCommand(messageText: string): string | null {
    const parts = messageText.trim().split(/\s+/);
    if (parts.length < 2) return null;
    return parts[1];
  }

  private async checkIfWalletTracked(userId: number, address: string): Promise<boolean> {
    try {
      const cached = await this.cacheManager.getCachedData(`user_wallets:${userId}`);
      if (cached && cached[address]) {
        return true;
      }

      const userWallets = await this.getUserWallets(userId);
      return userWallets.some(wallet => wallet.wallet_address === address);

    } catch (error) {
      logger.error('Error checking if wallet is tracked:', error);
      return false;
    }
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

  private async removeWalletFromTracking(userId: number, address: string): Promise<boolean> {
    try {
      await this.cacheManager.deleteCachedData(`user_wallets:${userId}`);

      return true;
    } catch (error) {
      logger.error('Error removing wallet from tracking:', error);
      return false;
    }
  }

  private async removeWalletFromCache(userId: number, address: string): Promise<void> {
    try {
      const cached = await this.cacheManager.getCachedData(`user_wallets:${userId}`);
      if (cached && cached[address]) {
        delete cached[address];
        await this.cacheManager.setCachedData(`user_wallets:${userId}`, cached, 3600);
      }

      await this.cacheManager.deleteCachedData(`wallet_data:${address}`);

    } catch (error) {
      logger.error('Error removing wallet from cache:', error);
    }
  }

  private formatAddress(address: string): string {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  getCommandDescription(): string {
    return 'Stop tracking a wallet address - Usage: /untrack <address>';
  }

  getCommandExamples(): string[] {
    return [
      '/untrack 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
      '/untrack',
      'Use /untrack without address to select from your tracked wallets'
    ];
  }
}