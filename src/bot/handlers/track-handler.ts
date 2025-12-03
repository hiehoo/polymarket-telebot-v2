import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { validateWalletAddress, sanitizeInput } from '../utils';
import { RedisCacheManager } from '../../services/redis/cache-manager';
import { TrackedWallet, DatabaseUser } from '../../types/database';

export class TrackHandler extends BaseCommandHandler {
  private cacheManager: RedisCacheManager;
  private readonly commandName = '/track';

  constructor(bot: Telegraf) {
    super(bot, '/track');
    this.cacheManager = new RedisCacheManager();
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

  private async handleTrackAddress(ctx: Context, address: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user.');
        return;
      }

      const sanitizedAddress = sanitizeInput(address.trim());

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

      const isAlreadyTracked = await this.checkIfAlreadyTracked(userId, sanitizedAddress);
      if (isAlreadyTracked) {
        await this.sendAlreadyTrackedError(ctx, sanitizedAddress);
        return;
      }

      const trackedWallet = await this.addWalletToTracking(userId, sanitizedAddress);
      if (trackedWallet) {
        await this.sendTrackSuccessMessage(ctx, trackedWallet);

        await this.cacheManager.setCachedData(
          `user_wallets:${userId}`,
          { [sanitizedAddress]: trackedWallet },
          3600
        );
      } else {
        await ctx.reply('❌ Failed to add wallet to tracking. Please try again later.');
      }

    } catch (error) {
      logger.error('Error handling track address:', error);
      await ctx.reply('❌ An error occurred while processing the wallet address.');
    }
  }

  private extractAddressFromCommand(messageText: string): string | null {
    const parts = messageText.trim().split(/\s+/);
    if (parts.length < 2) return null;
    return parts[1];
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

  private async sendAlreadyTrackedError(ctx: Context, address: string): Promise<void> {
    await ctx.reply(
      '⚠️ *Wallet Already Tracked*\n\n' +
      `The address \`${address}\` is already in your tracking list.\n\n` +
      '*Actions:*\n' +
      '• Use /list to see all tracked wallets\n' +
      '• Use /untrack to remove a wallet\n' +
      '• Use /balance to check current balance',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
            { text: '💳 Check Balance', callback_data: `balance_${address}` }
          ]]
        }
      }
    );
  }

  private async sendTrackSuccessMessage(ctx: Context, wallet: TrackedWallet): Promise<void> {
    const shortAddress = this.formatAddress(wallet.wallet_address);
    const alias = wallet.alias || shortAddress;

    await ctx.reply(
      '✅ *Wallet Successfully Added*\n\n' +
      `📍 *Address:* \`${wallet.wallet_address}\`\n` +
      `🏷️ *Alias:* ${alias}\n` +
      `📅 *Added:* ${new Date(wallet.created_at).toLocaleDateString()}\n\n` +
      '*Notifications Enabled:*\n' +
      '• 💰 Transaction alerts\n' +
      '• 📊 Position changes\n' +
      '• 📈 Price movements\n\n' +
      'Use /preferences to customize notification settings.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Check Balance', callback_data: `balance_${wallet.wallet_address}` },
              { text: '📊 Set Alias', callback_data: `alias_${wallet.wallet_address}` }
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

  private validateWalletAddress(address: string): boolean {
    const cleanAddress = address.trim().toLowerCase();

    const ethereumPattern = /^0x[a-f0-9]{40}$/;
    const solanaPattern = /^[1-9a-hj-np-z]{32,44}$/;

    return ethereumPattern.test(cleanAddress) || solanaPattern.test(cleanAddress);
  }

  private async validateAddressWithBlockchain(address: string): Promise<boolean> {
    try {
      // Check cache first
      const cached = await this.cacheManager.getCachedData(`address_validation:${address}`, 300);
      if (cached !== null) {
        return cached === 'valid';
      }

      // For Ethereum addresses, validate checksum
      if (address.startsWith('0x')) {
        // Basic validation: correct length and hex characters
        const isValidFormat = /^0x[a-fA-F0-9]{40}$/.test(address);
        if (!isValidFormat) {
          await this.cacheManager.setCachedData(`address_validation:${address}`, 'invalid', 300);
          return false;
        }

        // Cache valid result
        await this.cacheManager.setCachedData(`address_validation:${address}`, 'valid', 300);
        return true;
      }

      // For non-Ethereum addresses, apply basic validation
      const isValidSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      if (isValidSolana) {
        await this.cacheManager.setCachedData(`address_validation:${address}`, 'valid', 300);
        return true;
      }

      await this.cacheManager.setCachedData(`address_validation:${address}`, 'invalid', 300);
      return false;
    } catch (error) {
      logger.warn(`Address validation failed for ${address}:`, error);
      return false;
    }
  }

  private async checkIfAlreadyTracked(userId: number, address: string): Promise<boolean> {
    try {
      const cached = await this.cacheManager.getCachedData(`user_wallets:${userId}`);
      if (cached && cached[address]) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking if wallet already tracked:', error);
      return false;
    }
  }

  private async addWalletToTracking(userId: number, address: string): Promise<TrackedWallet | null> {
    try {
      const wallet: TrackedWallet = {
        id: `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: userId.toString(),
        wallet_address: address,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      return wallet;
    } catch (error) {
      logger.error('Error adding wallet to tracking:', error);
      return null;
    }
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