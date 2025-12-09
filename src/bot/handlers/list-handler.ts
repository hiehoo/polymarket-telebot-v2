import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { getWalletActivityTracker } from '../../services/wallet-tracker';
import { getWalletTrackerRepository } from '../../services/wallet-tracker';

interface WalletInfo {
  address: string;
  alias?: string;
}

export class ListHandler extends BaseCommandHandler {
  private readonly commandName = '/list';

  constructor(bot: Telegraf) {
    super(bot, '/list');
  }

  private get tracker() {
    return getWalletActivityTracker();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handleList(ctx);
    });

    this.bot.action('list_my_wallets', async (ctx) => {
      await this.handleList(ctx);
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

      const wallets = await this.getUserWallets(userId);

      if (wallets.length === 0) {
        await this.sendNoWalletsList(ctx);
        return;
      }

      await this.sendWalletList(ctx, wallets);

    } catch (error) {
      logger.error('Error in /list command:', error);
      await ctx.reply('❌ An error occurred while loading your wallets. Please try again later.');
    }
  }

  private async sendWalletList(ctx: Context, wallets: WalletInfo[]): Promise<void> {
    try {
      let message = `💼 *Your Tracked Wallets*\n\n`;
      message += `📊 *Total:* ${wallets.length} wallet(s)\n\n`;

      wallets.forEach((wallet, index) => {
        const shortAddress = this.formatAddress(wallet.address);
        const displayName = wallet.alias || shortAddress;
        message += `${index + 1}. 🟢 *${displayName}*\n`;
        message += `   📍 \`${shortAddress}\`\n\n`;
      });

      const keyboard = wallets.map(wallet => {
        const shortAddress = this.formatAddress(wallet.address);
        const displayName = wallet.alias || shortAddress;
        return [
          { text: `🟢 ${displayName}`, callback_data: `balance_${wallet.address}` },
          { text: '🗑️', callback_data: `confirm_untrack_${wallet.address}` }
        ];
      });

      keyboard.push([
        { text: '➕ Add Wallet', callback_data: 'track_new_wallet' }
      ]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      logger.error('Error sending wallet list:', error);
      await ctx.reply('❌ Error displaying wallet list.');
    }
  }

  private async sendNoWalletsList(ctx: Context): Promise<void> {
    await ctx.reply(
      '📭 *No Tracked Wallets*\n\n' +
      "You don't have any wallets currently being tracked.\n\n" +
      '*Get started:*\n' +
      '• Use /track <address> <alias> to add a wallet\n\n' +
      '*Example:*\n' +
      '`/track 0x7845bc5E15bC9c41Be5aC0725E68a16Ec02B51B5 MyTrader`',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Track Wallet', callback_data: 'track_new_wallet' }]
          ]
        }
      }
    );
  }

  private async getUserWallets(userId: number): Promise<WalletInfo[]> {
    try {
      const repository = getWalletTrackerRepository();
      const wallets = await repository.getUserTrackedWallets(userId);
      return wallets;
    } catch (error) {
      logger.error('Error getting user wallets:', error);
      return [];
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