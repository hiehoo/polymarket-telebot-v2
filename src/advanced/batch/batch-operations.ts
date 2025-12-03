import { Context } from 'telegraf';
import { Logger } from '../../utils/logger';
import { UserService } from '../../services/database/user-service';
import { WalletCacheService } from '../../services/redis/wallet-cache-service';

export interface BatchOperation {
  operation: 'track' | 'untrack' | 'pause' | 'resume';
  wallets: string[];
  userId: number;
  telegramId: number;
  options?: {
    aliases?: Record<string, string>;
    notifications?: boolean;
    group?: string;
  };
}

export interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    wallet: string;
    success: boolean;
    error?: string;
    message?: string;
  }>;
  summary: {
    duration: number;
    averageTimePerWallet: number;
  };
}

export interface WalletBatch {
  id: string;
  name: string;
  wallets: string[];
  userId: number;
  createdAt: Date;
  lastUpdated: Date;
  isActive: boolean;
  description?: string;
}

export class BatchOperations {
  private logger = Logger.getInstance();
  private activeBatches = new Map<string, Promise<BatchResult>>();
  private readonly MAX_BATCH_SIZE = 50;
  private readonly BATCH_TIMEOUT = 300000; // 5 minutes

  constructor(
    private userService: UserService,
    private walletCacheService: WalletCacheService
  ) {}

  async processBatchTrackMultiple(
    ctx: Context,
    wallets: string[],
    options?: {
      aliases?: Record<string, string>;
      group?: string;
    }
  ): Promise<BatchResult> {
    const batchId = this.generateBatchId(ctx.from?.id || 0, 'track');

    if (this.activeBatches.has(batchId)) {
      throw new Error('Batch operation already in progress');
    }

    const startTime = Date.now();

    try {
      const batchPromise = this.executeBatchOperation({
        operation: 'track',
        wallets,
        userId: ctx.from?.id || 0,
        telegramId: ctx.chat?.id || 0,
        options
      });

      this.activeBatches.set(batchId, batchPromise);

      const result = await Promise.race([
        batchPromise,
        this.createTimeoutPromise()
      ]);

      return result;

    } finally {
      this.activeBatches.delete(batchId);
      const duration = Date.now() - startTime;
      this.logger.info('Batch track operation completed', {
        userId: ctx.from?.id,
        walletCount: wallets.length,
        duration,
        successRate: (result.successful / result.total) * 100
      });
    }
  }

  async processBatchUntrackMultiple(
    ctx: Context,
    wallets: string[]
  ): Promise<BatchResult> {
    const batchId = this.generateBatchId(ctx.from?.id || 0, 'untrack');

    if (this.activeBatches.has(batchId)) {
      throw new Error('Batch operation already in progress');
    }

    const startTime = Date.now();

    try {
      const batchPromise = this.executeBatchOperation({
        operation: 'untrack',
        wallets,
        userId: ctx.from?.id || 0,
        telegramId: ctx.chat?.id || 0
      });

      this.activeBatches.set(batchId, batchPromise);

      const result = await Promise.race([
        batchPromise,
        this.createTimeoutPromise()
      ]);

      return result;

    } finally {
      this.activeBatches.delete(batchId);
      const duration = Date.now() - startTime;
      this.logger.info('Batch untrack operation completed', {
        userId: ctx.from?.id,
        walletCount: wallets.length,
        duration
      });
    }
  }

