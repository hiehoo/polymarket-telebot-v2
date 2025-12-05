// Register module aliases for production runtime
import 'module-alias/register';

import { Telegraf } from 'telegraf';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { UserService } from './services/database/user-service';
import databasePool from './services/database/connection-pool';
import { PolymarketService, createPolymarketService } from './services/polymarket';
import { simpleRedisClient } from './services/redis';
import { WalletActivityTracker, createWalletActivityTracker } from './services/wallet-tracker';

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validation successful');
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const bot = new Telegraf(config.telegram.botToken);
const userService = new UserService();
const polymarketService = createPolymarketService({
  enableWebSocket: true, // Re-enabled with official Polymarket client
  enableCaching: true,
  enableMetrics: true
});

// Wallet Activity Tracker (initialized in startBot)
let walletTracker: WalletActivityTracker | null = null;

// Setup service event listeners
polymarketService.on('websocket:connected', () => {
  logger.info('Real-time WebSocket connection established');
});

polymarketService.on('websocket:disconnected', () => {
  logger.warn('Real-time WebSocket connection lost');
});

polymarketService.on('websocket:error', (error) => {
  logger.error('WebSocket error:', error);
});

polymarketService.on('realtime:event', (event) => {
  logger.debug('Received real-time event:', event.type);
});

