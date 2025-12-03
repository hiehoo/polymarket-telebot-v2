import { BaseCommandHandler, BaseCommandContext } from './base-handler';
import { getWelcomeKeyboard } from '../keyboards/welcome-keyboard';
import { logger } from '../../utils/logger';

export class StartHandler extends BaseCommandHandler {
  constructor(bot: any) {
    super(bot, 'start');
  }

  async handle(ctx: BaseCommandContext): Promise<void> {
    try {
      if (!ctx.from) {
        await this.reply(ctx, '❌ Unable to identify user.');
        return;
      }

      logger.info(`User ${ctx.from.id} started the bot`);

      const welcomeMessage = this.getWelcomeMessage(ctx.from.first_name);
      const keyboard = getWelcomeKeyboard();

      await this.reply(ctx, welcomeMessage, {
        reply_markup: keyboard
      });
    } catch (error) {
      await this.handleError(ctx, error as Error);
    }
  }

  private getWelcomeMessage(firstName: string): string {
    return `🎯 *Welcome to PolyBot, ${firstName}!*

I'm your personal Polymarket assistant that helps you:

📊 *Track wallet activity* in real-time
🔔 *Get instant notifications* for important events
💼 *Manage multiple addresses* with ease
📈 *Monitor market movements* and positions

*Getting Started:*
🔹 /track - Start tracking a wallet
🔹 /list - View your tracked wallets
🔹 /help - See all available commands
🔹 /settings - Configure your preferences

Ready to start tracking? Click the buttons below!`;
  }
}