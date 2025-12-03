# Polymarket Telegram Bot

Real-time Telegram bot for tracking Polymarket wallet activity and receiving instant notifications.

## 🚀 Features

- **Real-time Wallet Tracking**: Monitor Polymarket wallet activity instantly
- **Smart Notifications**: Customizable alerts for positions, transactions, and resolutions
- **User Preferences**: Personalized notification settings and thresholds
- **Market Monitoring**: Track price changes and market resolutions
- **Secure**: Enterprise-grade security with encryption and secure key management
- **Scalable**: Serverless architecture supporting 1000+ concurrent users

## 📋 Prerequisites

- Node.js 18+
- PostgreSQL 12+
- Redis 6+
- Telegram Bot Token
- Polymarket API Key

## 🛠️ Installation

### 1. Clone Repository
```bash
git clone https://github.com/your-username/polymarket-telebot.git
cd polymarket-telebot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Database Setup
```bash
# Create PostgreSQL database
createdb polymarket_bot

# Run migrations (when implemented)
npm run migrate
```

### 5. Start Development Server
```bash
npm run dev
```

## 🔧 Configuration

### Environment Variables
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `POLYMARKET_API_KEY`: Polymarket API key
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: JWT secret for authentication
- `ENCRYPTION_KEY`: Encryption key for sensitive data

### Telegram Commands
- `/start` - Start the bot
- `/help` - Show all commands
- `/track <wallet>` - Track a wallet address
- `/list` - Show tracked wallets
- `/alerts` - Manage notification alerts
- `/settings` - Configure preferences
- `/status` - Check bot status

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run linting
npm run lint

# Run TypeScript check
npm run typecheck
```

## 🐳 Docker Deployment

### Using Docker Compose
```bash
# Create .env file with production values
cp .env.example .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Using Docker
```bash
# Build image
docker build -t polymarket-telebot .

# Run container
docker run -d \
  --name polymarket-telebot \
  --env-file .env \
  polymarket-telebot
```

## 🚢 Production Deployment

### GitHub Actions
The project includes CI/CD pipelines for automated testing and deployment:

- **CI Pipeline**: Runs on every push and PR
- **Deploy Pipeline**: Runs on main branch merges and tags
- **Security Scanning**: Automated vulnerability scanning
- **Health Checks**: Post-deployment verification

### Manual Deployment
```bash
# Build for production
npm run build

# Start production server
npm start
```

## 📊 Monitoring

### Health Checks
- Bot health endpoint: `GET /health`
- Database connectivity monitoring
- Redis connection monitoring
- WebSocket connection status

### Logging
- Structured JSON logging with Winston
- Log rotation and archival
- Error tracking and alerting
- Performance metrics collection

## 🔒 Security

- **Encryption**: End-to-end encryption for sensitive data
- **Authentication**: JWT-based user authentication
- **Rate Limiting**: Request throttling and abuse prevention
- **Input Validation**: Comprehensive input sanitization
- **Secret Management**: Secure storage of API keys and tokens

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 Development

### Project Structure
```
src/
├── bot/                 # Telegram bot components
│   ├── handlers/        # Command handlers
│   ├── middleware/      # Bot middleware
│   └── keyboards/       # Inline keyboards
├── services/            # Business logic
│   ├── polymarket/      # Polymarket integration
│   ├── notifications/   # Notification management
│   └── database/         # Database operations
├── utils/               # Utility functions
├── types/               # TypeScript definitions
└── config/              # Configuration management
```

### Code Standards
- TypeScript with strict mode
- ESLint and Prettier formatting
- Jest unit testing
- Conventional commits
- Maximum 200 lines per file

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📧 Email: support@polymarket-telebot.com
- 🐛 Issues: [GitHub Issues](https://github.com/your-username/polymarket-telebot/issues)
- 📖 Documentation: [Wiki](https://github.com/your-username/polymarket-telebot/wiki)

## 🔄 Roadmap

- [x] **Phase 1**: Project setup and foundation ✅
- [ ] **Phase 2**: Core infrastructure and API integration
- [ ] **Phase 3**: Telegram bot development and commands
- [ ] **Phase 4**: Advanced features and optimization

For detailed roadmap, see [Project Roadmap](docs/project-roadmap.md).