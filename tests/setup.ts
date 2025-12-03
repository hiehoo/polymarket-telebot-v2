// Mock environment variables for testing
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'error';
process.env['TELEGRAM_BOT_TOKEN'] = 'test-bot-token';
process.env['POLYMARKET_API_KEY'] = 'test-api-key';
process.env['DATABASE_URL'] = 'postgresql://localhost:5432/test_bot';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['JWT_SECRET'] = 'test-jwt-secret';
process.env['ENCRYPTION_KEY'] = 'test-encryption-key';

// Mock configuration for testing
const testConfig = {
  telegram: {
    botToken: process.env['TELEGRAM_BOT_TOKEN'] || '',
  },
  polymarket: {
    apiKey: process.env['POLYMARKET_API_KEY'] || '',
    apiUrl: 'https://api.polymarket.com',
    wsUrl: 'wss://api.polymarket.com/ws',
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
    nodeEnv: 'test',
    logLevel: 'error',
    port: 3000,
  },
  rateLimit: {
    windowMs: 900000,
    maxRequests: 100,
  },
  notifications: {
    batchSize: 50,
    delayMs: 1000,
  },
  health: {
    checkIntervalMs: 30000,
    maxReconnectAttempts: 5,
    reconnectDelayMs: 5000,
  },
};

// Global test utilities
(global as any).testConfig = testConfig;

// Mock console methods to reduce noise in tests
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    !args[0].includes('CONFIG_VALIDATION_ERROR') &&
    !args[0].includes('MISSING_ENV_VARS')
  ) {
    originalConsoleError(...args);
  }
};

// Jest setup
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});