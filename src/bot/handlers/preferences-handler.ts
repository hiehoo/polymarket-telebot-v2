import { Telegraf } from 'telegraf';
import { BaseCommandHandler } from './base-handler';
import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { RedisCacheManager } from '../../services/redis/cache-manager';
import { DatabaseUser, TelegramUserPreferences } from '../../types/database';

interface PreferencesState {
  currentSection?: 'notifications' | 'thresholds' | 'quiet-hours' | 'display';
  editingThreshold?: 'min_position_size' | 'min_transaction_amount' | 'price_change_threshold';
}

export class PreferencesHandler extends BaseCommandHandler {
  private cacheManager: RedisCacheManager;
  private readonly commandName = '/preferences';

  constructor(bot: Telegraf) {
    super(bot, '/preferences');
    this.cacheManager = new RedisCacheManager();
  }

  register(): void {
    this.bot.command(this.commandName, async (ctx: Context) => {
      await this.handlePreferences(ctx);
    });

    this.bot.action('open_preferences', async (ctx) => {
      await this.handlePreferences(ctx);
    });

    this.bot.action(/^pref_section_(.+)$/, async (ctx) => {
      const section = ctx.match?.[1];
      if (section) {
        await this.handleSection(ctx, section);
      }
    });

    this.bot.action(/^pref_toggle_(.+)$/, async (ctx) => {
      const setting = ctx.match?.[1];
      if (setting) {
        await this.togglePreference(ctx, setting);
      }
    });

    this.bot.action(/^pref_threshold_(.+)$/, async (ctx) => {
      const threshold = ctx.match?.[1];
      if (threshold) {
        await this.editThreshold(ctx, threshold);
      }
    });

    this.bot.action(/^pref_quiet_hours_(.+)$/, async (ctx) => {
      const action = ctx.match?.[1];
      if (action) {
        await this.handleQuietHours(ctx, action);
      }
    });

    this.bot.action('save_preferences', async (ctx) => {
      await this.savePreferences(ctx);
    });

    this.bot.action('reset_preferences', async (ctx) => {
      await this.resetPreferences(ctx);
    });

    logger.info('Preferences handler registered');
  }

  private async handlePreferences(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }

      await ctx.reply('⚙️ Loading your preferences...');

