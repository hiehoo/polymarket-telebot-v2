import { Context } from 'telegraf';
import { BaseHandler } from './base-handler';
import { BatchOperations } from '../../advanced/batch/batch-operations';

export class BatchOperationsHandler extends BaseHandler {
  constructor(private batchOperations: BatchOperations) {
    super();
  }

  async handle(ctx: Context): Promise<void> {
    if (!ctx.from) return;

    const message = ctx.message?.text || '';
    const isCommand = message.startsWith('/');

    if (isCommand) {
      await this.handleCommand(ctx, message);
    } else {
      await this.handleText(ctx, message);
    }
  }

  private async handleCommand(ctx: Context, message: string): Promise<void> {
    const [command, ...args] = message.split(' ');
    const userId = ctx.from?.id;

    switch (command) {
      case '/track-multiple':
        await this.handleTrackMultiple(ctx, args);
        break;
      case '/untrack-multiple':
        await this.handleUntrackMultiple(ctx, args);
        break;
      case '/batch-create':
        await this.handleBatchCreate(ctx, args);
        break;
      case '/batch-list':
        await this.handleBatchList(ctx);
        break;
      case '/batch-track':
        await this.handleBatchTrack(ctx, args);
        break;
      case '/batch-delete':
        await this.handleBatchDelete(ctx, args);
        break;
    }
  }

