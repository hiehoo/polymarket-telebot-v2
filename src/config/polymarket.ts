import { config } from './index';
import {
  DataProcessingConfig,
  WebSocketClientConfig,
  RestClientConfig
} from '@/types/data-processing';

export const polymarketDataProcessingConfig: DataProcessingConfig = {
  batchSize: parseInt(process.env['POLYMARKET_BATCH_SIZE'] || '100', 10),
  processingInterval: parseInt(process.env['POLYMARKET_PROCESSING_INTERVAL'] || '1000', 10),
  maxRetries: parseInt(process.env['POLYMARKET_MAX_RETRIES'] || '3', 10),
  retryDelay: parseInt(process.env['POLYMARKET_RETRY_DELAY'] || '2000', 10),
  bufferSize: parseInt(process.env['POLYMARKET_BUFFER_SIZE'] || '10000', 10),
  healthCheckInterval: parseInt(process.env['POLYMARKET_HEALTH_CHECK_INTERVAL'] || '30000', 10),
  metricsInterval: parseInt(process.env['POLYMARKET_METRICS_INTERVAL'] || '60000', 10),
};

export const polymarketWebSocketConfig: WebSocketClientConfig = {
  url: config.polymarket.wsUrl,
  apiKey: config.polymarket.apiKey,
  reconnectAttempts: parseInt(process.env['POLYMARKET_WS_RECONNECT_ATTEMPTS'] || '10', 10),
  reconnectDelay: parseInt(process.env['POLYMARKET_WS_RECONNECT_DELAY'] || '5000', 10),
  heartbeatInterval: parseInt(process.env['POLYMARKET_WS_HEARTBEAT_INTERVAL'] || '30000', 10),
  messageTimeout: parseInt(process.env['POLYMARKET_WS_MESSAGE_TIMEOUT'] || '60000', 10),
  subscriptions: [
    'market_data',
    'transactions',
    'positions',
    'resolutions',
    'price_updates'
  ],
  compression: process.env['POLYMARKET_WS_COMPRESSION'] !== 'false',
};

export const polymarketRestConfig: RestClientConfig = {
  baseUrl: config.polymarket.apiUrl,
  apiKey: config.polymarket.apiKey,
  timeout: parseInt(process.env['POLYMARKET_API_TIMEOUT'] || '30000', 10),
  maxRetries: parseInt(process.env['POLYMARKET_API_MAX_RETRIES'] || '3', 10),
  retryDelay: parseInt(process.env['POLYMARKET_API_RETRY_DELAY'] || '1000', 10),
  rateLimit: {
    requestsPerSecond: parseInt(process.env['POLYMARKET_API_RPS'] || '10', 10),
    burstLimit: parseInt(process.env['POLYMARKET_API_BURST_LIMIT'] || '50', 10),
  },
  cache: {
    enabled: process.env['POLYMARKET_API_CACHE_ENABLED'] !== 'false',
    ttl: parseInt(process.env['POLYMARKET_API_CACHE_TTL'] || '300', 10), // 5 minutes
    maxSize: parseInt(process.env['POLYMARKET_API_CACHE_MAX_SIZE'] || '1000', 10),
  },
};

export const polymarketEventFilters = {
  marketData: {
    priceChangeThreshold: parseFloat(process.env['POLYMARKET_PRICE_CHANGE_THRESHOLD'] || '0.05'), // 5%
    volumeSpikeMultiplier: parseFloat(process.env['POLYMARKET_VOLUME_SPIKE_MULTIPLIER'] || '2.0'),
    minMarketCap: parseFloat(process.env['POLYMARKET_MIN_MARKET_CAP'] || '1000'), // $1000
    maxPriceUpdateAge: parseInt(process.env['POLYMARKET_MAX_PRICE_UPDATE_AGE'] || '300', 10), // 5 minutes
  },
  transactions: {
    minAmount: parseFloat(process.env['POLYMARKET_MIN_TX_AMOUNT'] || '10'), // $10
    highValueThreshold: parseFloat(process.env['POLYMARKET_HIGH_VALUE_THRESHOLD'] || '1000'), // $1000
    excludeWallets: (process.env['POLYMARKET_EXCLUDE_WALLETS'] || '').split(',').filter(Boolean),
    includeWallets: (process.env['POLYMARKET_INCLUDE_WALLETS'] || '').split(',').filter(Boolean),
  },
  positions: {
    minSize: parseFloat(process.env['POLYMARKET_MIN_POSITION_SIZE'] || '10'), // $10
    pnlThreshold: parseFloat(process.env['POLYMARKET_PNL_THRESHOLD'] || '100'), // $100
    trackNewPositions: process.env['POLYMARKET_TRACK_NEW_POSITIONS'] !== 'false',
    trackClosures: process.env['POLYMARKET_TRACK_CLOSURES'] !== 'false',
  },
  resolutions: {
    autoNotify: process.env['POLYMARKET_AUTO_NOTIFY_RESOLUTIONS'] !== 'false',
    includeExpiredMarkets: process.env['POLYMARKET_INCLUDE_EXPIRED_MARKETS'] === 'true',
    resolutionDelayMinutes: parseInt(process.env['POLYMARKET_RESOLUTION_DELAY_MINUTES'] || '5', 10),
  },
};

