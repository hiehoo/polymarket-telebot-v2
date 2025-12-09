/**
 * Smart Wallet Handler
 * Telegram commands for consensus notifications (user opt-in/opt-out only)
 * Smart wallets are managed by admin via database, not by users
 */

import { Telegraf, Context } from 'telegraf';
import { logger } from '@/utils/logger';
import {
  getSmartWalletRepository,
  getSmartWalletScanner,
} from '@/services/consensus';

/**
 * Register smart wallet commands on the bot
 * Users can only view signals and opt-out of notifications
 * Smart wallet management is admin-only (direct database access)
 */
export function registerSmartWalletCommands(bot: Telegraf<Context>): void {
  const repository = getSmartWalletRepository();

  // /smartwallets - List tracked smart wallets (read-only)
  bot.command('smartwallets', async (ctx) => {
    try {
      const wallets = await repository.getActiveWallets();

      if (wallets.length === 0) {
        await ctx.reply(
          '*Smart Wallets*\n\n' +
          '_No smart wallets being tracked._',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      let message = '*Tracked Smart Wallets*\n\n';

      wallets.forEach((wallet, index) => {
        const shortAddr = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
        message += `${index + 1}. *${wallet.alias}*\n`;
        message += `   \`${shortAddr}\`\n\n`;
      });

      message += `Total: ${wallets.length} wallet(s)\n\n`;
      message += `_Use /consensus to view detected signals_`;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error listing smart wallets', { error });
      await ctx.reply('Failed to fetch smart wallets. Please try again.');
    }
  });

  // /consensus - Get recent consensus signals
  bot.command('consensus', async (ctx) => {
    try {
      const signals = await repository.getRecentSignals(7);

      if (signals.length === 0) {
        await ctx.reply(
          '*Consensus Signals*\n\n' +
          '_No consensus signals detected in the last 7 days._\n\n' +
          'Consensus is detected when 3+ smart wallets take the same side on a market.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      let message = '*Recent Consensus Signals*\n\n';

      signals.slice(0, 10).forEach((signal, index) => {
        const sideEmoji = signal.side === 'YES' ? '🟢' : '🔴';
        const date = signal.detectedAt
          ? new Date(signal.detectedAt).toLocaleDateString()
          : 'N/A';
        const value = signal.totalValue >= 1000
          ? `$${(signal.totalValue / 1000).toFixed(1)}K`
          : `$${signal.totalValue.toFixed(0)}`;

        message += `${index + 1}. ${sideEmoji} *${signal.marketTitle.slice(0, 40)}*\n`;
        message += `   ${signal.walletCount} wallets | ${value} | ${date}\n\n`;
      });

      if (signals.length > 10) {
        message += `_...and ${signals.length - 10} more_`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching consensus signals', { error });
      await ctx.reply('Failed to fetch consensus signals. Please try again.');
    }
  });

  // /muteconensus - Opt-out of consensus notifications
  bot.command('muteconsensus', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('Unable to identify chat.');
      return;
    }

    const scanner = getSmartWalletScanner();
    if (!scanner) {
      await ctx.reply('Consensus scanner is not initialized.');
      return;
    }

    if (!scanner.isSubscribed(chatId)) {
      await ctx.reply('You are already not receiving consensus notifications.');
      return;
    }

    scanner.unsubscribeChat(chatId);
    await ctx.reply(
      '*Muted*\n\n' +
      'You will no longer receive consensus notifications.\n\n' +
      'Use `/unmuteconsensus` to re-enable notifications.',
      { parse_mode: 'Markdown' }
    );

    logger.info('Chat muted consensus notifications', { chatId });
  });

  // /unmuteconsensus - Opt back in to consensus notifications
  bot.command('unmuteconsensus', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('Unable to identify chat.');
      return;
    }

    const scanner = getSmartWalletScanner();
    if (!scanner) {
      await ctx.reply('Consensus scanner is not initialized.');
      return;
    }

    if (scanner.isSubscribed(chatId)) {
      await ctx.reply('You are already receiving consensus notifications.');
      return;
    }

    scanner.subscribeChat(chatId);
    await ctx.reply(
      '*Unmuted*\n\n' +
      'You will now receive consensus signal notifications.\n\n' +
      'Use `/muteconsensus` to mute.',
      { parse_mode: 'Markdown' }
    );

    logger.info('Chat unmuted consensus notifications', { chatId });
  });

  logger.info('Smart wallet commands registered (user: view + opt-out only)');
}
