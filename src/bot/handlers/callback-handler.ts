import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { CommandSanitizer } from '../utils/command-sanitizer';
import { ErrorHandler } from './error-handler';

export class CallbackHandler {
  private errorHandler: ErrorHandler;

  constructor(errorHandler: ErrorHandler) {
    this.errorHandler = errorHandler;
  }

  async handleCallback(ctx: Context): Promise<void> {
    try {
      if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
        await this.answerCallback(ctx, 'Invalid callback', true);
        return;
      }

      const callbackData = CommandSanitizer.sanitizeCallbackData(ctx.callbackQuery.data);
      const [action, ...params] = callbackData.split('_');

      logger.info(`Callback received: ${action}`, {
        userId: ctx.from?.id,
        params: params.length
      });

      // Answer callback immediately to show loading state
      await this.answerCallback(ctx, 'Processing...');

      // Route to appropriate handler
      switch (action) {
        case 'wallet':
          await this.handleWalletCallbacks(ctx, params);
          break;
        case 'help':
          await this.handleHelpCallbacks(ctx, params);
          break;
        case 'settings':
          await this.handleSettingsCallbacks(ctx, params);
          break;
        case 'main_menu':
          await this.handleMainMenu(ctx);
          break;
        case 'cancel':
          await this.handleCancel(ctx);
          break;
        default:
          await this.handleUnknownCallback(ctx, action);
      }
    } catch (error) {
      await this.errorHandler.handleError(error, ctx);
      await this.answerCallback(ctx, 'Error occurred', true);
    }
  }

  private async handleWalletCallbacks(ctx: Context, params: string[]): Promise<void> {
    const [action, walletId] = params;

    switch (action) {
      case 'select':
        await this.showWalletDetails(ctx, walletId);
        break;
      case 'remove':
        await this.confirmWalletRemoval(ctx, walletId);
        break;
      case 'balance':
        await this.showWalletBalance(ctx, walletId);
        break;
      case 'history':
        await this.showWalletHistory(ctx, walletId);
        break;
      case 'alerts':
        await this.showWalletAlerts(ctx, walletId);
        break;
      default:
        await this.answerCallback(ctx, 'Unknown wallet action', true);
    }
  }

  private async handleHelpCallbacks(ctx: Context, params: string[]): Promise<void> {
    const [topic] = params;

    switch (topic) {
      case 'main':
        await this.showMainHelp(ctx);
        break;
      case 'track':
        await this.showTrackingHelp(ctx);
        break;
      case 'alerts':
        await this.showAlertsHelp(ctx);
        break;
      case 'settings':
        await this.showSettingsHelp(ctx);
        break;
      case 'stats':
        await this.showStatsHelp(ctx);
        break;
      case 'advanced':
        await this.showAdvancedHelp(ctx);
        break;
      case 'faq':
        await this.showFAQ(ctx);
        break;
      default:
        await this.answerCallback(ctx, 'Help topic not found', true);
    }
  }

  private async handleSettingsCallbacks(ctx: Context, params: string[]): Promise<void> {
    const [action, value] = params;

    switch (action) {
      case 'toggle':
        await this.toggleSetting(ctx, value);
        break;
      case 'change':
        await this.changeSetting(ctx, value);
        break;
      case 'alert_types':
        await this.showAlertTypes(ctx);
        break;
      case 'privacy':
        await this.showPrivacySettings(ctx);
        break;
      default:
        await this.answerCallback(ctx, 'Unknown settings action', true);
    }
  }

  private async handleMainMenu(ctx: Context): Promise<void> {
    // Implementation would show main menu
    await this.answerCallback(ctx, 'Opening main menu...');
  }

  private async handleCancel(ctx: Context): Promise<void> {
    // Implementation would cancel current operation
    await this.answerCallback(ctx, 'Operation cancelled');
    await ctx.reply('❌ Operation cancelled');
  }

  private async handleUnknownCallback(ctx: Context, action: string): Promise<void> {
    logger.warn(`Unknown callback action: ${action}`, {
      userId: ctx.from?.id,
      data: ctx.callbackQuery?.data
    });

    await this.answerCallback(ctx, 'Unknown action', true);
    await ctx.reply('❓ Unknown action. Please try again.');
  }

  // Helper methods for specific actions
  private async showWalletDetails(ctx: Context, walletId?: string): Promise<void> {
    if (!walletId) {
      await this.answerCallback(ctx, 'Wallet ID missing', true);
      return;
    }

    // Implementation would fetch and display wallet details
    await this.answerCallback(ctx, 'Loading wallet details...');
    // await ctx.reply('📊 *Wallet Details*\n\n[Wallet information would be displayed here]');
  }

  private async confirmWalletRemoval(ctx: Context, walletId?: string): Promise<void> {
    if (!walletId) {
      await this.answerCallback(ctx, 'Wallet ID missing', true);
      return;
    }

    // Implementation would show confirmation dialog
    await this.answerCallback(ctx, 'Loading confirmation...');
    // await ctx.reply(
    //   '⚠️ *Confirm Removal*\n\n' +
    //   'Are you sure you want to remove this wallet?',
    //   {
    //     reply_markup: {
    //       inline_keyboard: [
    //         [
    //           { text: '✅ Yes, Remove', callback_data: `wallet_confirm_remove_${walletId}` },
    //           { text: '❌ Cancel', callback_data: 'cancel' }
    //         ]
    //       ]
    //     }
    //   }
    // );
  }

  private async showWalletBalance(ctx: Context, walletId?: string): Promise<void> {
    if (!walletId) {
      await this.answerCallback(ctx, 'Wallet ID missing', true);
      return;
    }

    await this.answerCallback(ctx, 'Loading balance...');
    // Implementation would fetch and display balance
  }

  private async showWalletHistory(ctx: Context, walletId?: string): Promise<void> {
    if (!walletId) {
      await this.answerCallback(ctx, 'Wallet ID missing', true);
      return;
    }

    await this.answerCallback(ctx, 'Loading history...');
    // Implementation would fetch and display transaction history
  }

  private async showWalletAlerts(ctx: Context, walletId?: string): Promise<void> {
    if (!walletId) {
      await this.answerCallback(ctx, 'Wallet ID missing', true);
      return;
    }

    await this.answerCallback(ctx, 'Loading alerts...');
    // Implementation would show wallet-specific alert settings
  }

  private async showMainHelp(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading help...');
    // Implementation would show main help menu
  }

  private async showTrackingHelp(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading tracking help...');
    // Implementation would show wallet tracking help
  }

  private async showAlertsHelp(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading alerts help...');
    // Implementation would show alerts configuration help
  }

  private async showSettingsHelp(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading settings help...');
    // Implementation would show settings help
  }

  private async showStatsHelp(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading stats help...');
    // Implementation would show statistics help
  }

  private async showAdvancedHelp(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading advanced help...');
    // Implementation would show advanced features help
  }

  private async showFAQ(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading FAQ...');
    // Implementation would show frequently asked questions
  }

  private async toggleSetting(ctx: Context, setting?: string): Promise<void> {
    if (!setting) {
      await this.answerCallback(ctx, 'Setting not specified', true);
      return;
    }

    await this.answerCallback(ctx, 'Toggling setting...');
    // Implementation would toggle the specified setting
  }

  private async changeSetting(ctx: Context, setting?: string): Promise<void> {
    if (!setting) {
      await this.answerCallback(ctx, 'Setting not specified', true);
      return;
    }

    await this.answerCallback(ctx, 'Opening setting...');
    // Implementation would open setting change interface
  }

  private async showAlertTypes(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading alert types...');
    // Implementation would show alert type configuration
  }

  private async showPrivacySettings(ctx: Context): Promise<void> {
    await this.answerCallback(ctx, 'Loading privacy settings...');
    // Implementation would show privacy configuration
  }

  private async answerCallback(ctx: Context, text: string, showAlert: boolean = false): Promise<void> {
    try {
      if (ctx.callbackQuery && 'id' in ctx.callbackQuery) {
        await ctx.answerCbQuery(text, showAlert);
      }
    } catch (error) {
      logger.error('Failed to answer callback:', error);
      // Don't throw here as this might be called from error handlers
    }
  }
}