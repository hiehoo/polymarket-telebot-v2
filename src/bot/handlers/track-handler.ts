import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { validateWalletAddress, sanitizeInput } from '../utils';
import { getWalletActivityTracker } from '../../services/wallet-tracker';

export class TrackHandler extends BaseCommandHandler {
  private readonly commandName = '/track';

  constructor(bot: Telegraf) {
    super(bot, '/track');
  }

  private get tracker() {
    return getWalletActivityTracker();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handleTrack(ctx);
    });

    this.bot.action(/^track_address_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.handleTrackAddress(ctx, address);
      }
    });

    logger.info('Track handler registered');
  }

  private async handleTrack(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }

      const messageText = ctx.message?.text || '';
      const address = this.extractAddressFromCommand(messageText);

      if (!address) {
        await this.sendAddressInputPrompt(ctx);
        return;
      }

      await this.handleTrackAddress(ctx, address);

    } catch (error) {
      logger.error('Error in /track command:', error);
      await ctx.reply('❌ An error occurred while processing your request. Please try again later.');
    }
  }

  private async handleTrackAddress(ctx: Context, addressInput: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      const chatId = ctx.chat?.id || ctx.from?.id;
      if (!userId || !chatId) {
        await ctx.reply('❌ Unable to identify user.');
        return;
      }

      // Parse address and optional alias (e.g., "/track 0x123... MyWallet")
      const parts = addressInput.trim().split(/\s+/);
      const address = parts[0];
      const alias = parts.slice(1).join(' ') || undefined;

      const sanitizedAddress = sanitizeInput(address);

      if (!validateWalletAddress(sanitizedAddress)) {
        await this.sendInvalidAddressError(ctx, sanitizedAddress);
        return;
      }

      await ctx.reply('⏳ Validating wallet address...');

      const isValidAddress = await this.validateAddressWithBlockchain(sanitizedAddress);
      if (!isValidAddress) {
        await this.sendInvalidAddressError(ctx, sanitizedAddress);
        return;
      }

      // Use WalletActivityTracker for PostgreSQL persistence
      const tracker = this.tracker;
      if (!tracker) {
        await ctx.reply('❌ Tracking service is not available. Please try again later.');
        return;
      }

      const result = await tracker.startTracking(sanitizedAddress, userId, chatId, alias);

      if (result.success) {
        const shortAddress = this.formatAddress(sanitizedAddress);
        const displayName = alias || shortAddress;
        await ctx.reply(
          '✅ *Wallet Successfully Added*\n\n' +
          `📍 *Address:* \`${sanitizedAddress}\`\n` +
          `🏷️ *Alias:* ${displayName}\n\n` +
          '*Notifications Enabled:*\n' +
          '• 📊 Position changes\n\n' +
          'Use /w to see your tracked wallets.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`⚠️ ${result.message}`);
      }

    } catch (error) {
      logger.error('Error handling track address:', error);
      await ctx.reply('❌ An error occurred while processing the wallet address.');
    }
  }

  private extractAddressFromCommand(messageText: string): string | null {
    const parts = messageText.trim().split(/\s+/);
    if (parts.length < 2) return null;
    // Return everything after the command (address + optional alias)
    return parts.slice(1).join(' ');
  }

  private async sendAddressInputPrompt(ctx: Context): Promise<void> {
    await ctx.reply(
      '📝 *Track New Wallet*\n\n' +
      'Please provide the wallet address you want to track.\n\n' +
      '*Supported formats:*\n' +
      '• Ethereum: `0x...` (42 characters)\n' +
      '• Solana: Base58 string (32-44 characters)\n\n' +
      '*Usage:*\n' +
      '`/track 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0`\n\n' +
      'Or simply send the wallet address directly to the bot.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '💰 My Wallets', callback_data: 'list_my_wallets' },
            { text: '⚙️ Preferences', callback_data: 'open_preferences' }
          ]]
        }
      }
    );
  }

  private async sendInvalidAddressError(ctx: Context, address: string): Promise<void> {
    await ctx.reply(
      '❌ *Invalid Wallet Address*\n\n' +
      `The address \`${address}\` is not a valid wallet address.\n\n` +
      '*Please check:*\n' +
      '• Address length and format\n' +
      '• No extra spaces or characters\n' +
      '• Supported blockchain networks\n\n' +
      '*Need help?* Use /help for examples.',
      { parse_mode: 'Markdown' }
    );
  }

  private async validateAddressWithBlockchain(address: string): Promise<boolean> {
    // For Ethereum addresses, validate format
    if (address.startsWith('0x')) {
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    // For Solana addresses
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  private formatAddress(address: string): string {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  getCommandDescription(): string {
    return 'Track a wallet address for monitoring - Usage: /track <address>';
  }

  getCommandExamples(): string[] {
    return [
      '/track 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
      '/track 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    ];
  }
}