// Setup graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  if (walletTracker) await walletTracker.shutdown();
  await polymarketService.shutdown();
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  if (walletTracker) await walletTracker.shutdown();
  await polymarketService.shutdown();
  await bot.stop();
  process.exit(0);
});

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
    '📋 **Enhanced Polymarket Bot**\n\n' +
    '🔍 **Wallet Tracking**\n' +
    '/track <0x...> - Track wallet activity\n' +
    '/untrack <0x...> - Stop tracking wallet\n' +
    '/list - Show tracked wallets\n\n' +
    '📈 **Market Data & Analytics**\n' +
    '/markets - View trending markets\n' +
    '/market <id> - Get market details\n' +
    '/positions <0x...> - Check wallet positions (with enriched data)\n' +
    '/orderbook <market_id> - Real-time order book analysis\n' +
    '/analytics <0x...> - Comprehensive wallet analytics\n\n' +
    '⚡ **Real-time Features**\n' +
    '/alerts - Manage notification alerts\n' +
    '/mute - Temporarily mute notifications\n' +
    '/unmute - Enable notifications\n\n' +
    '⚙️ **System & Performance**\n' +
    '/settings - Configure preferences\n' +
    '/status - Enhanced system status with metrics\n\n' +
    '🚀 **New Advanced Features:**\n' +
    '• ✅ Circuit breaker protection\n' +
    '• ✅ Automatic rate limiting\n' +
    '• ✅ Multi-level caching\n' +
    '• ✅ Real-time WebSocket streaming\n' +
    '• ✅ Advanced error recovery\n' +
    '• ✅ Performance monitoring\n' +
    '• ✅ Order book analysis\n' +
    '• ✅ Portfolio analytics\n\n' +
    '💡 **Enterprise-grade Polymarket integration!**',
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', async (ctx) => {
  try {
    await ctx.reply('🔍 Checking system status...');

    // Get service health and stats
    const polymarketHealth = await polymarketService.healthCheck();
    const stats = polymarketService.getStats();

    const polymarketStatus = polymarketHealth ? '✅ Connected' : '❌ Disconnected';
    const polymarketEmoji = polymarketHealth ? '🟢' : '🔴';
    const wsStatus = stats.websocketConnected ? '✅ Connected' : '❌ Disconnected';
    const wsEmoji = stats.websocketConnected ? '🟢' : '🔴';

    // Calculate success rate
    const successRate = stats.totalRequests > 0
      ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1)
      : '0.0';

    // Format average response time
    const avgResponseTime = stats.averageResponseTime > 0
      ? `${Math.round(stats.averageResponseTime)}ms`
      : 'N/A';

    // Format cache hit rate
    const cacheHitRate = stats.cacheHitRate > 0
      ? `${stats.cacheHitRate.toFixed(1)}%`
      : 'N/A';

    // Wallet tracker status
    const trackerStatus = walletTracker?.getStatus();
    const trackerEmoji = trackerStatus?.enabled ? '🟢' : '🔴';
    const trackerConnected = trackerStatus?.enabled ? '✅ Active' : '❌ Disabled';

    const statusMessage =
      `${polymarketEmoji} **Enhanced Bot Status**\n\n` +
      '🔗 **Connections:**\n' +
      '• ✅ Telegram: Connected\n' +
      `• ${polymarketHealth ? '✅' : '❌'} Polymarket REST: ${polymarketStatus}\n` +
      `• ${wsEmoji} WebSocket: ${wsStatus}\n` +
      `• ${trackerEmoji} Activity Tracker: ${trackerConnected}` + (trackerStatus ? ` (${trackerStatus.trackedWallets} wallets)` : '') + '\n' +
      '• 💾 Database: Ready (In-memory)\n\n' +
      '📊 **Performance Metrics:**\n' +
      `• 📈 Success Rate: ${successRate}%\n` +
      `• ⚡ Avg Response: ${avgResponseTime}\n` +
      `• 💾 Cache Hit Rate: ${cacheHitRate}\n` +
      `• 🔢 Total Requests: ${stats.totalRequests}\n` +
      `• ❌ Failed Requests: ${stats.failedRequests}\n\n` +
      '🔧 **Advanced Features:**\n' +
      '• ✅ Circuit Breaker Protection\n' +
      '• ✅ Automatic Rate Limiting\n' +
      '• ✅ Multi-level Caching\n' +
      '• ✅ Real-time WebSocket Streaming\n' +
      '• ✅ Wallet Activity Notifications\n' +
      '• ✅ Performance Monitoring\n\n' +
      '💡 **Available Commands:**\n' +
      '• Wallet tracking & monitoring\n' +
      '• Live market data & analytics\n' +
      '• Position monitoring with enrichment\n' +
      '• Real-time notifications\n' +
      '• Order book analysis\n\n' +
      '_Use /help to see all commands_';

    ctx.reply(statusMessage, { parse_mode: 'Markdown' });

    logger.info(`Enhanced status check completed`, {
      polymarketHealth,
      websocketConnected: stats.websocketConnected,
      successRate,
      totalRequests: stats.totalRequests
    });

  } catch (error) {
    logger.error('Error in enhanced status command:', error);
    ctx.reply(
      '🔴 **Bot Status - Error**\n\n' +
      '✅ Telegram: Connected\n' +
      '❓ Polymarket API: Check failed\n' +
      '❓ WebSocket: Unknown\n' +
      '💾 Database: Ready\n' +
      '📈 Real-time data: Limited\n\n' +
      '⚠️ Some advanced features may be unavailable.\n' +
      'Please try again in a few moments.',
      { parse_mode: 'Markdown' }
    );
  }
});

