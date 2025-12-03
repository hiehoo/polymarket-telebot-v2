import { Context, Telegraf } from 'telegraf';
import { logger } from '../../utils/logger';
import { CommandSanitizer } from '../utils/command-sanitizer';

export interface BotError {
  code: string;
  message: string;
  userId?: number;
  command?: string;
  timestamp: number;
  stack?: string;
  context?: any;
}

export class ErrorHandler {
  private bot: Telegraf;
  private errorCounts: Map<string, number> = new Map();
  private readonly ERROR_THRESHOLD = 5; // Alert after 5 errors per user

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  setupErrorHandling(): void {
    // Global error handler
    this.bot.catch((error: any, ctx?: Context) => {
      this.handleError(error, ctx);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection:', {
        reason: reason?.toString(),
        promise: promise.toString(),
        stack: reason instanceof Error ? reason.stack : undefined
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', {
        message: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    logger.info('Error handling setup complete');
  }

  async handleError(error: any, ctx?: Context): Promise<void> {
    const botError: BotError = {
      code: this.extractErrorCode(error),
      message: error.message || 'Unknown error occurred',
      userId: ctx?.from?.id,
      command: this.extractCommand(ctx),
      timestamp: Date.now(),
      stack: error.stack,
      context: ctx ? this.extractContext(ctx) : undefined
    };

    // Log the error
    this.logError(botError);

    // Track error frequency
    this.trackError(botError);

    // Send user-friendly error message
    if (ctx) {
      await this.sendErrorResponse(ctx, botError);
    }

    // Check if we need to escalate
    await this.checkEscalation(botError);
  }

  private extractErrorCode(error: any): string {
    if (error.code) return error.code;
    if (error.name) return error.name;
    if (error.type) return error.type;
    return 'UNKNOWN_ERROR';
  }

  private extractCommand(ctx?: Context): string {
    if (!ctx?.message?.text) return 'unknown';

    const match = ctx.message.text.match(/^\/(\w+)/);
    return match ? match[1] : 'unknown';
  }

  private extractContext(ctx: Context): any {
    if (!ctx) return null;

    return {
      messageId: ctx.message?.message_id,
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      userId: ctx.from?.id,
      username: ctx.from?.username,
      command: this.extractCommand(ctx),
      messageLength: ctx.message?.text?.length
    };
  }

  private logError(error: BotError): void {
    const logData = {
      code: error.code,
      message: CommandSanitizer.sanitizeErrorMessage(error.message),
      userId: error.userId,
      command: error.command,
      timestamp: new Date(error.timestamp).toISOString(),
      context: error.context
    };

    if (error.code === 'RATE_LIMIT' || error.code === 'TOO_MANY_REQUESTS') {
      logger.warn(`Rate limit error: ${error.message}`, logData);
    } else if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') {
      logger.error(`Network error: ${error.message}`, logData);
    } else {
      logger.error(`Bot error occurred: ${error.message}`, {
        ...logData,
        stack: error.stack
      });
    }
  }

  private trackError(error: BotError): void {
    if (!error.userId) return;

    const key = `${error.userId}_${error.code}`;
    const currentCount = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, currentCount + 1);

    // Clean old entries (older than 1 hour)
    this.cleanupErrorTracking();

    // Check if user exceeded error threshold
    if (currentCount + 1 >= this.ERROR_THRESHOLD) {
      logger.warn(`User ${error.userId} exceeded error threshold for ${error.code}`);
      this.notifyErrorThreshold(error);
    }
  }

  private cleanupErrorTracking(): void {
    // Simple cleanup - in production, use Redis with TTL
    if (this.errorCounts.size > 10000) {
      this.errorCounts.clear();
    }
  }

