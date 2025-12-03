# PolyBot Code Standards & Architecture Guidelines

**Document Version**: 1.0  
**Last Updated**: 2025-12-02 16:28  
**Phase**: 03 Complete - Telegram Bot Implementation  
**Status**: Enforced & Validated  

## Development Principles

### Core Principles

#### YAGNI (You Aren't Gonna Need It)
- Build minimal viable features
- Avoid speculative implementation
- Add complexity only when needed
- Focus on current requirements

#### KISS (Keep It Simple, Stupid)
- Straightforward implementation patterns
- Avoid over-engineering solutions
- Clear, readable code over clever tricks
- Simple solutions preferred

#### DRY (Don't Repeat Yourself)
- Shared utilities in `/src/utils`
- Common types in `/src/types`
- Reusable middleware components
- Configuration centralization

## File Structure Standards

### Directory Organization
```
src/
├── bot/                    # Telegram Bot Layer
│   ├── handlers/           # Command handlers (50 lines max)
│   ├── middleware/         # Request middleware pipeline
│   ├── keyboards/          # Inline keyboard definitions
│   ├── utils/              # Bot-specific utilities
│   └── *.ts                # Core bot services
├── services/               # Business Logic Layer
│   ├── notifications/      # Notification management
│   ├── polymarket/         # External API integration
│   ├── database/           # Data persistence layer
│   ├── redis/              # Caching and sessions
│   └── *.ts                # Unified services
├── types/                  # TypeScript Definitions
│   ├── telegram.ts         # Telegram API types
│   ├── polymarket.ts       # Market data types
│   ├── database.ts         # Database schema types
│   └── *.ts                # Domain-specific types
├── config/                 # Configuration Layer
│   ├── index.ts            # Main config aggregator
│   └── *.ts                # Service-specific configs
├── utils/                  # Shared Utilities
│   ├── logger.ts           # Structured logging
│   ├── error-handler.ts    # Error management
│   └── helpers.ts          # Common functions
└── advanced/               # Advanced Features
    ├── alerts/             # Alert management
    ├── analytics/          # Data analytics
    ├── batch/              # Batch operations
    └── */                  # Feature-specific modules
```

### File Naming Conventions
- **kebab-case**: All file names (e.g., `user-service.ts`)
- **PascalCase**: Class names and interfaces
- **camelCase**: Functions, variables, and methods
- **SCREAMING_SNAKE_CASE**: Constants and environment variables

### File Size Limits
- **Maximum file length**: 200 lines
- **Maximum function length**: 50 lines
- **Maximum line length**: 100 characters
- **Maximum function parameters**: 5 parameters

## TypeScript Standards

### Configuration Requirements
```json
{
  "compilerOptions": {
    "strict": true,
    "noAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Type Definition Standards

#### Interface Design
```typescript
// ✅ Good: Clear, specific interface
interface TelegramUser {
  id: number;
  username?: string;
  firstName: string;
  lastName?: string;
  isBot: boolean;
}

// ❌ Bad: Vague, overly generic
interface User {
  data: any;
  info: object;
}
```

#### Type Safety Rules
1. **No `any` type**: Use specific types or `unknown`
2. **Explicit return types**: All functions must declare return types
3. **Null safety**: Handle `null` and `undefined` explicitly
4. **Union types**: Use union types instead of `any`

#### Type Organization
```typescript
// Domain-specific types in separate files
// src/types/telegram.ts
export interface TelegramMessage {
  messageId: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
}

// src/types/polymarket.ts
export interface MarketData {
  marketId: string;
  question: string;
  prices: PriceData[];
  volume24h: number;
  liquidity: number;
}
```

## Code Quality Standards

### Function Design

#### Function Length and Complexity
```typescript
// ✅ Good: Single responsibility, clear purpose
async function validateWalletAddress(address: string): Promise<boolean> {
  if (!address || address.length !== 42) {
    return false;
  }
  
  const hexRegex = /^0x[a-fA-F0-9]{40}$/;
  return hexRegex.test(address);
}

// ❌ Bad: Too long, multiple responsibilities
async function processUserCommand(ctx: any): Promise<void> {
  // 100+ lines of mixed logic
}
```

#### Error Handling Patterns
```typescript
// ✅ Good: Explicit error handling
async function getUserBalance(userId: number): Promise<Result<Balance, Error>> {
  try {
    const balance = await balanceService.getBalance(userId);
    return { success: true, data: balance };
  } catch (error) {
    logger.error('Failed to get user balance', { userId, error });
    return { success: false, error };
  }
}