bot.command('track', async (ctx) => {
  const messageText = ctx.message.text;
  const args = messageText.split(' ');

  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  if (args.length < 2) {
    ctx.reply(
      '📝 **Track Wallet Usage**\n\n' +
      'Please provide a wallet address to track:\n' +
      '`/track 0x1234...` - Track Ethereum wallet\n' +
      '`/track 9WzDXw...` - Track Solana wallet\n\n' +
      '💡 Example:\n' +
      '`/track 0x7845bc5E15bC9c41Be5aC0725E68a16Ec02B51B5`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const walletAddress = args[1];

  // Basic validation
  const isEthereumAddress = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
  const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress);

  if (!isEthereumAddress && !isSolanaAddress) {
    ctx.reply(
      '❌ **Invalid Wallet Address**\n\n' +
      'Please provide a valid wallet address:\n' +
      '• Ethereum: 0x... (42 characters)\n' +
      '• Solana: Base58 string (32-44 characters)\n\n' +
      '🔍 Check your address format and try again.'
    );
    return;
  }

  try {
    // Ensure user exists in database
    let user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      user = await userService.createUser({
        id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name
      });
    }

    // Check if wallet is already tracked
    const isAlreadyTracked = await userService.isWalletTracked(ctx.from.id, walletAddress);
    if (isAlreadyTracked) {
      ctx.reply(
        '⚠️ **Wallet Already Tracked**\n\n' +
        `The address \`${walletAddress}\` is already in your tracking list.\n\n` +
        'Use /list to see all tracked wallets',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Add wallet to tracking
    const wallet = await userService.addTrackedWallet(ctx.from.id, walletAddress);

    if (wallet) {
      const addressType = isEthereumAddress ? 'Ethereum' : 'Solana';
      const shortAddress = walletAddress.length > 20 ?
        `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` :
        walletAddress;

      // Start activity tracking if tracker is available
      let activityTrackingStatus = '';
      if (walletTracker && ctx.chat?.id) {
        const trackResult = await walletTracker.startTracking(
          walletAddress,
          ctx.from.id,
          ctx.chat.id
        );
        activityTrackingStatus = trackResult.success
          ? '\n🔔 **Activity Notifications:** Enabled'
          : '\n⚠️ Activity notifications: ' + trackResult.message;
      }

      ctx.reply(
        `✅ **Wallet Tracking Added**\n\n` +
        `📍 Address: \`${shortAddress}\`\n` +
        `🔗 Network: ${addressType}\n` +
        `📊 Status: Active monitoring\n` +
        `📅 Added: ${new Date().toLocaleDateString()}` +
        activityTrackingStatus + `\n\n` +
        `🔔 You'll receive notifications for:\n` +
        `• Buy/Sell position changes\n` +
        `• New positions opened\n` +
        `• Positions closed\n\n` +
        `Use /list to see all tracked wallets`,
        { parse_mode: 'Markdown' }
      );

      logger.info(`User ${ctx.from.id} added wallet tracking for ${walletAddress}`, {
        userId: ctx.from.id,
        walletAddress,
        addressType
      });
    } else {
      ctx.reply('❌ Failed to add wallet to tracking. Please try again later.');
    }
  } catch (error) {
    logger.error('Error in track command:', error);
    ctx.reply('❌ An error occurred while adding the wallet. Please try again later.');
  }
});

bot.command('list', async (ctx) => {
  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  try {
    const userWallets = await userService.getUserWallets(ctx.from.id);

    if (userWallets.length === 0) {
      ctx.reply(
        '📋 **Tracked Wallets**\n\n' +
        '_No wallets are currently being tracked._\n\n' +
        '💡 **Getting Started:**\n' +
        '• Use `/track <address>` to add a wallet\n' +
        '• Support for Ethereum and Solana addresses\n' +
        '• Real-time monitoring and alerts\n\n' +
        'Example: `/track 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0`'
      );
      return;
    }

    let walletList = '📋 **Your Tracked Wallets**\n\n';

    userWallets.forEach((wallet, index) => {
      const shortAddress = wallet.wallet_address.length > 20 ?
        `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}` :
        wallet.wallet_address;

      const addedDate = new Date(wallet.created_at).toLocaleDateString();
      const alias = wallet.alias || shortAddress;

      walletList += `🔹 **${alias}**\n`;
      walletList += `   Address: \`${shortAddress}\`\n`;
      walletList += `   Added: ${addedDate}\n`;
      walletList += `   Status: ${wallet.is_active ? '🟢 Active' : '🔴 Inactive'}\n\n`;
    });

    walletList += `📊 **Summary:**\n`;
    walletList += `• Total wallets: ${userWallets.length}\n`;
    walletList += `• Active monitoring: ${userWallets.filter(w => w.is_active).length}\n\n`;
    walletList += `💡 Use \`/untrack <address>\` to remove a wallet`;

    ctx.reply(walletList, { parse_mode: 'Markdown' });

    logger.info(`User ${ctx.from.id} listed ${userWallets.length} tracked wallets`, {
      userId: ctx.from.id,
      walletCount: userWallets.length
    });
  } catch (error) {
    logger.error('Error in list command:', error);
    ctx.reply('❌ An error occurred while retrieving your wallets. Please try again later.');
  }
});

bot.command(['untrack', 'remove'], async (ctx) => {
  const messageText = ctx.message.text;
  const args = messageText.split(' ');

  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  if (args.length < 2) {
    ctx.reply(
      '🛑 **Untrack Wallet Usage**\n\n' +
      'Please provide the wallet address to remove:\n' +
      '`/untrack 0x1234...` - Remove Ethereum wallet\n' +
      '`/untrack 9WzDXw...` - Remove Solana wallet\n\n' +
      'Use `/list` to see your tracked wallets'
    );
    return;
  }

  const walletAddress = args[1];

  try {
    // Check if wallet is tracked
    const isTracked = await userService.isWalletTracked(ctx.from.id, walletAddress);
    if (!isTracked) {
      ctx.reply(
        '❌ **Wallet Not Found**\n\n' +
        `The address \`${walletAddress}\` is not in your tracking list.\n\n` +
        'Use `/list` to see your tracked wallets',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Remove wallet from tracking
    const removed = await userService.removeTrackedWallet(ctx.from.id, walletAddress);

    if (removed) {
      const shortAddress = walletAddress.length > 20 ?
        `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` :
        walletAddress;

      // Stop activity tracking if tracker is available
      if (walletTracker) {
        await walletTracker.stopTracking(walletAddress, ctx.from.id);
      }

      ctx.reply(
        `✅ **Wallet Removed**\n\n` +
        `📍 Address: \`${shortAddress}\`\n` +
        `📅 Removed: ${new Date().toLocaleDateString()}\n\n` +
        `🔕 Notifications for this wallet have been disabled.\n\n` +
        `Use /list to see your remaining tracked wallets`,
        { parse_mode: 'Markdown' }
      );

      logger.info(`User ${ctx.from.id} removed wallet tracking for ${walletAddress}`, {
        userId: ctx.from.id,
        walletAddress
      });
    } else {
      ctx.reply('❌ Failed to remove wallet from tracking. Please try again later.');
    }
  } catch (error) {
    logger.error('Error in untrack command:', error);
    ctx.reply('❌ An error occurred while removing the wallet. Please try again later.');
  }
});

bot.command(['alerts', 'notifications'], (ctx) => {
  ctx.reply(
    '🔔 **Notification Management**\n\n' +
    'Advanced alert system coming in Phase 2!\n\n' +
    '🎯 **Planned Features:**\n' +
    '• Custom alert thresholds\n' +
    '• Multi-wallet notifications\n' +
    '• Real-time position tracking\n' +
    '• Market event alerts\n\n' +
    'Stay tuned for updates!'
  );
});

bot.command(['settings', 'preferences'], (ctx) => {
  ctx.reply(
    '⚙️ **Bot Settings**\n\n' +
    'Configuration options coming in Phase 2!\n\n' +
    '🔧 **Planned Settings:**\n' +
    '• Notification preferences\n' +
    '• Alert frequency\n' +
    '• Display formats\n' +
    '• Privacy controls\n\n' +
    'Use /help for current commands'
  );
});

// Polymarket commands
bot.command('markets', async (ctx) => {
  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  try {
    await ctx.reply('🔍 Fetching latest prediction markets...');

    const markets = await polymarketService.getMarkets(5);

    if (markets.length === 0) {
      ctx.reply('❌ Unable to fetch markets at the moment. Please try again later.');
      return;
    }

    let marketMessage = '📈 **Trending Prediction Markets**\n\n';

    markets.forEach((market, index) => {
      const volume = market.volume ? `$${(market.volume / 1000).toFixed(0)}K` : 'N/A';
      marketMessage += `${index + 1}. **${market.question}**\n`;
      marketMessage += `   💰 Volume: ${volume}\n`;
      marketMessage += `   📅 Ends: ${market.endDate ? new Date(market.endDate).toLocaleDateString() : 'TBA'}\n`;
      marketMessage += `   🔗 ID: \`${market.id}\`\n\n`;
    });

    marketMessage += '💡 Use `/market <id>` for detailed market info';

    ctx.reply(marketMessage, { parse_mode: 'Markdown' });

    logger.info(`User ${ctx.from.id} fetched markets list`);
  } catch (error) {
    logger.error('Error in markets command:', error);
    ctx.reply('❌ An error occurred while fetching markets. Please try again later.');
  }
});

bot.command('market', async (ctx) => {
  const messageText = ctx.message.text;
  const args = messageText.split(' ');

  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  if (args.length < 2) {
    ctx.reply(
      '📝 **Market Details Usage**\n\n' +
      'Please provide a market ID:\n' +
      '`/market <market-id>`\n\n' +
      '💡 Use `/markets` to see available markets and their IDs'
    );
    return;
  }

  try {
    const marketId = args[1];
    await ctx.reply('🔍 Fetching market details...');

    const market = await polymarketService.getMarketDetails(marketId);

    if (!market) {
      ctx.reply(
        '❌ **Market Not Found**\n\n' +
        `No market found with ID: \`${marketId}\`\n\n` +
        'Use `/markets` to see available markets',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const volume = market.volume ? `$${(market.volume / 1000).toFixed(0)}K` : 'N/A';
    const liquidity = market.liquidity ? `$${(market.liquidity / 1000).toFixed(0)}K` : 'N/A';

    let marketMessage = `📊 **Market Details**\n\n`;
    marketMessage += `**${market.question}**\n\n`;

    if (market.description) {
      marketMessage += `📝 ${market.description}\n\n`;
    }

    marketMessage += `💰 **Volume:** ${volume}\n`;
    marketMessage += `💧 **Liquidity:** ${liquidity}\n`;
    marketMessage += `📅 **End Date:** ${market.endDate ? new Date(market.endDate).toLocaleDateString() : 'TBA'}\n`;
    marketMessage += `🎯 **Status:** ${market.resolved ? '✅ Resolved' : '🟡 Active'}\n`;
    marketMessage += `🎲 **Outcomes:** ${market.outcomes.join(', ')}\n\n`;
    marketMessage += `🔗 **Market ID:** \`${market.id}\``;

    ctx.reply(marketMessage, { parse_mode: 'Markdown' });

    logger.info(`User ${ctx.from.id} fetched details for market ${marketId}`);
  } catch (error) {
    logger.error('Error in market command:', error);
    ctx.reply('❌ An error occurred while fetching market details. Please try again later.');
  }
});

bot.command('positions', async (ctx) => {
  const messageText = ctx.message.text;
  const args = messageText.split(' ');

  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  if (args.length < 2) {
    ctx.reply(
      '📝 **Wallet Positions Usage**\n\n' +
      'Please provide a wallet address:\n' +
      '`/positions 0x1234...` - Check wallet positions\n\n' +
      '💡 Example:\n' +
      '`/positions 0x7845bc5E15bC9c41Be5aC0725E68a16Ec02B51B5`'
    );
    return;
  }

  try {
    const walletAddress = args[1];

    // Basic validation
    const isEthereumAddress = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
    if (!isEthereumAddress) {
      ctx.reply(
        '❌ **Invalid Wallet Address**\n\n' +
        'Please provide a valid Ethereum wallet address (0x...)\n\n' +
        '🔍 Check your address format and try again.'
      );
      return;
    }

    await ctx.reply('🔍 Fetching wallet positions and market data...');

    const allPositions = await polymarketService.getWalletPositionsWithMarketData(walletAddress);

    // Filter to only show active (non-resolved) markets
    const positions = allPositions.filter(position => !position.marketData?.resolved);

    if (positions.length === 0) {
      const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

      // Check if there were positions but all were resolved
      if (allPositions.length > 0) {
        ctx.reply(
          `📋 **Wallet Positions**\n\n` +
          `**Address:** \`${shortAddress}\`\n\n` +
          `_No active positions found._\n\n` +
          `This wallet has ${allPositions.length} resolved position(s) but no active positions.\n` +
          `Only active markets are displayed.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    if (positions.length === 0) {
      const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
      ctx.reply(
        `📋 **Wallet Positions**\n\n` +
        `**Address:** \`${shortAddress}\`\n\n` +
        `_No active positions found._\n\n` +
        `This wallet either:\n` +
        `• Has no Polymarket positions\n` +
        `• All positions have been closed\n` +
        `• Address is not active on Polymarket`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    let positionsMessage = `📊 **Wallet Positions**\n\n`;
    positionsMessage += `**Address:** \`${shortAddress}\`\n\n`;

    let totalValue = 0;
    let totalPnL = 0;

    positions.slice(0, 10).forEach((position, index) => {
      const displayMarket = position.market || `Market ${position.marketId.substring(0, 8)}`;
      const displayPosition = position.position || '?';
      const displayShares = isNaN(position.shares) ? 0 : position.shares;
      const displayValue = isNaN(position.value) ? 0 : position.value;
      const displayPnL = isNaN(position.pnl) ? 0 : position.pnl;
      const entryPrice = position.entryPrice || 0;

      // Build market URL using eventSlug from Data API
      const marketUrl = position.eventSlug
        ? `https://polymarket.com/event/${position.eventSlug}`
        : position.slug
          ? `https://polymarket.com/event/${position.slug}`
          : null;

      // Title with hyperlink
      const titleWithLink = marketUrl
        ? `[${displayMarket}](${marketUrl})`
        : displayMarket;

      // End date
      const endDate = position.marketData?.endDate
        ? new Date(position.marketData.endDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
        : 'TBA';

      // P&L formatting
      const pnlEmoji = displayPnL >= 0 ? '🟢' : '🔴';
      const pnlSign = displayPnL >= 0 ? '+' : '';

      positionsMessage += `${index + 1}. ${titleWithLink}\n`;
      positionsMessage += `   ${displayPosition} | ${displayShares.toFixed(0)} shares @ $${entryPrice.toFixed(2)} | Value: $${displayValue.toFixed(2)} | ${pnlEmoji} ${pnlSign}$${displayPnL.toFixed(2)} | Ends ${endDate}\n\n`;

      totalValue += displayValue;
      totalPnL += displayPnL;
    });

    const totalPnLEmoji = totalPnL >= 0 ? '🟢' : '🔴';
    const totalPnLSign = totalPnL >= 0 ? '+' : '';

    positionsMessage += `💼 ${positions.length} positions | Value: $${totalValue.toFixed(2)} | ${totalPnLEmoji} ${totalPnLSign}$${totalPnL.toFixed(2)}`;

    if (positions.length > 10) {
      positionsMessage += ` | _Showing top 10_`;
    }

    ctx.reply(positionsMessage, { parse_mode: 'Markdown' });

    logger.info(`User ${ctx.from.id} fetched positions for wallet ${walletAddress}`, {
      userId: ctx.from.id,
      walletAddress,
      positionCount: positions.length
    });
  } catch (error) {
    logger.error('Error in positions command:', error);
    ctx.reply('❌ An error occurred while fetching wallet positions. Please try again later.');
  }
});

// Enhanced Commands - Order Book
bot.command('orderbook', async (ctx) => {
  const messageText = ctx.message.text;
  const args = messageText.split(' ');

  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  if (args.length < 2) {
    ctx.reply(
      '📊 **Order Book Usage**\n\n' +
      'Get real-time order book data for a market:\n' +
      '`/orderbook <market_id>`\n\n' +
      '💡 Example:\n' +
      '`/orderbook 0x1234...abcd`\n\n' +
      'Use `/markets` to find market IDs.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const marketId = args[1];

  try {
    await ctx.reply(`🔍 Fetching order book for market ${marketId.slice(0, 8)}...`);

    const orderBook = await polymarketService.getOrderBook(marketId);

    if (!orderBook) {
      ctx.reply(
        '❌ **Order Book Not Found**\n\n' +
        `No order book data available for market \`${marketId}\`.\n\n` +
        'This could happen if:\n' +
        '• Market ID is incorrect\n' +
        '• Market has no active orders\n' +
        '• Market is resolved or inactive',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let orderBookMessage = `📊 **Order Book - ${marketId.slice(0, 8)}...**\n\n`;

    // Display buy orders (bids)
    orderBookMessage += '💚 **Buy Orders (Bids):**\n';
    if (orderBook.bids && orderBook.bids.length > 0) {
      orderBook.bids.slice(0, 5).forEach((bid, index) => {
        orderBookMessage += `${index + 1}. $${bid.price.toFixed(3)} × ${bid.size.toFixed(0)}\n`;
      });
    } else {
      orderBookMessage += '_No buy orders_\n';
    }

    orderBookMessage += '\n💔 **Sell Orders (Asks):**\n';
    if (orderBook.asks && orderBook.asks.length > 0) {
      orderBook.asks.slice(0, 5).forEach((ask, index) => {
        orderBookMessage += `${index + 1}. $${ask.price.toFixed(3)} × ${ask.size.toFixed(0)}\n`;
      });
    } else {
      orderBookMessage += '_No sell orders_\n';
    }

    // Add spread information
    if (orderBook.bids && orderBook.asks && orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      const bestBid = orderBook.bids[0].price;
      const bestAsk = orderBook.asks[0].price;
      const spread = bestAsk - bestBid;
      const spreadPercent = ((spread / bestBid) * 100).toFixed(2);

      orderBookMessage += `\n📈 **Market Info:**\n`;
      orderBookMessage += `• Best Bid: $${bestBid.toFixed(3)}\n`;
      orderBookMessage += `• Best Ask: $${bestAsk.toFixed(3)}\n`;
      orderBookMessage += `• Spread: $${spread.toFixed(3)} (${spreadPercent}%)\n`;
    }

    orderBookMessage += `\n🔗 Market ID: \`${marketId}\``;

    ctx.reply(orderBookMessage, { parse_mode: 'Markdown' });

    logger.info(`User ${ctx.from.id} fetched order book for market ${marketId}`, {
      userId: ctx.from.id,
      marketId
    });

  } catch (error) {
    logger.error('Error in orderbook command:', error);
    ctx.reply(
      '❌ **Order Book Error**\n\n' +
      'Failed to fetch order book data. This might be due to:\n' +
      '• Network issues\n' +
      '• Invalid market ID\n' +
      '• API rate limits\n\n' +
      'Please try again in a few moments.'
    );
  }
});

// Enhanced Commands - User Analytics
bot.command('analytics', async (ctx) => {
  const messageText = ctx.message.text;
  const args = messageText.split(' ');

  if (!ctx.from?.id) {
    ctx.reply('❌ Unable to identify user. Please try again.');
    return;
  }

  if (args.length < 2) {
    ctx.reply(
      '📈 **Analytics Usage**\n\n' +
      'Get comprehensive analytics for a wallet:\n' +
      '`/analytics <wallet_address>`\n\n' +
      '💡 Example:\n' +
      '`/analytics 0x1234...abcd`\n\n' +
      'Includes portfolio metrics, trading history, and performance data.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const walletAddress = args[1];

  // Basic validation
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(walletAddress) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress);

  if (!isValidAddress) {
    ctx.reply(
      '❌ **Invalid Wallet Address**\n\n' +
      'Please provide a valid wallet address format.'
    );
    return;
  }

  try {
    await ctx.reply(`📊 Analyzing wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}...`);

    // Get user profile and positions in parallel
    const [userProfile, positions, transactions] = await Promise.all([
      polymarketService.getUserProfile(walletAddress),
      polymarketService.getWalletPositionsWithMarketData(walletAddress),
      polymarketService.getUserTransactions(walletAddress, 20)
    ]);

    let analyticsMessage = `📈 **Wallet Analytics**\n\n`;
    analyticsMessage += `👤 **Address:** \`${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}\`\n\n`;

    // User profile analytics
    if (userProfile) {
      analyticsMessage += `📊 **Profile Stats:**\n`;
      analyticsMessage += `• Total Volume: $${(userProfile.totalVolume || 0).toLocaleString()}\n`;
      analyticsMessage += `• Total P&L: ${userProfile.totalProfit ? (userProfile.totalProfit >= 0 ? '+' : '') + '$' + userProfile.totalProfit.toLocaleString() : 'N/A'}\n`;
      analyticsMessage += `• Win Rate: ${userProfile.winRate ? (userProfile.winRate * 100).toFixed(1) + '%' : 'N/A'}\n`;
      analyticsMessage += `• Active Positions: ${userProfile.activePositions || 0}\n`;
      analyticsMessage += `• Settled Positions: ${userProfile.settledPositions || 0}\n\n`;
    }

    // Portfolio analytics
    if (positions.length > 0) {
      const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
      const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
      const activeMarkets = positions.filter(p => p.marketData && !p.marketData.resolved).length;

      analyticsMessage += `💼 **Portfolio Summary:**\n`;
      analyticsMessage += `• Current Value: $${totalValue.toFixed(2)}\n`;
      analyticsMessage += `• Unrealized P&L: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}\n`;
      analyticsMessage += `• Total Positions: ${positions.length}\n`;
      analyticsMessage += `• Active Markets: ${activeMarkets}\n\n`;
    }

    // Trading activity
    if (transactions.length > 0) {
      const recentTrades = transactions.slice(0, 5);
      const buyTrades = transactions.filter(t => t.type === 'BUY').length;
      const sellTrades = transactions.filter(t => t.type === 'SELL').length;

      analyticsMessage += `🔄 **Trading Activity (Last 20):**\n`;
      analyticsMessage += `• Buy Trades: ${buyTrades}\n`;
      analyticsMessage += `• Sell Trades: ${sellTrades}\n`;
      analyticsMessage += `• Total Volume: $${transactions.reduce((sum, t) => sum + (t.amount * t.price), 0).toFixed(2)}\n\n`;

      analyticsMessage += `📋 **Recent Trades:**\n`;
      recentTrades.forEach((trade, index) => {
        const type = trade.type === 'BUY' ? '💚 Buy' : '💔 Sell';
        const amount = (trade.amount * trade.price).toFixed(2);
        const date = new Date(trade.timestamp).toLocaleDateString();
        analyticsMessage += `${index + 1}. ${type} $${amount} - ${date}\n`;
      });
    }

    analyticsMessage += `\n⏰ **Last Updated:** ${new Date().toLocaleString()}`;

    ctx.reply(analyticsMessage, { parse_mode: 'Markdown' });

    logger.info(`User ${ctx.from.id} requested analytics for wallet ${walletAddress}`, {
      userId: ctx.from.id,
      walletAddress,
      positionsCount: positions.length,
      transactionsCount: transactions.length
    });

  } catch (error) {
    logger.error('Error in analytics command:', error);
    ctx.reply(
      '❌ **Analytics Error**\n\n' +
      'Failed to generate analytics. This might be due to:\n' +
      '• Network issues\n' +
      '• Wallet address not found\n' +
      '• API rate limits\n\n' +
      'Please try again in a few moments.'
    );
  }
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
    // Connect Redis
    try {
      await simpleRedisClient.connect();
      logger.info('✅ Redis connected');
    } catch (redisError) {
      logger.warn('⚠️ Redis connection failed, wallet activity tracking will be disabled:', redisError);
    }

    // Connect Polymarket service
    await polymarketService.connect();
    logger.info('✅ Polymarket service connected');

    // Initialize Wallet Activity Tracker (if Redis is connected)
    if (simpleRedisClient.isClientConnected()) {
      walletTracker = createWalletActivityTracker({
        redis: simpleRedisClient,
        polymarketService,
        bot,
        pollIntervalMs: 60000, // 60 seconds
        maxWallets: 100,
        enabled: true,
      });
      await walletTracker.initialize();
      logger.info('✅ Wallet Activity Tracker initialized');
    } else {
      logger.warn('⚠️ Wallet Activity Tracker disabled (Redis not available)');
    }

    // Launch Telegram bot
    await bot.launch();
    logger.info('🤖 Polymarket Telegram Bot started successfully');

    // Log service stats periodically
    polymarketService.on('stats', (stats) => {
      logger.debug('Service stats:', stats);
    });

  } catch (error) {
    logger.error('Failed to start bot:', error);
    if (walletTracker) await walletTracker.shutdown();
    await polymarketService.shutdown();
    process.exit(1);
  }
}


// Start the bot
startBot();