      const userPrefs = await this.getUserPreferences(userId);
      await this.sendPreferencesMenu(ctx, userPrefs);

    } catch (error) {
      logger.error('Error in /preferences command:', error);
      await ctx.reply('❌ An error occurred while loading your preferences. Please try again later.');
    }
  }

  private async handleSection(ctx: Context, section: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const userPrefs = await this.getUserPreferences(userId);

      switch (section) {
        case 'notifications':
          await this.sendNotificationSettings(ctx, userPrefs);
          break;
        case 'thresholds':
          await this.sendThresholdSettings(ctx, userPrefs);
          break;
        case 'quiet-hours':
          await this.sendQuietHoursSettings(ctx, userPrefs);
          break;
        case 'display':
          await this.sendDisplaySettings(ctx, userPrefs);
          break;
        default:
          await this.sendPreferencesMenu(ctx, userPrefs);
      }

    } catch (error) {
      logger.error(`Error handling preferences section ${section}:`, error);
      await ctx.reply('❌ Error loading preference section.');
    }
  }

  private async togglePreference(ctx: Context, setting: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const userPrefs = await this.getUserPreferences(userId);
      const keys = setting.split('_');

      if (keys.length === 2) {
        const section = keys[0];
        const settingName = keys[1];

        if (section === 'notifications' && userPrefs.notification_preferences) {
          userPrefs.notification_preferences[settingName as keyof typeof userPrefs.notification_preferences] =
            !userPrefs.notification_preferences[settingName as keyof typeof userPrefs.notification_preferences];
        }

        await this.updateUserPreferences(userId, userPrefs);
        await this.sendNotificationSettings(ctx, userPrefs);
      }

    } catch (error) {
      logger.error('Error toggling preference:', error);
      await ctx.reply('❌ Error updating preference setting.');
    }
  }

  private async editThreshold(ctx: Context, threshold: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await this.savePreferencesState(userId, {
        editingThreshold: threshold as any
      });

      const thresholdLabels = {
        'min_position_size': 'Minimum Position Size ($)',
        'min_transaction_amount': 'Minimum Transaction Amount ($)',
        'price_change_threshold': 'Price Change Threshold (%)'
      };

      await ctx.editMessageText(
        `✏️ *Edit Threshold*\n\n` +
        `📊 ${thresholdLabels[threshold as keyof typeof thresholdLabels]}\n\n` +
        '*Current value:* Check your current settings\n\n' +
        '*Enter new value:*\n' +
        '💡 Send a number (e.g., 100, 1000, 0.5)\n' +
        '💡 0 = disable this threshold\n\n' +
        '*Options:*\n' +
        '• 0 = Disable\n' +
        '• 50 = $50 minimum\n' +
        '• 100 = $100 minimum\n' +
        '• 1000 = $1,000 minimum\n' +
        '• 0.5 = 0.5% for percentage',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⬅️ Cancel', callback_data: 'pref_section_thresholds' }
              ]
            ]
          }
        }
      );

    } catch (error) {
      logger.error('Error editing threshold:', error);
      await ctx.reply('❌ Error starting threshold edit.');
    }
  }

  private async handleQuietHours(ctx: Context, action: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const userPrefs = await this.getUserPreferences(userId);

      if (action === 'enable' && userPrefs.notification_preferences) {
        userPrefs.notification_preferences.quiet_hours = {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'UTC'
        };
      } else if (action === 'disable' && userPrefs.notification_preferences) {
        userPrefs.notification_preferences.quiet_hours = {
          enabled: false,
          start: '22:00',
          end: '08:00',
          timezone: 'UTC'
        };
      }

      await this.updateUserPreferences(userId, userPrefs);
      await this.sendQuietHoursSettings(ctx, userPrefs);

    } catch (error) {
      logger.error('Error handling quiet hours:', error);
      await ctx.reply('❌ Error updating quiet hours settings.');
    }
  }

  private async sendPreferencesMenu(ctx: Context, userPrefs: DatabaseUser): Promise<void> {
    const notificationsEnabled = userPrefs.notification_preferences?.enabled || false;
    const walletCount = 0;

    await ctx.editMessageText(
      '⚙️ *Your Preferences*\n\n' +
      `👤 *User ID:* ${userPrefs.telegram_id}\n` +
      `📱 *Active Wallets:* ${walletCount}\n` +
      `🔔 *Notifications:* ${notificationsEnabled ? '✅ Enabled' : '❌ Disabled'}\n\n` +
      '*Quick Stats:*\n' +
      `• 📊 Total tracked: ${walletCount} wallets\n` +
      `• 🔔 Alerts: ${this.countEnabledAlerts(userPrefs)}\n` +
      `• ⏰ Quiet hours: ${userPrefs.notification_preferences?.quiet_hours?.enabled ? '🌙 Enabled' : '☀️ Disabled'}\n\n` +
      '*Customize your experience:*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔔 Notifications', callback_data: 'pref_section_notifications' },
              { text: '📊 Thresholds', callback_data: 'pref_section_thresholds' }
            ],
            [
              { text: '🌙 Quiet Hours', callback_data: 'pref_section_quiet-hours' },
              { text: '🎨 Display', callback_data: 'pref_section_display' }
            ],
            [
              { text: '💾 Save Changes', callback_data: 'save_preferences' },
              { text: '🔄 Reset Default', callback_data: 'reset_preferences' }
            ],
            [
              { text: '⬅️ Back', callback_data: 'cancel_action' }
            ]
          ]
        }
      }
    );
  }

  private async sendNotificationSettings(ctx: Context, userPrefs: DatabaseUser): Promise<void> {
    const prefs = userPrefs.notification_preferences || {
      enabled: true,
      position_updates: true,
      transactions: true,
      resolutions: true,
      price_alerts: true,
      large_positions: true,
      quiet_hours: { enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' }
    };

    await ctx.editMessageText(
      '🔔 *Notification Settings*\n\n' +
      `🔊 *Main Switch:* ${prefs.enabled ? '✅ ON' : '❌ OFF'}\n\n` +
      '*Alert Types:*\n' +
      `📊 Position updates: ${prefs.position_updates ? '✅' : '❌'}\n` +
      `💰 Transactions: ${prefs.transactions ? '✅' : '❌'}\n` +
      `🎯 Resolutions: ${prefs.resolutions ? '✅' : '❌'}\n` +
      `📈 Price alerts: ${prefs.price_alerts ? '✅' : '❌'}\n` +
      `🐋 Large positions: ${prefs.large_positions ? '✅' : '❌'}\n\n` +
      `🌙 *Quiet Hours:* ${prefs.quiet_hours?.enabled ? `✅ ${prefs.quiet_hours.start}-${prefs.quiet_hours.end}` : '❌ Disabled'}\n\n` +
      '*Toggle settings below:*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `${prefs.enabled ? '🔊' : '🔇'} Main Switch`, callback_data: 'pref_toggle_notifications_enabled' }
            ],
            [
              { text: `${prefs.position_updates ? '✅' : '❌'} Position Updates`, callback_data: 'pref_toggle_notifications_position_updates' },
              { text: `${prefs.transactions ? '✅' : '❌'} Transactions`, callback_data: 'pref_toggle_notifications_transactions' }
            ],
            [
              { text: `${prefs.resolutions ? '✅' : '❌'} Resolutions`, callback_data: 'pref_toggle_notifications_resolutions' },
              { text: `${prefs.price_alerts ? '✅' : '❌'} Price Alerts`, callback_data: 'pref_toggle_notifications_price_alerts' }
            ],
            [
              { text: `${prefs.large_positions ? '✅' : '❌'} Large Positions`, callback_data: 'pref_toggle_notifications_large_positions' }
            ],
            [
              { text: '🌙 Configure Quiet Hours', callback_data: 'pref_section_quiet-hours' },
              { text: '⬅️ Back', callback_data: 'open_preferences' }
            ]
          ]
        }
      }
    );
  }

  private async sendThresholdSettings(ctx: Context, userPrefs: DatabaseUser): Promise<void> {
    const prefs = userPrefs.notification_preferences || {
      min_position_size: 1000,
      min_transaction_amount: 100,
      price_change_threshold: 5.0
    };

    await ctx.editMessageText(
      '📊 *Threshold Settings*\n\n' +
      '*Minimum alerts to trigger:*\n\n' +
      `💰 *Position Size:* $${prefs.min_position_size?.toLocaleString()}\n` +
      `📝 *Transaction Amount:* $${prefs.min_transaction_amount?.toLocaleString()}\n` +
      `📈 *Price Change:* ${prefs.price_change_threshold}%\n\n` +
      '*Edit thresholds below:*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `💰 Position: $${prefs.min_position_size || 1000}`, callback_data: 'pref_threshold_min_position_size' },
              { text: `📝 Transaction: $${prefs.min_transaction_amount || 100}`, callback_data: 'pref_threshold_min_transaction_amount' }
            ],
            [
              { text: `📈 Price: ${prefs.price_change_threshold || 5.0}%`, callback_data: 'pref_threshold_price_change_threshold' }
            ],
            [
              { text: '🔄 Reset to Default', callback_data: 'reset_thresholds' },
              { text: '⬅️ Back', callback_data: 'open_preferences' }
            ]
          ]
        }
      }
    );
  }

  private async sendQuietHoursSettings(ctx: Context, userPrefs: DatabaseUser): Promise<void> {
    const quietHours = userPrefs.notification_preferences?.quiet_hours;

    await ctx.editMessageText(
      '🌙 *Quiet Hours Settings*\n\n' +
      `🌙 *Status:* ${quietHours?.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n` +
      `${quietHours?.enabled ?
        `⏰ *Hours:* ${quietHours.start} - ${quietHours.end}\n` +
        `🌍 *Timezone:* ${quietHours.timezone}\n\n` +
        '*During quiet hours:*\n' +
        '• 🔇 No notification sounds\n' +
        '• 📱 Messages delivered silently\n' +
        '• 🎯 Critical alerts still shown\n\n'
        :
        '🔔 *All notifications normal*\n\n' +
        '*Benefits:*\n' +
        '• 😴 Better sleep quality\n' +
        '• 🏢 Workplace focus\n' +
        '• 📱 Reduced interruptions\n\n'
      }` +
      '*Configure below:*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `${quietHours?.enabled ? '🌙 Disable' : '🔔 Enable'}`, callback_data: `pref_quiet_hours_${quietHours?.enabled ? 'disable' : 'enable'}` }
            ],
            [
              { text: '⏰ Set Hours', callback_data: 'set_quiet_hours' },
              { text: '🌍 Set Timezone', callback_data: 'set_timezone' }
            ],
            [
              { text: '⬅️ Back', callback_data: 'open_preferences' }
            ]
          ]
        }
      }
    );
  }

  private async sendDisplaySettings(ctx: Context, userPrefs: DatabaseUser): Promise<void> {
    await ctx.editMessageText(
      '🎨 *Display Settings*\n\n' +
      '*Appearance preferences:*\n\n' +
      `📱 *Interface:* Standard\n` +
      `🌍 *Language:* English\n` +
      `⏰ *Timezone:* Auto-detect\n` +
      `💰 *Currency:* USD ($)\n` +
      `📊 *Data format:* Compact\n\n` +
      '*Coming soon:*\n' +
      '• 🌙 Dark/Light theme\n' +
      '• 📊 Custom dashboards\n' +
      '• 🎨 Color schemes\n\n' +
      '*These settings are under development.*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Currency', callback_data: 'set_currency' },
              { text: '⏰ Timezone', callback_data: 'set_timezone' }
            ],
            [
              { text: '📊 Data Format', callback_data: 'set_data_format' },
              { text: '🌍 Language', callback_data: 'set_language' }
            ],
            [
              { text: '⬅️ Back', callback_data: 'open_preferences' }
            ]
          ]
        }
      }
    );
  }

  private async savePreferences(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      await ctx.editMessageText(
        '💾 *Preferences Saved*\n\n' +
        '✅ Your settings have been updated successfully.\n\n' +
        '*Changes applied:*\n' +
        '• 🔔 Notification preferences\n' +
        '• 📊 Alert thresholds\n' +
        '• 🌙 Quiet hours settings\n\n' +
        '*Settings take effect immediately.*\n\n' +
        '*Need help?* Use /help or /support',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📋 My Wallets', callback_data: 'list_my_wallets' },
                { text: '📊 Statistics', callback_data: 'show_statistics' }
              ],
              [
                { text: '⬅️ Main Menu', callback_data: 'cancel_action' }
              ]
            ]
          }
        }
      );

      await this.clearPreferencesState(userId);

    } catch (error) {
      logger.error('Error saving preferences:', error);
      await ctx.reply('❌ Error saving preferences.');
    }
  }

  private async resetPreferences(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const defaultPrefs: DatabaseUser = {
        id: '',
        telegram_id: userId,
        is_active: true,
        notification_preferences: {
          enabled: true,
          position_updates: true,
          transactions: true,
          resolutions: true,
          price_alerts: true,
          large_positions: true,
          min_position_size: 1000,
          min_transaction_amount: 100,
          price_change_threshold: 5.0,
          quiet_hours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: 'UTC'
          }
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.updateUserPreferences(userId, defaultPrefs);
      await this.sendPreferencesMenu(ctx, defaultPrefs);

    } catch (error) {
      logger.error('Error resetting preferences:', error);
      await ctx.reply('❌ Error resetting preferences.');
    }
  }

  private async getUserPreferences(userId: number): Promise<DatabaseUser> {
    try {
      const cached = await this.cacheManager.getCachedData(`user_prefs:${userId}`);
      if (cached) {
        return cached;
      }

      const defaultPrefs: DatabaseUser = {
        id: '',
        telegram_id: userId,
        is_active: true,
        notification_preferences: {
          enabled: true,
          position_updates: true,
          transactions: true,
          resolutions: true,
          price_alerts: true,
          large_positions: true,
          min_position_size: 1000,
          min_transaction_amount: 100,
          price_change_threshold: 5.0,
          quiet_hours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: 'UTC'
          }
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      return defaultPrefs;

    } catch (error) {
      logger.error('Error getting user preferences:', error);
      throw error;
    }
  }

  private async updateUserPreferences(userId: number, preferences: DatabaseUser): Promise<void> {
    try {
      preferences.updated_at = new Date();
      await this.cacheManager.setCachedData(`user_prefs:${userId}`, preferences, 3600);

    } catch (error) {
      logger.error('Error updating user preferences:', error);
      throw error;
    }
  }

  private async savePreferencesState(userId: number, state: PreferencesState): Promise<void> {
    try {
      await this.cacheManager.setCachedData(`prefs_state:${userId}`, state, 300);
    } catch (error) {
      logger.error('Error saving preferences state:', error);
    }
  }

  private async clearPreferencesState(userId: number): Promise<void> {
    try {
      await this.cacheManager.deleteCachedData(`prefs_state:${userId}`);
    } catch (error) {
      logger.error('Error clearing preferences state:', error);
    }
  }

  private countEnabledAlerts(userPrefs: DatabaseUser): number {
    const prefs = userPrefs.notification_preferences;
    if (!prefs) return 0;

    return Object.keys(prefs).filter(key =>
      key !== 'quiet_hours' &&
      key !== 'enabled' &&
      prefs[key as keyof typeof prefs] === true
    ).length;
  }

  getCommandDescription(): string {
    return 'Configure your notification and display preferences - Usage: /preferences';
  }

  getCommandExamples(): string[] {
    return [
      '/preferences - Open settings menu',
      '/preferences - Quick access to notification settings'
    ];
  }
}