  private async sendErrorResponse(ctx: Context, error: BotError): Promise<void> {
    try {
      const errorMessage = this.getErrorMessage(error);

      await ctx.reply(errorMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '❓ Help', callback_data: 'show_help' },
            { text: '🏠 Main Menu', callback_data: 'main_menu' }
          ]]
        }
      });
    } catch (replyError) {
      logger.error('Failed to send error response:', replyError);
    }
  }

  private getErrorMessage(error: BotError): string {
    switch (error.code) {
      case 'RATE_LIMIT':
      case 'TOO_MANY_REQUESTS':
        return '⏰ *Too many requests*\n\nPlease wait a moment before trying again.';

      case 'TIMEOUT':
      case 'NETWORK_ERROR':
        return '🌐 *Connection error*\n\nPlease try again in a few moments.';

      case 'INVALID_WALLET_ADDRESS':
        return '❌ *Invalid wallet address*\n\nPlease check the address and try again.';

      case 'WALLET_ALREADY_TRACKED':
        return '⚠️ *Wallet already tracked*\n\nThis wallet is already in your tracking list.';

      case 'WALLET_NOT_FOUND':
        return '🔍 *Wallet not found*\n\nThis wallet is not in your tracking list.';

      case 'INSUFFICIENT_PERMISSIONS':
        return '🚫 *Permission denied*\n\nYou don\'t have permission to perform this action.';

      case 'DATABASE_ERROR':
        return '💾 *Database error*\n\nPlease try again later.';

      case 'VALIDATION_ERROR':
        return '❓ *Invalid input*\n\nPlease check your input and try again.';

      case 'QUOTA_EXCEEDED':
        return '📊 *Quota exceeded*\n\nYou\'ve reached your limit. Upgrade your plan for more features.';

      default:
        return '❌ *Something went wrong*\n\nAn unexpected error occurred. Please try again later.';
    }
  }

  private async checkEscalation(error: BotError): Promise<void> {
    const shouldEscalate =
      error.code === 'DATABASE_ERROR' ||
      error.code === 'CRITICAL_ERROR' ||
      error.code === 'SECURITY_BREACH' ||
      (this.errorCounts.get(`${error.userId}_${error.code}`) || 0) >= 10;

    if (shouldEscalate) {
      await this.escalateError(error);
    }
  }

  private async escalateError(error: BotError): Promise<void> {
    logger.error('CRITICAL: Error escalation required', {
      code: error.code,
      message: error.message,
      userId: error.userId,
      command: error.command,
      errorCount: this.errorCounts.get(`${error.userId}_${error.code}`)
    });

    // In production, this would:
    // - Send notification to admin channel
    // - Create ticket in issue tracker
    // - Trigger monitoring alerts
  }

  private async notifyErrorThreshold(error: BotError): Promise<void> {
    logger.warn(`Error threshold notification for user ${error.userId}`, {
      code: error.code,
      count: this.errorCounts.get(`${error.userId}_${error.code}`)
    });

    // Could implement temporary user restrictions here
  }

  // Public methods for manual error handling
  async handleValidationErrors(validationErrors: string[], ctx: Context): Promise<void> {
    const error: BotError = {
      code: 'VALIDATION_ERROR',
      message: validationErrors.join('; '),
      userId: ctx.from?.id,
      command: this.extractCommand(ctx),
      timestamp: Date.now()
    };

    await this.handleError(error, ctx);
  }

  async handleDatabaseErrors(dbError: any, ctx?: Context): Promise<void> {
    const error: BotError = {
      code: 'DATABASE_ERROR',
      message: dbError.message || 'Database operation failed',
      userId: ctx?.from?.id,
      command: this.extractCommand(ctx),
      timestamp: Date.now(),
      stack: dbError.stack
    };

    await this.handleError(error, ctx);
  }

  async handleTimeoutErrors(timeoutError: any, ctx?: Context): Promise<void> {
    const error: BotError = {
      code: 'TIMEOUT',
      message: 'Operation timed out',
      userId: ctx?.from?.id,
      command: this.extractCommand(ctx),
      timestamp: Date.now()
    };

    await this.handleError(error, ctx);
  }

  getErrorStats(): { [code: string]: number } {
    const stats: { [code: string]: number } = {};
    for (const [key, count] of this.errorCounts) {
      const code = key.split('_').slice(1).join('_');
      stats[code] = (stats[code] || 0) + count;
    }
    return stats;
  }
}