import {
  TelegramUser,
  TelegramChat,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramInlineQuery,
  TelegramInlineKeyboardMarkup,
  TelegramInlineKeyboardButton,
  TelegramReplyKeyboardMarkup,
  TelegramKeyboardButton,
  TelegramUserPreferences,
  WalletTracking,
  UserProfile,
  CommandContext,
  BotState,
  UserSession,
  NotificationData,
} from '@/types/telegram';

describe('Telegram Types', () => {
  describe('Basic Type Validations', () => {
    it('should validate basic TelegramUser structure', () => {
      const user: TelegramUser = {
        id: 12345,
        is_bot: false,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        language_code: 'en',
        is_premium: false,
        added_to_attachment_menu: false,
      };

      expect(user.id).toBe(12345);
      expect(user.is_bot).toBe(false);
      expect(user.first_name).toBe('John');
      expect(typeof user.username).toBe('string');
    });

    it('should validate TelegramChat structure', () => {
      const chat: TelegramChat = {
        id: 12345,
        type: 'private',
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
      };

      expect(chat.id).toBe(12345);
      expect(chat.type).toBe('private');
      expect(['private', 'group', 'supergroup', 'channel']).toContain(chat.type);
    });

    it('should validate TelegramMessage structure', () => {
      const mockUser: TelegramUser = {
        id: 12345,
        is_bot: false,
        first_name: 'John',
      };

      const mockChat: TelegramChat = {
        id: 12345,
        type: 'private',
        first_name: 'John',
      };

      const message: TelegramMessage = {
        message_id: 67890,
        from: mockUser,
        chat: mockChat,
        date: Date.now(),
        text: 'Hello, world!',
      };

      expect(message.message_id).toBe(67890);
      expect(message.from).toBeDefined();
      expect(message.chat).toBeDefined();
      expect(message.text).toBe('Hello, world!');
    });

    it('should validate TelegramCallbackQuery structure', () => {
      const mockUser: TelegramUser = {
        id: 12345,
        is_bot: false,
        first_name: 'John',
      };

      const callbackQuery: TelegramCallbackQuery = {
        id: 'callback-123',
        from: mockUser,
        data: 'action:data',
      };

      expect(callbackQuery.id).toBe('callback-123');
      expect(callbackQuery.from).toBe(mockUser);
      expect(callbackQuery.data).toBe('action:data');
    });

    it('should validate TelegramInlineQuery structure', () => {
      const mockUser: TelegramUser = {
        id: 12345,
        is_bot: false,
        first_name: 'John',
      };

      const inlineQuery: TelegramInlineQuery = {
        id: 'inline-123',
        from: mockUser,
        query: 'test search',
        chat_type: 'private',
      };

      expect(inlineQuery.id).toBe('inline-123');
      expect(inlineQuery.from).toBe(mockUser);
      expect(inlineQuery.query).toBe('test search');
    });

    it('should validate TelegramInlineKeyboardMarkup structure', () => {
      const keyboardMarkup: TelegramInlineKeyboardMarkup = {
        inline_keyboard: [
          [
            {
              text: 'Option 1',
              callback_data: 'option1',
            },
            {
              text: 'Option 2',
              url: 'https://example.com',
            },
          ],
        ],
      };

      expect(keyboardMarkup.inline_keyboard).toHaveLength(1);
      expect(keyboardMarkup.inline_keyboard[0]).toHaveLength(2);
      expect(keyboardMarkup.inline_keyboard[0]?.[0]).toBeDefined();
      expect(keyboardMarkup.inline_keyboard[0]?.[1]).toBeDefined();
    });

    it('should validate TelegramInlineKeyboardButton structure', () => {
      const callbackButton: TelegramInlineKeyboardButton = {
        text: 'Click me',
        callback_data: 'action:click',
      };

      const urlButton: TelegramInlineKeyboardButton = {
        text: 'Visit Website',
        url: 'https://example.com',
      };

      expect(callbackButton.text).toBe('Click me');
      expect(callbackButton.callback_data).toBe('action:click');
      expect(urlButton.text).toBe('Visit Website');
      expect(urlButton.url).toBe('https://example.com');
    });

    it('should validate TelegramReplyKeyboardMarkup structure', () => {
      const keyboardMarkup: TelegramReplyKeyboardMarkup = {
        keyboard: [
          [
            {
              text: 'Option 1',
              request_contact: true,
            },
          ],
        ],
        resize_keyboard: true,
      };

      expect(keyboardMarkup.keyboard).toHaveLength(1);
      expect(keyboardMarkup.keyboard[0]).toHaveLength(1);
      expect(keyboardMarkup.resize_keyboard).toBe(true);
    });

    it('should validate TelegramKeyboardButton structure', () => {
      const contactButton: TelegramKeyboardButton = {
        text: 'Share Contact',
        request_contact: true,
      };

      const locationButton: TelegramKeyboardButton = {
        text: 'Share Location',
        request_location: true,
      };

      expect(contactButton.text).toBe('Share Contact');
      expect(contactButton.request_contact).toBe(true);
      expect(locationButton.text).toBe('Share Location');
      expect(locationButton.request_location).toBe(true);
    });
  });

  describe('Complex Type Validations', () => {
    it('should validate TelegramUserPreferences structure', () => {
      const preferences: TelegramUserPreferences = {
        userId: 12345,
        notifications: {
          enabled: true,
          types: {
            positionUpdates: true,
            transactions: true,
            resolutions: true,
            priceAlerts: true,
            largePositions: true,
          },
          thresholds: {
            minPositionSize: 1000,
            minTransactionAmount: 500,
            priceChangeThreshold: 10,
          },
        },
        wallets: ['0x123', '0x456'],
        favorites: ['0x123'],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(preferences.userId).toBe(12345);
      expect(preferences.notifications.enabled).toBe(true);
      expect(preferences.wallets).toHaveLength(2);
      expect(preferences.favorites).toHaveLength(1);
    });

    it('should validate WalletTracking structure', () => {
      const wallet: WalletTracking = {
        id: 'wallet-123',
        userId: 12345,
        address: '0x1234567890123456789012345678901234567890',
        alias: 'My Wallet',
        network: 'ethereum',
        isActive: true,
        alertSettings: {
          transactions: true,
          positions: true,
          resolutions: true,
          priceAlerts: true,
          minTransactionAmount: 1000,
          minPositionChange: 10,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };

      expect(wallet.id).toBe('wallet-123');
      expect(wallet.userId).toBe(12345);
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(['ethereum', 'solana', 'polygon', 'bsc']).toContain(wallet.network);
    });

    it('should validate UserProfile structure', () => {
      const profile: UserProfile = {
        id: 1,
        telegramId: 12345,
        username: 'johndoe',
        firstName: 'John',
        lastName: 'Doe',
        isPremium: false,
        languageCode: 'en',
        isBot: false,
        isActive: true,
        plan: 'free',
        limits: {
          maxWallets: 10,
          maxAlerts: 50,
          apiCallsPerHour: 100,
        },
        preferences: {
          userId: 12345,
          notifications: {
            enabled: true,
            types: {
              positionUpdates: true,
              transactions: true,
              resolutions: true,
              priceAlerts: true,
              largePositions: true,
            },
            thresholds: {
              minPositionSize: 1000,
              minTransactionAmount: 500,
              priceChangeThreshold: 10,
            },
          },
          wallets: [],
          favorites: [],
          language: 'en',
          timezone: 'UTC',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        wallets: [],
        statistics: {
          totalTrackedWallets: 0,
          totalTransactions: 0,
          totalVolume: 0,
          joinDate: new Date().toISOString(),
          lastActiveDate: new Date().toISOString(),
          notificationsSent: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(profile.id).toBe(1);
      expect(profile.plan).toBe('free');
      expect(profile.limits.maxWallets).toBe(10);
    });

    it('should validate CommandContext structure', () => {
      const mockUser: TelegramUser = {
        id: 12345,
        is_bot: false,
        first_name: 'John',
      };

      const mockChat: TelegramChat = {
        id: 12345,
        type: 'private',
        first_name: 'John',
      };

      const mockMessage: TelegramMessage = {
        message_id: 67890,
        from: mockUser,
        chat: mockChat,
        date: Date.now(),
        text: '/start',
      };

      const context: CommandContext = {
        user: mockUser,
        chat: mockChat,
        message: mockMessage,
        session: { state: { command: 'start' } },
        navigation: {
          currentPage: 'start',
          previousPage: 'home',
        },
      };

      expect(context.user).toBe(mockUser);
      expect(context.chat).toBe(mockChat);
      expect(context.message).toBe(mockMessage);
      expect(context.session).toBeDefined();
    });

    it('should validate BotState structure', () => {
      const state: BotState = {
        command: 'track',
        step: 2,
        data: { address: '0x123', alias: 'My Wallet' },
        tempData: { validation: true },
        expiresAt: Date.now() + 300000,
      };

      expect(state.command).toBe('track');
      expect(state.step).toBe(2);
      expect(state.data).toEqual({ address: '0x123', alias: 'My Wallet' });
    });

    it('should validate UserSession structure', () => {
      const session: UserSession = {
        userId: 12345,
        state: {
          command: 'track',
          step: 1,
        },
        preferences: {
          notifications: {
            enabled: true,
            types: {
              positionUpdates: true,
              transactions: true,
              resolutions: false,
              priceAlerts: false,
              largePositions: false,
            },
            thresholds: {
              minPositionSize: 1000,
              minTransactionAmount: 500,
              priceChangeThreshold: 10,
            },
          },
        },
        lastActivity: Date.now(),
        createdAt: Date.now(),
      };

      expect(session.userId).toBe(12345);
      expect(session.state.command).toBe('track');
      expect(session.preferences.notifications?.enabled).toBe(true);
    });

    it('should validate NotificationData structure', () => {
      const notification: NotificationData = {
        type: 'transaction',
        title: 'New Transaction',
        message: 'You have a new transaction of $1,000',
        userId: 12345,
        priority: 'high',
        metadata: {
          source: 'websocket',
          timestamp: Date.now(),
          tags: ['large', 'transfer'],
          transactionHash: '0x123',
          amount: 1000,
          currency: 'USD',
        },
      };

      expect(notification.type).toBe('transaction');
      expect(notification.title).toBe('New Transaction');
      expect(notification.priority).toBe('high');
      expect(notification.metadata).toBeDefined();
      expect(notification.metadata?.tags).toHaveLength(2);
    });
  });

  describe('Type Compatibility and Validation', () => {
    it('should handle all notification types', () => {
      const notificationTypes: NotificationData['type'][] = [
        'transaction',
        'position_update',
        'resolution',
        'price_alert',
        'system'
      ];

      notificationTypes.forEach(type => {
        const notification: NotificationData = {
          type,
          title: 'Test',
          message: 'Test message',
          userId: 12345,
          priority: 'normal',
        };
        expect(notification.type).toBe(type);
      });
    });

    it('should handle all priority levels', () => {
      const priorityLevels: NotificationData['priority'][] = [
        'low',
        'normal',
        'high',
        'urgent'
      ];

      priorityLevels.forEach(priority => {
        const notification: NotificationData = {
          type: 'system',
          title: 'Test',
          message: 'Test message',
          userId: 12345,
          priority,
        };
        expect(notification.priority).toBe(priority);
      });
    });

    it('should handle all network types', () => {
      const networkTypes: WalletTracking['network'][] = [
        'ethereum',
        'solana',
        'polygon',
        'bsc'
      ];

      networkTypes.forEach(network => {
        const wallet: WalletTracking = {
          id: `wallet-${network}`,
          userId: 12345,
          address: '0x1234567890123456789012345678901234567890',
          network,
          isActive: true,
          alertSettings: {
            transactions: false,
            positions: false,
            resolutions: false,
            priceAlerts: false,
            minTransactionAmount: 0,
            minPositionChange: 0,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        expect(wallet.network).toBe(network);
      });
    });

    it('should validate Ethereum addresses', () => {
      const validEthAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8e55a';
      expect(validEthAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

      const invalidEthAddress = 'invalid-address';
      expect(invalidEthAddress).not.toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should validate timestamps and dates', () => {
      const testDate = new Date();
      const isoString = testDate.toISOString();

      const preferences: TelegramUserPreferences = {
        userId: 123,
        notifications: {
          enabled: true,
          types: {
            positionUpdates: true,
            transactions: true,
            resolutions: true,
            priceAlerts: true,
            largePositions: true,
          },
          thresholds: {
            minPositionSize: 1000,
            minTransactionAmount: 500,
            priceChangeThreshold: 10,
          },
        },
        wallets: [],
        favorites: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: isoString,
        updatedAt: isoString,
      };

      expect(new Date(preferences.createdAt)).toBeInstanceOf(Date);
      expect(new Date(preferences.updatedAt)).toBeInstanceOf(Date);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle optional fields gracefully', () => {
      const minimalUser: TelegramUser = {
        id: 123,
        is_bot: false,
        first_name: 'Test',
      };

      expect(minimalUser.last_name).toBeUndefined();
      expect(minimalUser.username).toBeUndefined();
    });

    it('should handle partial updates', () => {
      const originalPreferences: TelegramUserPreferences = {
        userId: 123,
        notifications: {
          enabled: true,
          types: {
            positionUpdates: true,
            transactions: true,
            resolutions: true,
            priceAlerts: true,
            largePositions: true,
          },
          thresholds: {
            minPositionSize: 1000,
            minTransactionAmount: 500,
            priceChangeThreshold: 10,
          },
        },
        wallets: ['0x123'],
        favorites: ['0x123'],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const update = {
        notifications: {
          enabled: false,
        },
      };

      const updatedPreferences = {
        ...originalPreferences,
        ...update,
        notifications: {
          ...originalPreferences.notifications,
          ...update.notifications,
        },
      };

      expect(updatedPreferences.notifications.enabled).toBe(false);
      expect(updatedPreferences.notifications.types.positionUpdates).toBe(true);
    });

    it('should validate object structures', () => {
      // Test that all required properties are present
      const wallet: WalletTracking = {
        id: 'test-wallet',
        userId: 123,
        address: '0x1234567890123456789012345678901234567890',
        network: 'ethereum',
        isActive: true,
        alertSettings: {
          transactions: false,
          positions: false,
          resolutions: false,
          priceAlerts: false,
          minTransactionAmount: 0,
          minPositionChange: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Should not throw when accessing required fields
      expect(wallet.id).toBeDefined();
      expect(wallet.userId).toBeDefined();
      expect(wallet.address).toBeDefined();
      expect(wallet.network).toBeDefined();
      expect(wallet.isActive).toBeDefined();
      expect(wallet.alertSettings).toBeDefined();
    });
  });
});