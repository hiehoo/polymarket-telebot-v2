import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { CommandValidator } from '../utils';
import { CacheManager } from '../../services/redis';
import { TrackedWallet } from '../../types/database';

interface WalletBalance {
  address: string;
  alias?: string;
  balance: {
    total: number;
    available: number;
    staked: number;
    pending: number;
    currency: string;
  };
  tokens: TokenBalance[];
  lastUpdated: Date;
  network: 'ethereum' | 'solana' | 'polygon' | 'bsc';
  value24hChange?: number;
}

interface TokenBalance {
  symbol: string;
  name: string;
  balance: number;
  value: number;
  price: number;
  price24hChange?: number;
  decimals: number;
  address?: string;
}

export class BalanceHandler extends BaseCommandHandler {
  protected commandName: string;
  private cacheManager: CacheManager;

  constructor(bot: Telegraf) {
    super(bot, '/balance');
    this.commandName = '/balance';
    this.cacheManager = new CacheManager();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handleBalance(ctx);
    });

    this.bot.action(/^balance_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.checkSingleBalance(ctx, address);
      }
    });

    this.bot.action(/^balance_all$/, async (ctx) => {
      await this.checkAllBalances(ctx);
    });

    this.bot.action(/^refresh_balance_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.refreshBalance(ctx, address);
      }
    });

    this.bot.action(/^balance_details_(.+)$/, async (ctx) => {
      const address = ctx.match?.[1];
      if (address) {
        await this.showBalanceDetails(ctx, address);
      }
    });

    logger.info('Balance handler registered');
  }

  public async handle(ctx: BaseCommandContext): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }

      const messageText = ctx.message?.text || '';
      const address = this.extractAddressFromCommand(messageText);

      if (address) {
        await this.checkSingleBalance(ctx, address);
      } else {
        await this.sendBalanceMenu(ctx, userId);
      }

    } catch (error) {
      logger.error('Error in /balance command:', error);
      await ctx.reply('❌ An error occurred while checking balance. Please try again later.');
    }
  }

  private async checkSingleBalance(ctx: Context, address: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const sanitizedAddress = sanitizeInput(address.trim());

      if (!validateWalletAddress(sanitizedAddress)) {
        await this.sendInvalidAddressError(ctx, sanitizedAddress);
        return;
      }

      await ctx.reply('💰 Checking wallet balance...');

      const balance = await this.getWalletBalance(sanitizedAddress);
      await this.sendBalanceResult(ctx, balance);

    } catch (error) {
      logger.error('Error checking single balance:', error);
      await ctx.reply('❌ An error occurred while fetching balance.');
    }
  }

  private async checkAllBalances(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await ctx.reply('💰 Checking all wallet balances...');

      const userWallets = await this.getUserWallets(userId);

      if (userWallets.length === 0) {
        await this.sendNoWalletsForBalance(ctx);
        return;
      }

      const balances = await this.getMultipleBalances(userWallets);
      await this.sendAllBalancesResult(ctx, balances);

    } catch (error) {
      logger.error('Error checking all balances:', error);
      await ctx.reply('❌ Error fetching wallet balances.');
    }
  }

  private async refreshBalance(ctx: Context, address: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await ctx.editMessageText('🔄 Refreshing balance data...');

      await this.cacheManager.deleteCachedData(`balance:${address}`);
      await this.cacheManager.deleteCachedData(`tokens:${address}`);

      const balance = await this.getWalletBalance(address, true);
      await this.sendBalanceResult(ctx, balance, true);

    } catch (error) {
      logger.error('Error refreshing balance:', error);
      await ctx.editMessageText('❌ Error refreshing balance data.');
    }
  }

  private async showBalanceDetails(ctx: Context, address: string): Promise<void> {
    try {
      await ctx.editMessageText('📊 Loading detailed balance...');

      const balance = await this.getWalletBalance(address, false, true);
      await this.sendDetailedBalance(ctx, balance);

    } catch (error) {
      logger.error('Error showing balance details:', error);
      await ctx.editMessageText('❌ Error loading detailed balance.');
    }
  }

  private async sendBalanceMenu(ctx: Context, userId: number): Promise<void> {
    try {
      const userWallets = await this.getUserWallets(userId);
      const walletCount = userWallets.length;

      await ctx.editMessageText(
        '💰 *Balance Checker*\n\n' +
        `📊 *Tracked Wallets:* ${walletCount}\n\n` +
        '*Options:*\n' +
        `💳 /balance <address> - Check specific wallet\n` +
        `📋 Check all tracked wallets\n` +
        `➕ Add wallet address to track\n\n` +
        '*Networks supported:*\n' +
        '• Ethereum (ETH) + ERC-20 tokens\n' +
        '• Solana (SOL) + SPL tokens\n' +
        '• Polygon (MATIC) + tokens\n' +
        '• BSC (BNB) + BEP-20 tokens',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: walletCount > 0 ? [
              [
                { text: `📋 All Wallets (${walletCount})`, callback_data: 'balance_all' },
                { text: '➕ Add Wallet', callback_data: 'track_new_wallet' }
              ],
              [
                { text: '📊 Portfolio Stats', callback_data: 'portfolio_stats' },
                { text: '📈 Price Alerts', callback_data: 'price_alerts' }
              ]
            ] : [
              [
                { text: '➕ Add First Wallet', callback_data: 'track_new_wallet' },
                { text: '📖 Learn More', callback_data: 'help_balance' }
              ]
            ]
          }
        }
      );

    } catch (error) {
      logger.error('Error sending balance menu:', error);
      await ctx.reply('❌ Error loading balance menu.');
    }
  }

  private async sendBalanceResult(ctx: Context, balance: WalletBalance, isEdit = false): Promise<void> {
    const shortAddress = this.formatAddress(balance.address);
    const alias = balance.alias || shortAddress;
    const totalValue = this.formatCurrency(balance.balance.total);
    const change24h = balance.value24hChange
      ? this.formatPercentage(balance.value24hChange)
      : 'N/A';

    const messageText =
      `💰 *Wallet Balance*\n\n` +
      `🏷️ *Name:* ${alias}\n` +
      `📍 *Address:* \`${balance.address}\`\n` +
      `🌐 *Network:* ${this.formatNetwork(balance.network)}\n\n` +
      `💵 *Total Value:* ${totalValue}\n` +
      `📊 *24h Change:* ${change24h}\n\n` +
      `💳 *Available:* ${this.formatCurrency(balance.balance.available)}\n` +
      `🔒 *Staked:* ${this.formatCurrency(balance.balance.staked)}\n` +
      `⏳ *Pending:* ${this.formatCurrency(balance.balance.pending)}\n\n` +
      `🪙 *Tokens:* ${balance.tokens.length} types\n` +
      `🕐 *Updated:* ${new Date(balance.lastUpdated).toLocaleTimeString()}`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '📊 Details', callback_data: `balance_details_${balance.address}` },
          { text: '🔄 Refresh', callback_data: `refresh_balance_${balance.address}` }
        ],
        [
          { text: '📋 All Wallets', callback_data: 'balance_all' },
          { text: '⚙️ Alerts', callback_data: `wallet_alerts_${balance.address}` }
        ]
      ]
    };

    if (isEdit) {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } else {
      await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    }
  }

  private async sendAllBalancesResult(ctx: Context, balances: WalletBalance[]): Promise<void> {
    if (balances.length === 0) {
      await this.sendNoWalletsForBalance(ctx);
      return;
    }

    const totalValue = balances.reduce((sum, b) => sum + b.balance.total, 0);
    const totalChange = balances.reduce((sum, b) => sum + (b.value24hChange || 0), 0) / balances.length;

    let messageText =
      `💰 *Portfolio Balance*\n\n` +
      `📊 *Total Wallets:* ${balances.length}\n` +
      `💵 *Total Value:* ${this.formatCurrency(totalValue)}\n` +
      `📈 *Avg 24h Change:* ${this.formatPercentage(totalChange)}\n\n`;

    const walletRows = balances.slice(0, 5).map((balance, index) => {
      const shortAddress = this.formatAddress(balance.address);
      const alias = balance.alias || shortAddress;
      const value = this.formatCurrency(balance.balance.total);
      const change = balance.value24hChange
        ? this.formatPercentage(balance.value24hChange)
        : '0%';

      return `${index + 1}. ${alias}: ${value} (${change})`;
    }).join('\n');

    messageText += walletRows;

    if (balances.length > 5) {
      messageText += `\n... and ${balances.length - 5} more wallets`;
    }

    messageText += `\n\n*Networks:* ${this.countNetworks(balances).join(', ')}`;

    await ctx.editMessageText(messageText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 Detailed View', callback_data: 'detailed_portfolio' },
            { text: '🔄 Refresh All', callback_data: 'refresh_all_balances' }
          ],
          [
            { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
            { text: '⚙️ Preferences', callback_data: 'open_preferences' }
          ]
        ]
      }
    });
  }

  private async sendDetailedBalance(ctx: Context, balance: WalletBalance): Promise<void> {
    const shortAddress = this.formatAddress(balance.address);
    const alias = balance.alias || shortAddress;

    let messageText =
      `📊 *Detailed Balance*\n\n` +
      `🏷️ ${alias}\n` +
      `📍 \`${balance.address}\`\n` +
      `🌐 ${this.formatNetwork(balance.network)}\n\n` +
      `💵 *Total Value:* ${this.formatCurrency(balance.balance.total)}\n\n`;

    if (balance.tokens.length > 0) {
      messageText += `🪙 *Token Holdings:*\n`;
      const topTokens = balance.tokens
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);

      topTokens.forEach(token => {
        const balanceAmount = this.formatTokenAmount(token.balance, token.decimals);
        const value = this.formatCurrency(token.value);
        const change = token.price24hChange
          ? this.formatPercentage(token.price24hChange)
          : '0%';

        messageText += `\n💠 ${token.symbol}: ${balanceAmount} (${value}) ${change}`;
      });

      if (balance.tokens.length > 8) {
        messageText += `\n... and ${balance.tokens.length - 8} more tokens`;
      }
    } else {
      messageText += '🪙 No token holdings detected\n';
    }

    messageText += `\n\n🕐 *Last Updated:* ${new Date(balance.lastUpdated).toLocaleString()}`;

    await ctx.editMessageText(messageText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Simple View', callback_data: `balance_${balance.address}` },
            { text: '🔄 Refresh', callback_data: `refresh_balance_${balance.address}` }
          ],
          [
            { text: '📈 Price History', callback_data: `price_history_${balance.address}` },
            { text: '📋 All Wallets', callback_data: 'balance_all' }
          ]
        ]
      }
    });
  }

  private async sendInvalidAddressError(ctx: Context, address: string): Promise<void> {
    await ctx.reply(
      '❌ *Invalid Wallet Address*\n\n' +
      `The address \`${address}\` is not a valid wallet address.\n\n` +
      '*Supported formats:*\n' +
      '• Ethereum: `0x...` (42 characters)\n' +
      '• Solana: Base58 string (32-44 characters)\n\n' +
      '*Usage:*\n' +
      '`/balance 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0`',
      { parse_mode: 'Markdown' }
    );
  }

  private async sendNoWalletsForBalance(ctx: Context): Promise<void> {
    await ctx.reply(
      '📭 *No Wallets to Check*\n\n' +
      "You don't have any wallets tracked yet.\n\n" +
      '*Get started:*\n' +
      '• ➕ Use /track to add a wallet\n' +
      '• 📱 Send a wallet address directly\n' +
      '• 💳 Use /balance <address> for one-time check\n\n' +
      '*Why track wallets?*\n' +
      '• 💰 Real-time balance updates\n' +
      '• 📊 Portfolio tracking\n' +
      '• 📈 Price alerts\n' +
      '• 📋 Transaction history',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add First Wallet', callback_data: 'track_new_wallet' },
              { text: '💳 One-time Check', callback_data: 'help_balance' }
            ]
          ]
        }
      }
    );
  }

  private async getWalletBalance(address: string, forceRefresh = false, detailed = false): Promise<WalletBalance> {
    try {
      const cacheKey = `balance:${address}${detailed ? '_detailed' : ''}`;
      const cached = forceRefresh ? null : await this.cacheManager.getCachedData(cacheKey);

      if (cached) {
        return cached;
      }

      const network = this.detectNetwork(address);

      const balance: WalletBalance = {
        address,
        network,
        balance: {
          total: Math.random() * 10000,
          available: Math.random() * 8000,
          staked: Math.random() * 1000,
          pending: Math.random() * 100,
          currency: 'USD'
        },
        tokens: this.generateMockTokens(network, detailed),
        lastUpdated: new Date(),
        value24hChange: (Math.random() - 0.5) * 20
      };

      await this.cacheManager.setCachedData(cacheKey, balance, 60);

      return balance;

    } catch (error) {
      logger.error('Error getting wallet balance:', error);
      throw error;
    }
  }

  private async getMultipleBalances(wallets: TrackedWallet[]): Promise<WalletBalance[]> {
    const promises = wallets.map(async (wallet) => {
      try {
        return await this.getWalletBalance(wallet.wallet_address);
      } catch (error) {
        logger.error(`Error getting balance for ${wallet.wallet_address}:`, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((balance): balance is WalletBalance => balance !== null);
  }

  private async getUserWallets(userId: number): Promise<TrackedWallet[]> {
    try {
      const cached = await this.cacheManager.getCachedData(`user_wallets:${userId}`);
      if (cached) {
        return Object.values(cached) as TrackedWallet[];
      }

      return [];

    } catch (error) {
      logger.error('Error getting user wallets:', error);
      return [];
    }
  }

  private generateMockTokens(network: string, detailed: boolean = false): TokenBalance[] {
    const baseTokens: TokenBalance[] = [];

    if (network === 'ethereum' || network === 'polygon' || network === 'bsc') {
      baseTokens.push({
        symbol: 'ETH',
        name: 'Ethereum',
        balance: Math.random() * 10,
        value: Math.random() * 5000,
        price: 3000 + Math.random() * 500,
        price24hChange: (Math.random() - 0.5) * 10,
        decimals: 18
      });

      if (detailed) {
        baseTokens.push(
          {
            symbol: 'USDT',
            name: 'Tether',
            balance: Math.random() * 5000,
            value: Math.random() * 5000,
            price: 1,
            price24hChange: (Math.random() - 0.5) * 2,
            decimals: 6
          },
          {
            symbol: 'USDC',
            name: 'USD Coin',
            balance: Math.random() * 3000,
            value: Math.random() * 3000,
            price: 1,
            price24hChange: (Math.random() - 0.5) * 1,
            decimals: 6
          }
        );
      }
    } else if (network === 'solana') {
      baseTokens.push({
        symbol: 'SOL',
        name: 'Solana',
        balance: Math.random() * 100,
        value: Math.random() * 10000,
        price: 100 + Math.random() * 50,
        price24hChange: (Math.random() - 0.5) * 15,
        decimals: 9
      });
    }

    return baseTokens;
  }

  private extractAddressFromCommand(messageText: string): string | null {
    const parts = messageText.trim().split(/\s+/);
    if (parts.length < 2) return null;
    return parts[1];
  }

  private detectNetwork(address: string): 'ethereum' | 'solana' | 'polygon' | 'bsc' {
    if (address.startsWith('0x') && address.length === 42) {
      return 'ethereum';
    } else if (/^[1-9a-hj-np-z]{32,44}$/.test(address)) {
      return 'solana';
    }
    return 'ethereum';
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  private formatTokenAmount(amount: number, decimals: number): string {
    const divisor = Math.pow(10, decimals);
    const value = amount / divisor;
    return value.toFixed(Math.min(6, decimals));
  }

  private formatPercentage(change: number): string {
    const emoji = change >= 0 ? '📈' : '📉';
    const sign = change >= 0 ? '+' : '';
    return `${emoji} ${sign}${change.toFixed(2)}%`;
  }

  private formatNetwork(network: string): string {
    const networks = {
      ethereum: 'Ethereum (ETH)',
      solana: 'Solana (SOL)',
      polygon: 'Polygon (MATIC)',
      bsc: 'BSC (BNB)'
    };
    return networks[network as keyof typeof networks] || network;
  }

  private formatAddress(address: string): string {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  private countNetworks(balances: WalletBalance[]): string[] {
    const networks = new Set(balances.map(b => this.formatNetwork(b.network)));
    return Array.from(networks);
  }

  getCommandDescription(): string {
    return 'Check wallet balances and portfolio value - Usage: /balance [address]';
  }

  getCommandExamples(): string[] {
    return [
      '/balance - Check all tracked wallets',
      '/balance 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
      '/balance 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    ];
  }
}