// ❌ Bad: Silent failure
async function getUserBalance(userId: number): Promise<Balance | null> {
  try {
    return await balanceService.getBalance(userId);
  } catch {
    return null; // Lost error context
  }
}
```

### Class Design Standards

#### Single Responsibility Principle
```typescript
// ✅ Good: Single responsibility
class WalletValidator {
  validate(address: string): ValidationResult {
    return this.validateFormat(address);
  }
  
  private validateFormat(address: string): ValidationResult {
    // Validation logic only
  }
}

// ✅ Good: Separate responsibility
class WalletService {
  async addWallet(userId: number, address: string): Promise<void> {
    // Business logic only
  }
}
```

#### Constructor Patterns
```typescript
// ✅ Good: Dependency injection
class NotificationService {
  constructor(
    private readonly bot: Telegraf,
    private readonly templateService: TemplateService,
    private readonly logger: Logger
  ) {}
}

// ❌ Bad: Hard dependencies
class NotificationService {
  private bot = new Telegraf(process.env.BOT_TOKEN!);
  private logger = console; // Hard-coded dependency
}
```

## Security Standards

### Input Validation

#### Command Sanitization
```typescript
// ✅ Good: Comprehensive validation
class CommandSanitizer {
  static sanitizeWalletAddress(input: string): string {
    // Remove dangerous characters
    const cleaned = input.replace(/[<>"'&]/g, '');
    
    // Validate format
    if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) {
      throw new ValidationError('Invalid wallet address format');
    }
    
    return cleaned;
  }
}
```

#### SQL Injection Prevention
```typescript
// ✅ Good: Parameterized queries
async function getUserWallets(userId: number): Promise<Wallet[]> {
  const query = 'SELECT * FROM wallets WHERE user_id = $1';
  return await db.query(query, [userId]);
}

// ❌ Bad: String concatenation
async function getUserWallets(userId: number): Promise<Wallet[]> {
  const query = `SELECT * FROM wallets WHERE user_id = ${userId}`;
  return await db.query(query);
}
```

#### XSS Prevention
```typescript
// ✅ Good: Template escaping
class MessageTemplate {
  static formatBalance(balance: number, symbol: string): string {
    // Escape user input
    const escapedSymbol = this.escapeHtml(symbol);
    return `Balance: ${balance.toFixed(2)} ${escapedSymbol}`;
  }
  
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
```

### Authentication & Authorization

#### Session Management
```typescript
// ✅ Good: Secure session handling
interface SecureSession {
  userId: number;
  createdAt: number;
  lastActivity: number;
  permissions: string[];
  encrypted: boolean;
}

class SessionManager {
  async createSession(userId: number): Promise<string> {
    const session: SecureSession = {
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      permissions: await this.getUserPermissions(userId),
      encrypted: true
    };
    
    return this.encryptSession(session);
  }
}
```

## Performance Standards

### Response Time Requirements
- **Command Processing**: <200ms average
- **Database Queries**: <50ms average
- **API Calls**: <300ms average with retry
- **Cache Operations**: <10ms average

### Memory Management
```typescript
// ✅ Good: Resource cleanup
class WebSocketManager {
  private connections = new Map<string, WebSocket>();
  
