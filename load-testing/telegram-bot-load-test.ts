#!/usr/bin/env node

import { EventEmitter } from 'events';
import { createServer, Server } from 'http';
import { performance } from 'perf_hooks';
import { Telegraf } from 'telegraf';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';

interface LoadTestConfig {
  botToken: string;
  redisUrl: string;
  maxUsers: number;
  duration: number; // in seconds
  rampUpTime: number; // in seconds
  requestsPerSecond: number;
  maxConcurrentConnections: number;
  performanceTargets: {
    responseTimeMs: number;
    deliveryTimeMs: number;
    errorRatePercent: number;
  };
}

interface LoadTestMetrics {
  startTime: number;
  endTime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  responseTimes: number[];
  deliveryTimes: number[];
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  errors: Error[];
  users: number;
}

interface VirtualUser {
  id: number;
  userId: number;
  telegramChatId: number;
  isActive: boolean;
  requestQueue: (() => Promise<void>)[];
  metrics: {
    requestsSent: number;
    requestsCompleted: number;
    requestsFailed: number;
    responseTimes: number[];
    lastActivity: number;
  };
}

class TelegramBotLoadTest extends EventEmitter {
  private config: LoadTestConfig;
  private metrics: LoadTestMetrics;
  private virtualUsers: Map<number, VirtualUser>;
  private bot: Telegraf;
  private redis: Redis;
  private server: Server;
  private webSocketClient: WebSocket;
  private isRunning: boolean = false;
  private testInterval: NodeJS.Timeout | null = null;

  private stopLoadTest() {
    this.isRunning = false;
    this.metrics.endTime = Date.now();
    this.calculateFinalMetrics();
    this.generateReport();
    console.log('Load test completed!');
  }

  private calculateFinalMetrics() {
    // Calculate final metrics
    this.metrics.memoryUsage = process.memoryUsage();
    this.metrics.cpuUsage = process.cpuUsage(this.metrics.cpuUsage);
  }