  private async executeBatchOperation(operation: BatchOperation): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];
    let successful = 0;
    let failed = 0;

    // Validate wallet addresses first
    const validWallets = this.validateWallets(operation.wallets);
    const invalidWallets = operation.wallets.filter(wallet => !validWallets.includes(wallet));

    // Add invalid wallet results
    for (const wallet of invalidWallets) {
      results.push({
        wallet,
        success: false,
        error: 'Invalid wallet address format'
      });
      failed++;
    }

    // Process valid wallets in parallel chunks
    const chunks = this.chunkArray(validWallets, 5); // Process 5 at a time

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (wallet) => {
        try {
          let result;

          switch (operation.operation) {
            case 'track':
              result = await this.trackSingleWallet(wallet, operation);
              break;
            case 'untrack':
              result = await this.untrackSingleWallet(wallet, operation);
              break;
            case 'pause':
              result = await this.pauseSingleWallet(wallet, operation);
              break;
            case 'resume':
              result = await this.resumeSingleWallet(wallet, operation);
              break;
            default:
              throw new Error(`Unknown operation: ${operation.operation}`);
          }

          successful++;
          return result;

        } catch (error) {
          failed++;
          return {
            wallet,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    const duration = Date.now() - startTime;

    return {
      total: operation.wallets.length,
      successful,
      failed,
      results,
      summary: {
        duration,
        averageTimePerWallet: operation.wallets.length > 0 ? duration / operation.wallets.length : 0
      }
    };
  }

  private async trackSingleWallet(wallet: string, operation: BatchOperation): Promise<BatchResult['results'][0]> {
    try {
      const alias = operation.options?.aliases?.[wallet];

      await this.userService.addWallet(
        operation.userId,
        wallet,
        alias
      );

      // Update cache
      await this.walletCacheService.setWalletInfo(wallet, {
        address: wallet,
        alias,
        addedAt: new Date(),
        userId: operation.userId
      });

      return {
        wallet,
        success: true,
        message: alias ? `${wallet} (alias: ${alias})` : wallet
      };

    } catch (error) {
      throw new Error(`Failed to track ${wallet}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async untrackSingleWallet(wallet: string, operation: BatchOperation): Promise<BatchResult['results'][0]> {
    try {
      await this.userService.removeWallet(operation.userId, wallet);

      // Remove from cache
      await this.walletCacheService.deleteWalletInfo(wallet);

      return {
        wallet,
        success: true,
        message: 'Successfully removed'
      };

    } catch (error) {
      throw new Error(`Failed to untrack ${wallet}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async pauseSingleWallet(wallet: string, operation: BatchOperation): Promise<BatchResult['results'][0]> {
    try {
      await this.userService.pauseWalletNotifications(operation.userId, wallet);

      return {
        wallet,
        success: true,
        message: 'Notifications paused'
      };

    } catch (error) {
      throw new Error(`Failed to pause ${wallet}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async resumeSingleWallet(wallet: string, operation: BatchOperation): Promise<BatchResult['results'][0]> {
    try {
      await this.userService.resumeWalletNotifications(operation.userId, wallet);

      return {
        wallet,
        success: true,
        message: 'Notifications resumed'
      };

    } catch (error) {
      throw new Error(`Failed to resume ${wallet}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validateWallets(wallets: string[]): string[] {
    return wallets.filter(wallet => {
      // Basic Ethereum address validation
      return /^0x[a-fA-F0-9]{40}$/.test(wallet);
    });
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private generateBatchId(userId: number, operation: string): string {
    return `batch_${userId}_${operation}_${Date.now()}`;
  }

  private createTimeoutPromise(): Promise<BatchResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Batch operation timed out'));
      }, this.BATCH_TIMEOUT);
    });
  }

  // Wallet batch management
  async createWalletBatch(userId: number, name: string, description?: string): Promise<WalletBatch> {
    const batchId = this.generateBatchId(userId, 'batch');

    const batch: WalletBatch = {
      id: batchId,
      name,
      wallets: [],
      userId,
      createdAt: new Date(),
      lastUpdated: new Date(),
      isActive: true,
      description
    };

    await this.saveWalletBatch(batch);
    return batch;
  }

  async addWalletsToBatch(batchId: string, wallets: string[]): Promise<WalletBatch> {
    const batch = await this.getWalletBatch(batchId);
    if (!batch) {
      throw new Error('Batch not found');
    }

    const validWallets = this.validateWallets(wallets);
    const duplicateWallets = validWallets.filter(wallet => batch.wallets.includes(wallet));
    const newWallets = validWallets.filter(wallet => !batch.wallets.includes(wallet));

    batch.wallets.push(...newWallets);
    batch.lastUpdated = new Date();

    await this.saveWalletBatch(batch);

    this.logger.info('Added wallets to batch', {
      batchId,
      addedCount: newWallets.length,
      duplicateCount: duplicateWallets.length,
      totalWallets: batch.wallets.length
    });

    return batch;
  }

  async trackBatch(userId: number, batchId: string, options?: {
    aliases?: Record<string, string>;
    group?: string;
  }): Promise<BatchResult> {
    const batch = await this.getWalletBatch(batchId);
    if (!batch || batch.userId !== userId) {
      throw new Error('Batch not found or access denied');
    }

    return this.executeBatchOperation({
      operation: 'track',
      wallets: batch.wallets,
      userId,
      telegramId: userId,
      options
    });
  }

  async getUserBatches(userId: number): Promise<WalletBatch[]> {
    return this.getWalletBatchesByUser(userId);
  }

  async deleteBatch(userId: number, batchId: string): Promise<void> {
    const batch = await this.getWalletBatch(batchId);
    if (!batch || batch.userId !== userId) {
      throw new Error('Batch not found or access denied');
    }

    await this.removeWalletBatch(batchId);

    this.logger.info('Deleted wallet batch', {
      userId,
      batchId,
      walletCount: batch.wallets.length
    });
  }

  // Batch analytics
  async getBatchAnalytics(userId: number): Promise<{
    totalBatches: number;
    totalWallets: number;
    activeBatches: number;
    averageWalletsPerBatch: number;
    mostRecentBatch?: WalletBatch;
  }> {
    const batches = await this.getUserBatches(userId);
    const activeBatches = batches.filter(batch => batch.isActive);
    const totalWallets = batches.reduce((sum, batch) => sum + batch.wallets.length, 0);
    const averageWalletsPerBatch = batches.length > 0 ? totalWallets / batches.length : 0;

    const mostRecentBatch = batches
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())[0];

    return {
      totalBatches: batches.length,
      totalWallets,
      activeBatches: activeBatches.length,
      averageWalletsPerBatch,
      mostRecentBatch
    };
  }

  // Database operations (would integrate with existing database service)
  private async saveWalletBatch(batch: WalletBatch): Promise<void> {
    // Implementation would save to database
  }

  private async getWalletBatch(batchId: string): Promise<WalletBatch | null> {
    // Implementation would retrieve from database
    return null;
  }

  private async getWalletBatchesByUser(userId: number): Promise<WalletBatch[]> {
    // Implementation would retrieve user's batches
    return [];
  }

  private async removeWalletBatch(batchId: string): Promise<void> {
    // Implementation would remove from database
  }

  // Utility methods for command processing
  parseWalletAddresses(text: string): string[] {
    // Extract Ethereum addresses from text
    const addressRegex = /0x[a-fA-F0-9]{40}/gi;
    const matches = text.match(addressRegex) || [];
    return [...new Set(matches)]; // Remove duplicates
  }

  validateBatchSize(wallets: string[]): { valid: boolean; error?: string } {
    if (wallets.length === 0) {
      return { valid: false, error: 'No wallet addresses provided' };
    }

    if (wallets.length > this.MAX_BATCH_SIZE) {
      return {
        valid: false,
        error: `Maximum ${this.MAX_BATCH_SIZE} wallets allowed per batch`
      };
    }

    return { valid: true };
  }

  generateBatchSummary(result: BatchResult): string {
    const successRate = ((result.successful / result.total) * 100).toFixed(1);
    const duration = (result.summary.duration / 1000).toFixed(1);

    let summary = `📊 Batch Operation Summary:\n\n`;
    summary += `✅ Successful: ${result.successful}\n`;
    summary += `❌ Failed: ${result.failed}\n`;
    summary += `📈 Success Rate: ${successRate}%\n`;
    summary += `⏱️ Duration: ${duration}s\n\n`;

    if (result.failed > 0) {
      summary += `❌ Failed Operations:\n`;
      const failures = result.results.filter(r => !r.success).slice(0, 5);
      for (const failure of failures) {
        summary += `• ${failure.wallet.slice(0, 8)}...${failure.wallet.slice(-6)}: ${failure.error}\n`;
      }
      if (result.failed > 5) {
        summary += `... and ${result.failed - 5} more\n`;
      }
    }

    return summary;
  }
}