export const polymarketWebSocketChannels = {
  marketData: {
    channel: 'market_data',
    filters: {
      eventTypes: ['PRICE_UPDATE', 'VOLUME_UPDATE', 'LIQUIDITY_UPDATE'],
      minVolume: polymarketEventFilters.marketData.minMarketCap,
    },
    subscribe: true,
  },
  transactions: {
    channel: 'transactions',
    filters: {
      eventTypes: ['BUY', 'SELL', 'CANCEL'],
      minAmount: polymarketEventFilters.transactions.minAmount,
      excludeWallets: polymarketEventFilters.transactions.excludeWallets,
      includeWallets: polymarketEventFilters.transactions.includeWallets,
    },
    subscribe: true,
  },
  positions: {
    channel: 'positions',
    filters: {
      eventTypes: ['OPEN', 'CLOSE', 'UPDATE'],
      minSize: polymarketEventFilters.positions.minSize,
    },
    subscribe: true,
  },
  resolutions: {
    channel: 'resolutions',
    filters: {
      eventTypes: ['RESOLVED', 'CANCELLED'],
      includeExpired: polymarketEventFilters.resolutions.includeExpiredMarkets,
    },
    subscribe: true,
  },
};

export const polymarketApiEndpoints = {
  // CLOB API endpoints (clob.polymarket.com)
  markets: '/markets',
  orders: '/orders',
  trades: '/trades',
  orderbook: '/book',
  positions: '/positions',

  // Legacy endpoints mapped to CLOB API
  conditions: '/markets', // Map to markets endpoint
  marketData: '/markets',
  priceHistory: '/prices',
  orderBook: '/book',

  // User data endpoints
  transactions: '/trades',
  portfolio: '/portfolio',

  // System endpoints
  health: '/health',
  status: '/status',
  rateLimit: '/rate-limit',

  // Search endpoints
  search: '/search',
  trending: '/trending',
  categories: '/categories',
};

// Gamma API endpoints (gamma-api.polymarket.com)
export const polymarketGammaEndpoints = {
  events: '/events',
  markets: '/markets',
  search: '/search',
};

// Data API endpoints (data-api.polymarket.com)
export const polymarketDataEndpoints = {
  positions: '/positions',
  trades: '/trades',
  markets: '/markets',
  events: '/events',
  analytics: '/analytics',
};

export const polymarketApiParams = {
  default: {
    limit: 100,
    offset: 0,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  },
  marketData: {
    interval: '1m',
    includeHistory: true,
    includeOrderBook: false,
  },
  transactions: {
    types: ['BUY', 'SELL'],
    includeFees: true,
    includeMetadata: true,
  },
  positions: {
    includeSettled: false,
    includePnl: true,
    includeMarketData: true,
  },
};

export const polymarketRetryPolicy = {
  networkErrors: {
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
  },
  rateLimitErrors: {
    maxRetries: 3,
    baseDelay: 5000,
    maxDelay: 60000,
    backoffMultiplier: 1.5,
    jitter: true,
  },
  serverErrors: {
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitter: false,
  },
};

export const polymarketCacheConfig = {
  marketData: {
    ttl: 60, // 1 minute
    maxSize: 500,
    tags: ['market-data', 'prices'],
  },
  conditions: {
    ttl: 300, // 5 minutes
    maxSize: 1000,
    tags: ['conditions', 'markets'],
  },
  userPositions: {
    ttl: 120, // 2 minutes
    maxSize: 200,
    tags: ['positions', 'user-data'],
  },
  transactions: {
    ttl: 1800, // 30 minutes
    maxSize: 1000,
    tags: ['transactions', 'historical'],
  },
  resolutions: {
    ttl: 86400, // 24 hours
    maxSize: 100,
    tags: ['resolutions', 'final'],
  },
};