  private generateReport() {
    const duration = (this.metrics.endTime - this.metrics.startTime) / 1000;
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length
      : 0;
    const avgDeliveryTime = this.metrics.deliveryTimes.length > 0
      ? this.metrics.deliveryTimes.reduce((a, b) => a + b, 0) / this.metrics.deliveryTimes.length
      : 0;
    const successRate = this.metrics.totalRequests > 0
      ? (this.metrics.successfulRequests / this.metrics.totalRequests) * 100
      : 0;
    const errorRate = 100 - successRate;
    const requestsPerSecond = this.metrics.totalRequests / duration;

    console.log('='.repeat(50));
    console.log('📊 LOAD TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`Duration: ${duration.toFixed(2)} seconds`);
    console.log(`Total Requests: ${this.metrics.totalRequests}`);
    console.log(`Successful Requests: ${this.metrics.successfulRequests}`);
    console.log(`Failed Requests: ${this.metrics.failedRequests}`);
    console.log(`Requests/Second: ${requestsPerSecond.toFixed(2)}`);
    console.log('');
    console.log('⏱️ Performance Metrics:');
    console.log(`Average Response Time: ${avgResponseTime.toFixed(2)}ms ${avgResponseTime <= this.config.performanceTargets.responseTimeMs ? '✓' : '✗'}`);
    console.log(`Target Response Time: ${this.config.performanceTargets.responseTimeMs}ms`);
    console.log(`Average Delivery Time: ${avgDeliveryTime.toFixed(2)}ms ${avgDeliveryTime <= this.config.performanceTargets.deliveryTimeMs ? '✓' : '✗'}`);
    console.log(`Target Delivery Time: ${this.config.performanceTargets.deliveryTimeMs}ms`);
    console.log('');
    console.log('📈 Success Metrics:');
    console.log(`Success Rate: ${successRate.toFixed(2)}%`);
    console.log(`Error Rate: ${errorRate.toFixed(2)}% ${errorRate <= this.config.performanceTargets.errorRatePercent ? '✓' : '✗'}`);
    console.log('');
    console.log('💾 Memory Usage:');
    console.log(`Heap Used: ${(this.metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap Total: ${(this.metrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`External: ${(this.metrics.memoryUsage.external / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
    console.log('📈 Recommendations:');
    if (avgResponseTime > this.config.performanceTargets.responseTimeMs) {
      console.log('⚠️ Response time exceeds target. Consider optimizing database queries or caching.');
    }
    if (avgDeliveryTime > this.config.performanceTargets.deliveryTimeMs) {
      console.log('⚠️ Notification delivery time exceeds target. Consider optimizing WebSocket handling.');
    }
    if (errorRate > this.config.performanceTargets.errorRatePercent) {
      console.log('⚠️ Error rate exceeds target. Check error logs and improve error handling.');
    }
    if (requestsPerSecond < this.config.requestsPerSecond) {
      console.log('⚠️ Request throughput is lower than expected. Consider scaling infrastructure.');
    }
    console.log('='.repeat(50));
  }

  constructor(config: LoadTestConfig) {
    super();
    this.config = config;
    this.metrics = {
      startTime: 0,
      endTime: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      deliveryTimes: [],
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      errors: [],
      users: 0,
    };
    this.virtualUsers = new Map();
    this.bot = new Telegraf(config.botToken);
    this.redis = new Redis(config.redisUrl);
    this.server = createServer();
    this.webSocketClient = new WebSocket('wss://api.polymarket.com/ws');

    this.setupBotHandlers();
    this.setupWebSocketHandlers();
    this.setupServerHandlers();
  }

  private setupBotHandlers() {
    // Mock bot handlers for testing
    this.bot.on('text', (ctx) => {
      const startTime = performance.now();

      // Simulate command processing
      const command = ctx.message.text;

      switch (command) {
        case '/start':
          this.handleStartCommand(ctx, startTime);
          break;
        case '/track':
          this.handleTrackCommand(ctx, startTime);
          break;
        case '/untrack':
          this.handleUntrackCommand(ctx, startTime);
          break;
        case '/list':
          this.handleListCommand(ctx, startTime);
          break;
        case '/balance':
          this.handleBalanceCommand(ctx, startTime);
          break;
        case '/history':
          this.handleHistoryCommand(ctx, startTime);
          break;
        case '/help':
          this.handleHelpCommand(ctx, startTime);
          break;
        default:
          this.handleUnknownCommand(ctx, startTime);
      }
    });

    this.bot.on('callback_query', (ctx) => {
      const startTime = performance.now();
      this.handleCallbackQuery(ctx, startTime);
    });
  }

  private setupWebSocketHandlers() {
    this.webSocketClient.on('open', () => {
      console.log('WebSocket connection established');
    });

    this.webSocketClient.on('message', (data) => {
      // Simulate WebSocket message processing
      const message = JSON.parse(data.toString());
      this.handleWebSocketMessage(message);
    });

    this.webSocketClient.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    this.webSocketClient.on('close', () => {
      console.log('WebSocket connection closed');
    });
  }

  private setupServerHandlers() {
    this.server.on('request', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    });
  }

  private async handleStartCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

      const response = {
        message: 'Welcome to PolyBot! 🤖',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔍 Track Wallet', callback_data: 'track_wallet' },
              { text: '📊 My Wallets', callback_data: 'list_wallets' },
            ],
            [
              { text: '⚙️ Preferences', callback_data: 'preferences' },
              { text: '💰 Balance', callback_data: 'balance' },
            ],
            [
              { text: '📜 Help', callback_data: 'help' },
            ],
          ],
        },
      };

      await ctx.reply('Welcome to PolyBot! 🤖', response);

