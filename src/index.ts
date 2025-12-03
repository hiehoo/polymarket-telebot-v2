import { Telegraf } from 'telegraf';
import { config, validateConfig } from '@/config';
import logger from '@/utils/logger';

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validation successful');
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const bot = new Telegraf(config.telegram.botToken);

// Basic middleware
bot.use(async (ctx, next) => {
  const start = Date.now();
  const messageText = (ctx.message as any)?.text || '';
  logger.info(`Received message from user ${ctx.from?.id}: ${messageText}`, {
    userId: ctx.from?.id,
    messageText,
    messageType: ctx.message?.chat?.type,
  });

  await next();

  const duration = Date.now() - start;
  logger.debug(`Request processed in ${duration}ms`, { userId: ctx.from?.id, duration });
});

// Error handling middleware
bot.catch((error: any, ctx) => {
  logger.error('Bot error:', {
    error: error.message,
    stack: error.stack,
    userId: ctx.from?.id,
    messageText: (ctx.message as any)?.text,
  });

  ctx.reply('❌ An unexpected error occurred. Please try again later.');
});

// Basic commands
bot.start((ctx) => {
  logger.info(`User ${ctx.from?.id} started the bot`);
  ctx.reply(
    '🎯 Welcome to Polymarket Telegram Bot!\n\n' +
    'Track wallet activity in real-time with instant notifications.\n\n' +
    'Available commands:\n' +
    '/help - Show all commands\n' +
    '/track <wallet> - Track a wallet\n' +
    '/list - Show tracked wallets\n' +
    '/alerts - Manage alerts\n' +
    '/settings - Configure preferences\n' +
    '/status - Check bot status'
  );
});

bot.help((ctx) => {
  ctx.reply(
    '📋 **Polymarket Bot Commands**\n\n' +
    '🔍 **Tracking**\n' +
    '/track <0x...> - Track wallet activity\n' +
    '/untrack <0x...> - Stop tracking wallet\n' +
    '/list - Show tracked wallets\n\n' +
    '⚡ **Alerts**\n' +
    '/alerts - Manage notification alerts\n' +
    '/mute - Temporarily mute notifications\n' +
    '/unmute - Enable notifications\n\n' +
    '⚙️ **Settings**\n' +
    '/settings - Configure preferences\n' +
    '/status - Check bot status\n\n' +
    '💡 Use @PolymarketBot for inline queries!'
  );
});

bot.command('status', (ctx) => {
  ctx.reply(
    '🟢 **Bot Status**\n\n' +
    '✅ Telegram: Connected\n' +
    '🔄 Polymarket API: Connecting...\n' +
    '💾 Database: Ready\n' +
    '📈 Real-time data: Initializing...\n\n' +
    '_Advanced features coming in Phase 2_'
  );
});

// Default handler
bot.on('message', (ctx) => {
  if (ctx.message && 'text' in ctx.message) {
    ctx.reply(
      '❓ Unknown command. Use /help to see available commands.'
    );
  }
});

// Start the bot
async function startBot() {
  try {
    await bot.launch();
    logger.info('🤖 Polymarket Telegram Bot started successfully');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  bot.stop('SIGTERM');
});

// Start the bot
startBot();