  private async handleTrackMultiple(ctx: Context, args: string[]): Promise<void> {
    if (!ctx.from) return;

    const walletsText = args.join(' ');
    const walletAddresses = this.batchOperations.parseWalletAddresses(walletsText);

    if (walletAddresses.length === 0) {
      await ctx.reply('❌ No valid wallet addresses found. Please provide Ethereum addresses (0x...).');
      return;
    }

    const validation = this.batchOperations.validateBatchSize(walletAddresses);
    if (!validation.valid) {
      await ctx.reply(`❌ ${validation.error}`);
      return;
    }

    try {
      await ctx.reply('🔄 Processing batch operation... This may take a moment.');

      const result = await this.batchOperations.processBatchTrackMultiple(ctx, walletsText);

      const summary = this.batchOperations.generateBatchSummary(result);

      let response = `✅ Batch operation completed!\n\n`;
      response += summary;

      if (result.successful > 0) {
        response += `\n💡 You can now use these wallets with individual commands or organize them into groups.`;
      }

      await ctx.reply(response);

    } catch (error) {
      await ctx.reply(`❌ Error processing batch operation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleUntrackMultiple(ctx: Context, args: string[]): Promise<void> {
    if (!ctx.from) return;

    const walletsText = args.join(' ');
    const walletAddresses = this.batchOperations.parseWalletAddresses(walletsText);

    if (walletAddresses.length === 0) {
      await ctx.reply('❌ No valid wallet addresses found. Please provide Ethereum addresses (0x...).');
      return;
    }

    try {
      await ctx.reply('🔄 Processing batch untrack operation...');

      const result = await this.batchOperations.processBatchUntrackMultiple(ctx, walletAddresses);
      const summary = this.batchOperations.generateBatchSummary(result);

      let response = `✅ Batch untrack completed!\n\n`;
      response += summary;
      response += `\n💡 These wallets are no longer being tracked.`;

      await ctx.reply(response);

    } catch (error) {
      await ctx.reply(`❌ Error processing batch operation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleBatchCreate(ctx: Context, args: string[]): Promise<void> {
    if (!ctx.from) return;

    if (args.length < 2) {
      await ctx.reply(
        '❌ Please provide a batch name and wallets.\n\n' +
        'Usage: /batch-create <name> <wallet1> <wallet2> ... <walletN>\n\n' +
        'Example: /batch-create "Trading Group" 0x123... 0x456... 0x789...'
      );
      return;
    }

    const [name, ...walletArgs] = args;
    const walletsText = walletArgs.join(' ');
    const walletAddresses = this.batchOperations.parseWalletAddresses(walletsText);

    if (walletAddresses.length === 0) {
      await ctx.reply('❌ No valid wallet addresses found in the provided arguments.');
      return;
    }

    try {
      const batch = await this.batchOperations.createWalletBatch(ctx.from.id, name);

      await this.batchOperations.addWalletsToBatch(batch.id, walletAddresses);

      let response = `✅ Wallet batch created!\n\n`;
      response += `📦 Name: ${name}\n`;
      response += `👛 Wallets: ${walletAddresses.length}\n`;
      response += `🆔 Batch ID: ${batch.id}\n\n`;
      response += `💡 Use /batch-track ${name} to track all wallets in this batch.`;

      await ctx.reply(response);

    } catch (error) {
      await ctx.reply(`❌ Error creating batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleBatchList(ctx: Context): Promise<void> {
    if (!ctx.from) return;

    try {
      const batches = await this.batchOperations.getUserBatches(ctx.from.id);

      if (batches.length === 0) {
        await ctx.reply('📦 You have no wallet batches yet.\n\n💡 Create a batch with /batch-create <name> <wallets>');
        return;
      }

      let response = `📦 Your Wallet Batches (${batches.length})\n\n`;

      for (const batch of batches.slice(0, 10)) {
        response += `📁 ${batch.name}\n`;
        response += `   👛 ${batch.wallets.length} wallets\n`;
        response += `   📅 Created: ${batch.createdAt.toLocaleDateString()}\n`;
        response += `   ${batch.isActive ? '🟢 Active' : '🔴 Inactive'}\n`;
        response += `   🆔 ${batch.id}\n\n`;
      }

      if (batches.length > 10) {
        response += `... and ${batches.length - 10} more batches.\n\n`;
      }

      response += `💡 Use /batch-track <name> to track a batch or /batch-delete <name> to delete one.`;

      await ctx.reply(response);

    } catch (error) {
      await ctx.reply(`❌ Error fetching batches: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleBatchTrack(ctx: Context, args: string[]): Promise<void> {
    if (!ctx.from) return;

    if (args.length === 0) {
      await ctx.reply(
        '❌ Please provide a batch name.\n\n' +
        'Usage: /batch-track <batch-name>\n\n' +
        '💡 Use /batch-list to see your available batches.'
      );
      return;
    }

    const batchName = args.join(' ');

    try {
      const batches = await this.batchOperations.getUserBatches(ctx.from.id);
      const batch = batches.find(b => b.name.toLowerCase() === batchName.toLowerCase());

      if (!batch) {
        await ctx.reply(`❌ Batch "${batchName}" not found.\n\n💡 Use /batch-list to see your available batches.`);
        return;
      }

      await ctx.reply(`🔄 Tracking batch "${batchName}" with ${batch.wallets.length} wallets...`);

      const result = await this.batchOperations.trackBatch(ctx.from.id, batch.id);
      const summary = this.batchOperations.generateBatchSummary(result);

      let response = `✅ Batch tracking completed!\n\n`;
      response += `📦 Batch: ${batchName}\n`;
      response += summary;
      response += `\n💡 All wallets in "${batchName}" are now being tracked individually.`;

      await ctx.reply(response);

    } catch (error) {
      await ctx.reply(`❌ Error tracking batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleBatchDelete(ctx: Context, args: string[]): Promise<void> {
    if (!ctx.from) return;

    if (args.length === 0) {
      await ctx.reply(
        '❌ Please provide a batch name.\n\n' +
        'Usage: /batch-delete <batch-name>'
      );
      return;
    }

    const batchName = args.join(' ');

    try {
      const batches = await this.batchOperations.getUserBatches(ctx.from.id);
      const batch = batches.find(b => b.name.toLowerCase() === batchName.toLowerCase());

      if (!batch) {
        await ctx.reply(`❌ Batch "${batchName}" not found.`);
        return;
      }

      await this.batchOperations.deleteBatch(ctx.from.id, batch.id);

      await ctx.reply(`✅ Batch "${batchName}" has been deleted.\n\n💡 Note: Individual wallets may still be tracked. Use /untrack-multiple if needed.`);

    } catch (error) {
      await ctx.reply(`❌ Error deleting batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleText(ctx: Context, message: string): Promise<void> {
    const walletAddresses = this.batchOperations.parseWalletAddresses(message);

    if (walletAddresses.length > 0) {
      const validation = this.batchOperations.validateBatchSize(walletAddresses);

      if (validation.valid) {
        let response = `👛 Found ${walletAddresses.length} wallet addresses:\n\n`;

        for (const wallet of walletAddresses.slice(0, 5)) {
          response += `• ${wallet.slice(0, 8)}...${wallet.slice(-6)}\n`;
        }

        if (walletAddresses.length > 5) {
          response += `• ... and ${walletAddresses.length - 5} more\n`;
        }

        response += `\nWould you like to:\n`;
        response += `• /track-multiple ${walletAddresses.slice(0, 3).join(' ')}\n`;
        response += `• /batch-create "Quick Batch" ${walletAddresses.slice(0, 2).join(' ')}`;

        await ctx.reply(response);
      }
    }
  }

  async handleBatchAnalytics(ctx: Context): Promise<void> {
    if (!ctx.from) return;

    try {
      const analytics = await this.batchOperations.getBatchAnalytics(ctx.from.id);

      let response = `📊 Batch Operations Analytics\n\n`;
      response += `📦 Total Batches: ${analytics.totalBatches}\n`;
      response += `👛 Total Wallets: ${analytics.totalWallets}\n`;
      response += `🟢 Active Batches: ${analytics.activeBatches}\n`;
      response += `📈 Avg Wallets/Batch: ${analytics.averageWalletsPerBatch.toFixed(1)}\n\n`;

      if (analytics.mostRecentBatch) {
        response += `📅 Most Recent:\n`;
        response += `   ${analytics.mostRecentBatch.name}\n`;
        response += `   ${analytics.mostRecentBatch.wallets.length} wallets\n`;
        response += `   Created: ${analytics.mostRecentBatch.createdAt.toLocaleDateString()}\n\n`;
      }

      response += `💡 Tips:\n`;
      response += `• Group related wallets into batches for easier management\n`;
      response += `• Use aliases to identify wallets easily\n`;
      response += `• Regular cleanup of unused batches keeps things organized`;

      await ctx.reply(response);

    } catch (error) {
      await ctx.reply(`❌ Error fetching batch analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}