      this.recordResponseTime(responseTime, 'start');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleTrackCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));

      const response = {
        message: 'Please enter the wallet address you want to track:',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Confirm Tracking', callback_data: 'confirm_track' },
              { text: '❌ Cancel', callback_data: 'cancel_track' },
            ],
          ],
        },
      };

      await ctx.reply('Please enter the wallet address you want to track:', response);

      this.recordResponseTime(responseTime, 'track');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleUntrackCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 75));

      const response = {
        message: 'Select the wallet you want to stop tracking:',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔴 Stop Tracking', callback_data: 'confirm_untrack' },
              { text: '❌ Cancel', callback_data: 'cancel_untrack' },
            ],
          ],
        },
      };

      await ctx.reply('Select the wallet you want to stop tracking:', response);

      this.recordResponseTime(responseTime, 'untrack');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleListCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

      const response = {
        message: 'Your tracked wallets:\n\n1. 0x1234...5678 (Ethereum)\n2. 0xabcd...efgh (BSC)\n\nTotal: 2 wallets',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'refresh_list' },
              { text: '➕ Add Wallet', callback_data: 'add_wallet' },
            ],
          ],
        },
      };

      await ctx.reply('Your tracked wallets:\n\n1. 0x1234...5678 (Ethereum)\n2. 0xabcd...efgh (BSC)\n\nTotal: 2 wallets', response);

      this.recordResponseTime(responseTime, 'list');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleBalanceCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 150));

      const response = {
        message: '💰 Your Wallet Balances:\n\nEthereum: $12,345.67\nBSC: $5,678.90\n\nTotal: $18,024.57',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📊 Detailed View', callback_data: 'detailed_balance' },
              { text: '📈 History', callback_data: 'balance_history' },
            ],
          ],
        },
      };

      await ctx.reply('💰 Your Wallet Balances:\n\nEthereum: $12,345.67\nBSC: $5,678.90\n\nTotal: $18,024.57', response);

      this.recordResponseTime(responseTime, 'balance');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleHistoryCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 200));

      const response = {
        message: '📜 Recent Transactions:\n\n1. 📤 $5,000 → 0x1234... (5 min ago)\n2. 📥 $2,500 ← 0xabcd... (1 hour ago)\n3. 🔄 $1,000 Swap (2 hours ago)',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⬅️ Previous', callback_data: 'history_prev' },
              { text: '➡️ Next', callback_data: 'history_next' },
            ],
            [
              { text: '📊 Export CSV', callback_data: 'export_csv' },
            ],
          ],
        },
      };

      await ctx.reply('📜 Recent Transactions:\n\n1. 📤 $5,000 → 0x1234... (5 min ago)\n2. 📥 $2,500 ← 0xabcd... (1 hour ago)\n3. 🔄 $1,000 Swap (2 hours ago)', response);

      this.recordResponseTime(responseTime, 'history');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleHelpCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 75));

      const response = {
        message: '📚 Help & Commands:\n\n/start - Start using PolyBot\n/track - Track a wallet address\n/untrack - Stop tracking a wallet\n/list - View your tracked wallets\n/balance - Check your wallet balances\n/history - View transaction history\n/preferences - Configure notifications\n/help - Show this help message',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔍 Support Chat', callback_data: 'support_chat' },
              { text: '📞 Contact Admin', callback_data: 'contact_admin' },
            ],
          ],
        },
      };

      await ctx.reply('📚 Help & Commands:\n\n/start - Start using PolyBot\n/track - Track a wallet address\n/untrack - Stop tracking a wallet\n/list - View your tracked wallets\n/balance - Check your wallet balances\n/history - View transaction history\n/preferences - Configure notifications\n/help - Show this help message', response);

      this.recordResponseTime(responseTime, 'help');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleUnknownCommand(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      await ctx.reply('Unknown command. Type /help to see available commands.');

      this.recordResponseTime(responseTime, 'unknown');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.reply('Sorry, there was an error processing your request.');
    }
  }

  private async handleCallbackQuery(ctx: any, startTime: number) {
    try {
      const responseTime = performance.now() - startTime;

      // Simulate callback processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 25));

      await ctx.answerCbQuery(`Processed: ${ctx.callbackQuery.data}`);

      this.recordResponseTime(responseTime, 'callback');
      this.recordSuccess();
    } catch (error) {
      this.recordError(error);
      await ctx.answerCbQuery('Error processing callback');
    }
  }

  private async handleWebSocketMessage(message: any) {
    try {
      // Simulate notification processing
      const startTime = performance.now();

      // Simulate notification delivery
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

      const deliveryTime = performance.now() - startTime;

      // Record delivery time
      this.metrics.deliveryTimes.push(deliveryTime);

      // Check if delivery time exceeds target
      if (deliveryTime > this.config.performanceTargets.deliveryTimeMs) {
        console.warn(`Slow notification delivery: ${deliveryTime}ms`);
      }
    } catch (error) {
      this.recordError(error);
    }
  }

  private recordResponseTime(responseTime: number, commandType: string) {
    this.metrics.responseTimes.push(responseTime);
    this.metrics.totalRequests++;

    // Check if response time exceeds target
    if (responseTime > this.config.performanceTargets.responseTimeMs) {
      console.warn(`Slow response for ${commandType}: ${responseTime}ms`);
    }
  }

  private recordSuccess() {
    this.metrics.successfulRequests++;
  }

  private recordError(error: any) {
    this.metrics.failedRequests++;
    this.metrics.errors.push(error);
    console.error('Error:', error);
  }

  private createVirtualUser(id: number): VirtualUser {
    return {
      id,
      userId: id + 1000000, // Generate unique user IDs
      telegramChatId: id + 2000000,
      isActive: false,
      requestQueue: [],
      metrics: {
        requestsSent: 0,
        requestsCompleted: 0,
        requestsFailed: 0,
        responseTimes: [],
        lastActivity: Date.now(),
      },
    };
  }

  private async startRampUp() {
    const rampUpInterval = this.config.rampUpTime * 1000 / this.config.maxUsers;
    let usersCreated = 0;

    const rampUpIntervalId = setInterval(() => {
      if (usersCreated >= this.config.maxUsers) {
        clearInterval(rampUpIntervalId);
        this.startLoadTest();
        return;
      }

      const virtualUser = this.createVirtualUser(usersCreated);
      this.virtualUsers.set(usersCreated, virtualUser);
      usersCreated++;

      console.log(`Created virtual user ${usersCreated}/${this.config.maxUsers}`);
    }, rampUpInterval);
  }

  private async startLoadTest() {
    console.log(`Starting load test with ${this.config.maxUsers} users`);
    this.isRunning = true;

    // Start generating load
    this.testInterval = setInterval(() => {
      if (!this.isRunning) return;

      this.generateLoad();
    }, 1000 / this.config.requestsPerSecond);

    // Run for the specified duration
    setTimeout(() => {
      this.stopLoadTest();
    }, this.config.duration * 1000);
  }

  private async generateLoad() {
    const availableUsers = Array.from(this.virtualUsers.values()).filter(u => !u.isActive);

    if (availableUsers.length === 0) return;

    // Select random users to send requests
    const usersToSend = Math.min(
      this.config.requestsPerSecond,
      availableUsers.length,
      this.config.maxConcurrentConnections - this.virtualUsers.size + availableUsers.length
    );

    for (let i = 0; i < usersToSend; i++) {
      const randomUser = availableUsers[Math.floor(Math.random() * availableUsers.length)];
      if (randomUser) {
        this.sendRequest(randomUser);
      }
    }
  }

  private async sendRequest(user: VirtualUser) {
    user.isActive = true;
    user.metrics.lastActivity = Date.now();

    const commands = ['/start', '/track', '/list', '/balance', '/history', '/help'];
    const randomCommand = commands[Math.floor(Math.random() * commands.length)];

    try {
      const startTime = performance.now();

      // Simulate sending command to Telegram bot
      await this.simulateTelegramCommand(user.telegramChatId, randomCommand);

      const responseTime = performance.now() - startTime;
      user.metrics.responseTimes.push(responseTime);
      user.metrics.requestsSent++;
      user.metrics.requestsCompleted++;

      this.metrics.responseTimes.push(responseTime);
      this.metrics.totalRequests++;
      this.metrics.successfulRequests++;

    } catch (error) {
      user.metrics.requestsFailed++;
      this.metrics.failedRequests++;
      this.metrics.errors.push(error as Error);
    }

    user.isActive = false;
  }

  private async simulateTelegramCommand(chatId: number, command: string): Promise<void> {
    // Simulate Telegram API call
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));

    // Simulate bot response
    await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 100));
  }

  private async startNotificationTest() {
    console.log('Starting notification delivery test...');

    const notificationInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(notificationInterval);
        return;
      }

      this.simulateNotificationDelivery();
    }, 100); // Send notifications every 100ms

    // Run for the same duration as the main test
    setTimeout(() => {
      clearInterval(notificationInterval);
    }, this.config.duration * 1000);
  }

  private async simulateNotificationDelivery() {
    try {
      const startTime = performance.now();

      // Simulate notification processing
      await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 50));

      const deliveryTime = performance.now() - startTime;

      this.metrics.deliveryTimes.push(deliveryTime);

      // Check if delivery time exceeds target
      if (deliveryTime > this.config.performanceTargets.deliveryTimeMs) {
        console.warn(`Slow notification delivery: ${deliveryTime}ms`);
      }
    } catch (error) {
      this.recordError(error);
    }
  }

  public async start(): Promise<void> {
    console.log('Starting Telegram Bot Load Test...');
    console.log('Configuration:', {
      maxUsers: this.config.maxUsers,
      duration: this.config.duration,
      rampUpTime: this.config.rampUpTime,
      requestsPerSecond: this.config.requestsPerSecond,
      maxConcurrentConnections: this.config.maxConcurrentConnections,
    });

    this.metrics.startTime = performance.now();
    this.metrics.users = this.config.maxUsers;

    // Start the bot
    await this.bot.launch();
    console.log('Telegram bot started');

    // Start the server
    this.server.listen(3001);
    console.log('Test server started on port 3001');

    // Start WebSocket connection
    if (this.webSocketClient.readyState === WebSocket.CONNECTING || this.webSocketClient.readyState === WebSocket.CLOSED) {
      (this.webSocketClient as any).connect();
    }
    console.log('WebSocket client connecting...');

    // Start ramp-up phase
    await this.startRampUp();

    // Start notification test
    this.startNotificationTest();
  }

  public async stop(): Promise<void> {
    console.log('Stopping load test...');

    this.isRunning = false;

    if (this.testInterval) {
      clearInterval(this.testInterval);
    }

    this.metrics.endTime = performance.now();

    // Stop the bot
    await this.bot.stop();
    console.log('Telegram bot stopped');

    // Stop the server
    this.server.close();
    console.log('Test server stopped');

    // Close WebSocket connection
    this.webSocketClient.close();
    console.log('WebSocket client closed');

    // Generate and display report
    this.generateReport();
  }

  public getMetrics(): LoadTestMetrics {
    return { ...this.metrics };
  }
}

