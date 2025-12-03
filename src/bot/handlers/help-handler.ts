import { BaseCommandHandler, BaseCommandContext } from './base-handler';
import { getHelpKeyboard } from '../keyboards/help-keyboard';
import { logger } from '../../utils/logger';

export class HelpHandler extends BaseCommandHandler {
  constructor(bot: any) {
    super(bot, 'help');
  }

  async handle(ctx: BaseCommandContext): Promise<void> {
    try {
      const helpTopic = ctx.args?.[0];
      let message: string;
      let keyboard: any;

      if (helpTopic) {
        message = this.getSpecificHelp(helpTopic);
        keyboard = { inline_keyboard: [[{ text: '🔙 Back to Help', callback_data: 'help_main' }]] };
      } else {
        message = this.getMainHelpMessage();
        keyboard = getHelpKeyboard();
      }

      await this.reply(ctx, message, {
        reply_markup: keyboard
      });
    } catch (error) {
      await this.handleError(ctx, error as Error);
    }
  }

  private getMainHelpMessage(): string {
    return `🤖 *PolyBot Help Center*

*🎯 Core Commands:*
/start - Initialize the bot and get started
/help - Show this help message
/track - Track a new wallet address
/list - List all tracked wallets
/untrack - Stop tracking a wallet

*📊 Monitoring Commands:*
/balance - Check wallet balances
/history - View transaction history
/status - Check bot and system status

*⚙️ Configuration:*
/settings - Manage your preferences
/alerts - Configure notification settings
/preferences - Set language and timezone

*🔍 Advanced Features:*
/search - Search for specific transactions
/export - Export your tracking data
/stats - View your tracking statistics

*Need more help?*
Click the buttons below for detailed guides on each feature!`;
  }

  private getSpecificHelp(topic: string): string {
    const topicLower = topic.toLowerCase();

    switch (topicLower) {
      case 'track':
        return `📍 *How to Track Wallets*

*Usage:* \`/track <wallet_address>\`

*Supported Networks:*
- Ethereum (0x...)
- Solana (Base58 encoded)

*Examples:*
- \`/track 0x742d35Cc6634C0532925a3b8D4E7E0E0e9e0e9e0\`
- \`/track 11111111111111111111111111111112\`

*Features:*
✅ Real-time transaction monitoring
✅ Balance updates
✅ Position changes
✅ Market resolutions

*Tips:*
• You can track up to 50 wallets
• Use aliases to organize wallets
• Set custom alerts for each wallet`;

      case 'alerts':
        return `🔔 *Notification Alerts*

*Types of Alerts:*
💰 Large transactions (> $1,000)
📈 Position changes ( > 10%)
🎯 Market resolutions
⚡ Real-time price movements

*Configuration:*
• Minimum transaction amount
• Percentage change thresholds
• Notification frequency
• Quiet hours

*Setup:*
Use \`/settings\` → \`Notifications\` to configure your alert preferences.`;

      case 'settings':
        return `⚙️ *Settings & Preferences*

*Available Settings:*
🌐 Language (English, Spanish, French)
🕐 Timezone (Auto-detect or manual)
🔔 Notifications (On/Off)
📊 Data export format

*Privacy Options:*
🔒 Data retention period
👤 Anonymous mode
📊 Usage analytics

*Access:* \`/settings\` command`;

      default:
        return `❓ *Unknown Help Topic*

The topic \`${topic}\` is not recognized.

*Available topics:* track, alerts, settings

Use \`/help\` to see the main help menu.`;
    }
  }
}