export const polymarketNotificationRules = {
  priceChange: {
    enabled: process.env['POLYMARKET_NOTIFY_PRICE_CHANGES'] !== 'false',
    threshold: polymarketEventFilters.marketData.priceChangeThreshold,
    cooldownMinutes: parseInt(process.env['POLYMARKET_PRICE_CHANGE_COOLDOWN'] || '15', 10),
  },
  highValueTransactions: {
    enabled: process.env['POLYMARKET_NOTIFY_HIGH_VALUE_TX'] !== 'false',
    threshold: polymarketEventFilters.transactions.highValueThreshold,
    excludeKnownWhales: process.env['POLYMARKET_EXCLUDE_KNOWN_WHALES'] === 'true',
  },
  positionUpdates: {
    enabled: process.env['POLYMARKET_NOTIFY_POSITION_UPDATES'] !== 'false',
    pnlThreshold: polymarketEventFilters.positions.pnlThreshold,
    notifyClosures: polymarketEventFilters.positions.trackClosures,
  },
  marketResolutions: {
    enabled: polymarketEventFilters.resolutions.autoNotify,
    delayMinutes: polymarketEventFilters.resolutions.resolutionDelayMinutes,
    includeCancelled: false,
  },
  volumeSpikes: {
    enabled: process.env['POLYMARKET_NOTIFY_VOLUME_SPIKES'] !== 'false',
    multiplier: polymarketEventFilters.marketData.volumeSpikeMultiplier,
    minVolume: polymarketEventFilters.marketData.minMarketCap,
    cooldownMinutes: parseInt(process.env['POLYMARKET_VOLUME_SPIKE_COOLDOWN'] || '30', 10),
  },
};

export const polymarketMonitoringConfig = {
  metrics: {
    enabled: process.env['POLYMARKET_METRICS_ENABLED'] !== 'false',
    interval: polymarketDataProcessingConfig.metricsInterval,
    retentionDays: parseInt(process.env['POLYMARKET_METRICS_RETENTION_DAYS'] || '7', 10),
  },
  alerts: {
    enabled: process.env['POLYMARKET_ALERTS_ENABLED'] !== 'false',
    errorThreshold: parseFloat(process.env['POLYMARKET_ERROR_THRESHOLD'] || '0.05'), // 5%
    latencyThreshold: parseInt(process.env['POLYMARKET_LATENCY_THRESHOLD'] || '5000', 10), // 5 seconds
    queueSizeThreshold: parseInt(process.env['POLYMARKET_QUEUE_SIZE_THRESHOLD'] || '1000', 10),
  },
  healthCheck: {
    interval: polymarketDataProcessingConfig.healthCheckInterval,
    timeout: parseInt(process.env['POLYMARKET_HEALTH_CHECK_TIMEOUT'] || '10000', 10),
    retries: parseInt(process.env['POLYMARKET_HEALTH_CHECK_RETRIES'] || '3', 10),
  },
};

export const polymarketDebugConfig = {
  enabled: process.env['POLYMARKET_DEBUG'] === 'true',
  logLevel: process.env['POLYMARKET_LOG_LEVEL'] || 'info',
  logRequests: process.env['POLYMARKET_LOG_REQUESTS'] === 'true',
  logWebSocket: process.env['POLYMARKET_LOG_WS'] === 'true',
  logProcessing: process.env['POLYMARKET_LOG_PROCESSING'] === 'true',
  saveRawMessages: process.env['POLYMARKET_SAVE_RAW_MESSAGES'] === 'true',
  maxRawMessageSize: parseInt(process.env['POLYMARKET_MAX_RAW_MESSAGE_SIZE'] || '1024', 10), // 1KB
};

export function validatePolymarketConfig(): void {
  const requiredVars = [
    'POLYMARKET_API_KEY',
    'POLYMARKET_API_URL',
    'POLYMARKET_WS_URL',
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required Polymarket environment variables: ${missingVars.join(', ')}`);
  }

  // Validate numeric configurations
  const numericConfigs = [
    { name: 'POLYMARKET_BATCH_SIZE', value: polymarketDataProcessingConfig.batchSize, min: 1, max: 1000 },
    { name: 'POLYMARKET_PROCESSING_INTERVAL', value: polymarketDataProcessingConfig.processingInterval, min: 100, max: 60000 },
    { name: 'POLYMARKET_API_TIMEOUT', value: polymarketRestConfig.timeout, min: 1000, max: 300000 },
    { name: 'POLYMARKET_WS_RECONNECT_DELAY', value: polymarketWebSocketConfig.reconnectDelay, min: 1000, max: 60000 },
  ];

  for (const config of numericConfigs) {
    if (config.value < config.min || config.value > config.max) {
      throw new Error(`${config.name} must be between ${config.min} and ${config.max}, got ${config.value}`);
    }
  }

  // Validate URLs
  try {
    new URL(polymarketRestConfig.baseUrl);
    new URL(polymarketWebSocketConfig.url);
  } catch (error) {
    throw new Error(`Invalid Polymarket URL configuration: ${error}`);
  }
}

// Exports are already declared inline above