// Configuration for the load test
const config: LoadTestConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || 'test-token',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  maxUsers: parseInt(process.env.MAX_USERS || '1000', 10),
  duration: parseInt(process.env.DURATION || '300', 10), // 5 minutes
  rampUpTime: parseInt(process.env.RAMP_UP_TIME || '60', 10), // 1 minute
  requestsPerSecond: parseInt(process.env.REQUESTS_PER_SECOND || '10', 10),
  maxConcurrentConnections: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS || '100', 10),
  performanceTargets: {
    responseTimeMs: parseInt(process.env.RESPONSE_TIME_TARGET || '500', 10), // 500ms
    deliveryTimeMs: parseInt(process.env.DELIVERY_TIME_TARGET || '200', 10), // 200ms
    errorRatePercent: parseFloat(process.env.ERROR_RATE_TARGET || '1.0'), // 1%
  },
};

// Run the load test
async function main() {
  console.log('🚀 Starting Telegram Bot Load Test');
  console.log('Configuration:', JSON.stringify(config, null, 2));

  const loadTest = new TelegramBotLoadTest(config);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await loadTest.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await loadTest.stop();
    process.exit(0);
  });

  try {
    await loadTest.start();

    // Auto-stop after duration
    setTimeout(async () => {
      await loadTest.stop();
      process.exit(0);
    }, config.duration * 1000);

  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

// Export for external use
export { TelegramBotLoadTest, LoadTestConfig, LoadTestMetrics };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}