  async cleanup(): Promise<void> {
    for (const [id, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    this.connections.clear();
  }
}

// ✅ Good: Connection pooling
class DatabaseService {
  private pool = new Pool({
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000
  });
}
```

### Caching Strategy
```typescript
// ✅ Good: TTL-based caching
class CacheManager {
  async getMarketData(marketId: string): Promise<MarketData> {
    const cacheKey = `market:${marketId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    const data = await this.polymarketApi.getMarket(marketId);
    await this.redis.setex(cacheKey, 300, JSON.stringify(data)); // 5min TTL
    
    return data;
  }
}
```

## Testing Standards

### Test Organization
```
__tests__/
├── unit/                   # Unit tests for individual functions
├── integration/            # Integration tests for components
├── e2e/                    # End-to-end workflow tests
└── fixtures/               # Test data and mocks
```

### Test Writing Standards

#### Unit Test Structure
```typescript
// ✅ Good: AAA pattern (Arrange, Act, Assert)
describe('WalletValidator', () => {
  describe('validate', () => {
    it('should return valid for correct Ethereum address', () => {
      // Arrange
      const validator = new WalletValidator();
      const validAddress = '0x742d35Cc6634C0532925a3b8D091fB8e8C1D7bBf';
      
      // Act
      const result = validator.validate(validAddress);
      
      // Assert
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should return invalid for malformed address', () => {
      // Arrange
      const validator = new WalletValidator();
      const invalidAddress = 'not-an-address';
      
      // Act
      const result = validator.validate(invalidAddress);
      
      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid address format');
    });
  });
});
```

#### Mock Standards
```typescript
// ✅ Good: Typed mocks
const mockPolymarketApi = {
  getMarket: jest.fn<Promise<MarketData>, [string]>(),
  getUserPositions: jest.fn<Promise<Position[]>, [string]>()
} as jest.Mocked<PolymarketApi>;

// Setup mock responses
mockPolymarketApi.getMarket.mockResolvedValue({
  marketId: 'test-market',
  question: 'Test market question?',
  prices: [],
  volume24h: 1000,
  liquidity: 5000
});
```

### Coverage Requirements
- **Overall Coverage**: 100% (65/65 tests passing)
- **Branch Coverage**: >95%
- **Function Coverage**: 100%
- **Line Coverage**: >98%

## Error Handling Standards

### Error Classification
```typescript
// Domain-specific error types
class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class ExternalAPIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ExternalAPIError';
  }
}
```

### Error Handling Patterns
```typescript
// ✅ Good: Result pattern for error handling
type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

async function processCommand(command: string): Promise<Result<CommandResult>> {
  try {
    const result = await commandProcessor.execute(command);
    return { success: true, data: result };
  } catch (error) {
    logger.error('Command processing failed', { command, error });
    return { success: false, error: error as Error };
  }
}
```

## Logging Standards

### Structured Logging
```typescript
// ✅ Good: Structured logging with context
logger.info('User wallet added', {
  userId: user.id,
  walletAddress: wallet.address,
  timestamp: new Date().toISOString(),
  action: 'add_wallet'
});

logger.error('Database connection failed', {
  error: error.message,
  stack: error.stack,
  connectionString: redactedConnectionString,
  retryAttempt: attemptNumber
});
```

### Log Levels
- **ERROR**: System errors, failures requiring attention
- **WARN**: Degraded functionality, recoverable issues
- **INFO**: Important business events, state changes
- **DEBUG**: Detailed flow information (development only)

## Deployment Standards

### Environment Configuration
```typescript
// ✅ Good: Environment-specific configuration
interface AppConfig {
  readonly environment: 'development' | 'staging' | 'production';
  readonly telegram: {
    readonly botToken: string;
    readonly webhookUrl?: string;
  };
  readonly database: {
    readonly url: string;
    readonly poolSize: number;
  };
  readonly redis: {
    readonly url: string;
    readonly ttl: number;
  };
}

const config: AppConfig = {
  environment: process.env.NODE_ENV as any || 'development',
  telegram: {
    botToken: getRequiredEnvVar('TELEGRAM_BOT_TOKEN'),
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL
  },
  // ... other config
};
```

### Container Standards
```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## Documentation Standards

### Code Documentation
```typescript
/**
 * Validates and processes a wallet address for tracking
 * 
 * @param userId - The Telegram user ID
 * @param address - The wallet address to validate and add
 * @returns Promise resolving to the created wallet record
 * @throws ValidationError when address format is invalid
 * @throws DatabaseError when persistence fails
 * 
 * @example
 * ```typescript
 * const wallet = await addUserWallet(123456, '0x742d35Cc6634C0532925a3b8D091fB8e8C1D7bBf');
 * console.log('Wallet added:', wallet.id);
 * ```
 */
async function addUserWallet(userId: number, address: string): Promise<Wallet> {
  // Implementation
}
```

### README Structure
1. Project description and purpose
2. Installation and setup instructions
3. Configuration requirements
4. Usage examples
5. API documentation
6. Contributing guidelines
7. License information

## Enforcement & Validation

### Automated Checks
- **ESLint**: Code quality and style enforcement
- **Prettier**: Code formatting consistency
- **TypeScript**: Type safety validation
- **Jest**: Test coverage verification
- **Security Scanner**: Vulnerability detection

### Pre-commit Hooks
```bash
# Validate before commit
npm run lint      # ESLint checks
npm run format    # Prettier formatting
npm run typecheck # TypeScript validation
npm run test      # Test suite execution
npm run security  # Security vulnerability scan
```

### Code Review Checklist
- [ ] Follows YAGNI/KISS/DRY principles
- [ ] TypeScript strict mode compliance
- [ ] Proper error handling implemented
- [ ] Security best practices followed
- [ ] Performance considerations addressed
- [ ] Tests provide adequate coverage
- [ ] Documentation is clear and complete
- [ ] File size and complexity within limits

## Conclusion

These standards ensure PolyBot maintains high code quality, security, and performance while remaining maintainable and scalable. All development must adhere to these guidelines for consistency and reliability.