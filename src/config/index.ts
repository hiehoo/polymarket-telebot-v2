import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

interface Config {
  telegram: {
    botToken: string;
  };
  polymarket: {
    apiKey: string;
    apiUrl: string;
    gammaApiUrl: string;
    dataApiUrl: string;
    wsUrl: string;
  };
  database: {
    url: string;
    redisUrl: string;
  };
  security: {
    jwtSecret: string;
    encryptionKey: string;
  };
  server: {
    nodeEnv: string;
    logLevel: string;
    port: number;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  notifications: {
    batchSize: number;
    delayMs: number;
    minOrderValue: number;
    minPortfolioPercent: number;
  };
  health: {
    checkIntervalMs: number;
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
  };
  consensus: {
    enabled: boolean;
    cronSchedule: string;
    minWallets: number;
    minOrderValue: number;
    minPortfolioPercent: number;
    scanDelayMs: number;
  };
}

const config: Config = {
  telegram: {
    botToken: process.env['TELEGRAM_BOT_TOKEN'] || '',
  },
  polymarket: {
    apiKey: process.env['POLYMARKET_API_KEY'] || '',
    apiUrl: process.env['POLYMARKET_API_URL'] || 'https://clob.polymarket.com',
    gammaApiUrl: process.env['POLYMARKET_GAMMA_API_URL'] || 'https://gamma-api.polymarket.com',
    dataApiUrl: process.env['POLYMARKET_DATA_API_URL'] || 'https://data-api.polymarket.com',
    wsUrl: process.env['POLYMARKET_WS_URL'] || 'wss://ws-subscriptions-clob.polymarket.com/ws',
  },
  database: {
    url: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/polymarket_bot',
    redisUrl: process.env['REDIS_URL'] || 'redis://localhost:6379',
  },
  security: {
    jwtSecret: process.env['JWT_SECRET'] || '',
    encryptionKey: process.env['ENCRYPTION_KEY'] || '',
  },
  server: {
    nodeEnv: process.env['NODE_ENV'] || 'development',
    logLevel: process.env['LOG_LEVEL'] || 'info',
    port: parseInt(process.env['PORT'] || '3000', 10),
  },
  rateLimit: {
    windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '100', 10),
  },
  notifications: {
    batchSize: parseInt(process.env['NOTIFICATION_BATCH_SIZE'] || '50', 10),
    delayMs: parseInt(process.env['NOTIFICATION_DELAY_MS'] || '1000', 10),
    minOrderValue: parseInt(process.env['NOTIFICATION_MIN_ORDER_VALUE'] || '500', 10),
    minPortfolioPercent: parseFloat(process.env['NOTIFICATION_MIN_PORTFOLIO_PERCENT'] || '2'),
  },
  health: {
    checkIntervalMs: parseInt(process.env['HEALTH_CHECK_INTERVAL_MS'] || '30000', 10),
    maxReconnectAttempts: parseInt(process.env['MAX_RECONNECT_ATTEMPTS'] || '5', 10),
    reconnectDelayMs: parseInt(process.env['RECONNECT_DELAY_MS'] || '5000', 10),
  },
  consensus: {
    enabled: process.env['CONSENSUS_ENABLED'] !== 'false',
    cronSchedule: process.env['CONSENSUS_CRON_SCHEDULE'] || '0 6 * * *', // 6 AM daily
    minWallets: parseInt(process.env['CONSENSUS_MIN_WALLETS'] || '3', 10),
    minOrderValue: parseInt(process.env['CONSENSUS_MIN_ORDER_VALUE'] || '2000', 10),
    minPortfolioPercent: parseFloat(process.env['CONSENSUS_MIN_PORTFOLIO_PERCENT'] || '2'),
    scanDelayMs: parseInt(process.env['CONSENSUS_SCAN_DELAY_MS'] || '1000', 10),
  },
};

// Validate required environment variables
function validateConfig(): void {
  const requiredVars = [
    'TELEGRAM_BOT_TOKEN',
    'POLYMARKET_API_KEY',
    'DATABASE_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

export { config, validateConfig };
export type { Config };