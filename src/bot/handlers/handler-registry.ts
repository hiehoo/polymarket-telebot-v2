import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { StartHandler } from './start-handler';
import { HelpHandler } from './help-handler';
import { TrackHandler } from './track-handler';
import { UntrackHandler } from './untrack-handler';
import { ListHandler } from './list-handler';
import { PreferencesHandler } from './preferences-handler';
import { BalanceHandler } from './balance-handler';
import { HistoryHandler } from './history-handler';
import { logger } from '../../utils/logger';

export class HandlerRegistry {
  private bot: Telegraf;
  private handlers: Map<string, BaseCommandHandler> = new Map();

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  registerHandler(handler: BaseCommandHandler): void {
    this.handlers.set(handler.commandName, handler);
    handler.register();
    logger.info(`Handler registered: ${handler.commandName}`);
  }

  getHandler(commandName: string): BaseCommandHandler | undefined {
    return this.handlers.get(commandName);
  }

  getAllHandlers(): BaseCommandHandler[] {
    return Array.from(this.handlers.values());
  }

  registerCoreHandlers(): void {
    this.registerHandler(new StartHandler(this.bot));
    this.registerHandler(new HelpHandler(this.bot));
  }

  registerCommandHandlers(): void {
    this.registerHandler(new TrackHandler(this.bot));
    this.registerHandler(new UntrackHandler(this.bot));
    this.registerHandler(new ListHandler(this.bot));
    this.registerHandler(new PreferencesHandler(this.bot));
    this.registerHandler(new BalanceHandler(this.bot));
    this.registerHandler(new HistoryHandler(this.bot));

    logger.info('Command handlers registered successfully');
  }

  async initializeHandlers(): Promise<void> {
    try {
      this.registerCoreHandlers();
      this.registerCommandHandlers();

      logger.info(`Initialized ${this.handlers.size} command handlers`);
    } catch (error) {
      logger.error('Failed to initialize handlers:', error);
      throw error;
    }
  }

  getAvailableCommands(): string[] {
    return Array.from(this.handlers.keys());
  }

  validateCommand(command: string): boolean {
    return this.handlers.has(command);
  }
}