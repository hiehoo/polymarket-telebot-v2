import { Context, Telegraf } from 'telegraf';
import { logger } from '../../utils/logger';

export interface BaseCommandContext extends Context {
  command?: string;
  args?: string[];
  match?: RegExpMatchArray;
}

export abstract class BaseCommandHandler {
  protected bot: Telegraf;
  protected commandName: string;

  constructor(bot: Telegraf, commandName: string) {
    this.bot = bot;
    this.commandName = commandName;
  }

  abstract handle(ctx: BaseCommandContext): Promise<void>;

  protected parseCommand(text?: string): { command: string; args: string[] } {
    if (!text) {
      return { command: '', args: [] };
    }

    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase().replace('/', '') || '';
    const args = parts.slice(1);

    return { command, args };
  }

  protected async reply(ctx: Context, message: string, options?: any): Promise<void> {
    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      logger.error(`Error sending reply in ${this.commandName}:`, error);
      await ctx.reply(message);
    }
  }

  protected async handleError(ctx: Context, error: Error, message?: string): Promise<void> {
    logger.error(`Error in ${this.commandName} handler:`, error);
    const errorMessage = message || '❌ An error occurred. Please try again later.';
    await ctx.reply(errorMessage);
  }

  protected validateArgs(args: string[], minArgs: number = 0, maxArgs?: number): boolean {
    if (args.length < minArgs) {
      return false;
    }
    if (maxArgs !== undefined && args.length > maxArgs) {
      return false;
    }
    return true;
  }

  protected extractWalletAddress(args: string[]): string | null {
    const address = args[0];
    if (!address) return null;

    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const solAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

    if (ethAddressRegex.test(address) || solAddressRegex.test(address)) {
      return address;
    }

    return null;
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: BaseCommandContext) => {
      try {
        const { command, args } = this.parseCommand(ctx.message?.text);
        ctx.command = command;
        ctx.args = args;

        await this.handle(ctx);
      } catch (error) {
        await this.handleError(ctx, error as Error);
      }
    });

    logger.info(`Registered command handler: /${this.commandName}`);
  }
}