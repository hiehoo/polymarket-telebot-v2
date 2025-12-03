import { Telegraf, session } from 'telegraf';
import {
  authMiddleware,
  rateLimitMiddleware,
  sessionMiddleware,
  sessionCleanupMiddleware
} from './middleware';
import {
  HandlerRegistry,
  ErrorHandler,
  CallbackHandler
} from './handlers';
import { NotificationService } from '../services/notifications';
import { logger } from '../utils/logger';

export interface BotConfig {
  token: string;
  webhookUrl?: string;
  webhookSecret?: string;
  environment: 'development' | 'production' | 'test';
}

export class BotService {
  private bot: Telegraf;
  private handlerRegistry: HandlerRegistry;
  private errorHandler: ErrorHandler;
  private callbackHandler: CallbackHandler;
  private notificationService: NotificationService;
  private config: BotConfig;
  private isRunning = false;

  constructor(config: BotConfig) {
    this.config = config;
    this.bot = new Telegraf(config.token);
    this.handlerRegistry = new HandlerRegistry(this.bot);
    this.errorHandler = new ErrorHandler(this.bot);
    this.callbackHandler = new CallbackHandler(this.errorHandler);
    this.notificationService = new NotificationService(this.bot);

    this.setupMiddleware();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  public async start(): Promise<void> {
    try {
      if (this.isRunning) {
        logger.warn('Bot is already running');
        return;
      }

      logger.info(`Starting PolyBot in ${this.config.environment} mode`);

      await this.handlerRegistry.initializeHandlers();

      this.startNotificationProcessing();

      if (this.config.webhookUrl && this.config.environment === 'production') {
        await this.startWebhook();
      } else {
        await this.startPolling();
      }

      this.isRunning = true;
      logger.info('PolyBot started successfully');

      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        return;
      }

      logger.info('Stopping PolyBot...');
      this.isRunning = false;
      this.bot.stop();
      logger.info('Bot stopped');

    } catch (error) {
      logger.error('Error stopping bot:', error);
    }
  }

  private setupMiddleware(): void {
    this.bot.use(session({
      defaultSession: () => ({
        state: {},
        lastActivity: Date.now(),
        createdAt: Date.now()
      })
    }));

    this.bot.use(authMiddleware());
    this.bot.use(rateLimitMiddleware());
    this.bot.use(sessionMiddleware());
    this.bot.use(sessionCleanupMiddleware());

    logger.info('Middleware setup complete');
  }

  private setupHandlers(): void {
    this.handlerRegistry.registerCoreHandlers();

    this.bot.on('callback_query', async (ctx) => {
      await this.callbackHandler.handleCallback(ctx);
    });

    this.bot.on('inline_query', async (ctx) => {
      logger.info('Inline query received', {
        userId: ctx.from.id,
        query: ctx.inlineQuery.query
      });
    });

    this.bot.on('message', async (ctx) => {
      if (!ctx.message?.text?.startsWith('/')) {
        await this.handleNonCommandMessage(ctx);
      }
    });

    logger.info('Handlers setup complete');
  }

  private setupErrorHandling(): void {
    this.errorHandler.setupErrorHandling();
    logger.info('Error handling setup complete');
  }

  private async startWebhook(): Promise<void> {
    if (!this.config.webhookUrl) {
      throw new Error('Webhook URL is required for webhook mode');
    }

    await this.bot.launch({
      webhook: {
        url: this.config.webhookUrl,
        secretToken: this.config.webhookSecret
      }
    });

    logger.info(`Webhook started at ${this.config.webhookUrl}`);
  }

  private async startPolling(): Promise<void> {
    await this.bot.launch({
      dropPendingUpdates: true
    });

    logger.info('Polling started');
  }

  private startNotificationProcessing(): void {
    setInterval(async () => {
      try {
        await this.notificationService.processNotifications();
      } catch (error) {
        logger.error('Error processing notifications:', error);
      }
    }, 5000);

    logger.info('Notification processing started');
  }

  private async handleNonCommandMessage(ctx: any): Promise<void> {
    try {
      const text = ctx.message?.text;
      if (text && this.looksLikeWalletAddress(text)) {
        await ctx.reply(
          '🔍 *Wallet Address Detected*\n\n' +
          'Would you like to track this address?',
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Track Address', callback_data: `track_address_${text}` },
                { text: '❌ Cancel', callback_data: 'cancel' }
              ]]
            },
            parse_mode: 'Markdown'
          }
        );
        return;
      }

      if (text) {
        await ctx.reply(
          '❓ *Unknown Command*\n\n' +
          'Use /help to see available commands or /start to begin.',
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      await this.errorHandler.handleError(error, ctx);
    }
  }

  private looksLikeWalletAddress(text: string): boolean {
    const cleanText = text.trim().toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(cleanText)) return true;
    if (/^[1-9a-hj-np-z]{32,44}$/.test(cleanText)) return true;
    return false;
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  public getBotInfo(): { isRunning: boolean; uptime: number; config: Partial<BotConfig> } {
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      config: {
        environment: this.config.environment,
        webhookUrl: this.config.webhookUrl ? 'configured' : 'not configured'
      }
    };
  }

  public async getHealthStatus(): Promise<{
    bot: boolean;
    notifications: boolean;
    errorRate: number;
    queueSize: number;
  }> {
    const errorStats = this.errorHandler.getErrorStats();
    const totalErrors = Object.values(errorStats).reduce((sum, count) => sum + count, 0);
    const queueSize = await this.notificationService.getQueueSize();

    return {
      bot: this.isRunning,
      notifications: true,
      errorRate: totalErrors > 0 ? totalErrors / 100 : 0,
      queueSize
    };
  }

  public getBot(): Telegraf {
    return this.bot;
  }

  public getNotificationService(): NotificationService {
    return this.notificationService;
  }

  public getErrorHandler(): ErrorHandler {
    return this.errorHandler;
  }
}