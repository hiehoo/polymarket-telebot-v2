import { InlineKeyboardMarkup, InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../utils/logger';

export interface KeyboardConfig {
  type: 'inline' | 'reply';
  layout: 'grid' | 'list' | 'carousel' | 'tabs';
  columns?: number;
  rows?: number;
  backButton?: boolean;
  refreshButton?: boolean;
  pagination?: boolean;
}

export interface KeyboardItem {
  id: string;
  text: string;
  callback_data?: string;
  url?: string;
  description?: string;
  icon?: string;
  badge?: string;
  color?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning';
  disabled?: boolean;
  metadata?: Record<string, any>;
}

export interface KeyboardSection {
  title?: string;
  items: KeyboardItem[];
  layout?: 'horizontal' | 'vertical';
}

export interface PaginatedKeyboardOptions {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  showPageNumbers?: boolean;
  showFirstLast?: boolean;
  navigationButtons?: {
    first?: string;
    prev?: string;
    next?: string;
    last?: string;
  };
}

export class AdvancedKeyboards {
  private logger = Logger.getInstance();

  constructor() {}

  // Main dashboard keyboard with tabs
  createDashboardKeyboard(userId: number): InlineKeyboardMarkup {
    const sections: KeyboardSection[] = [
      {
        title: '📊 Overview',
        items: [
          { id: 'overview', text: '📊 Portfolio', callback_data: 'dashboard:overview', icon: '📊' },
          { id: 'performance', text: '📈 Performance', callback_data: 'dashboard:performance', icon: '📈' },
          { id: 'analytics', text: '📉 Analytics', callback_data: 'dashboard:analytics', icon: '📉' }
        ],
        layout: 'horizontal'
      },
      {
        title: '👛 Wallets',
        items: [
          { id: 'list_wallets', text: '📋 My Wallets', callback_data: 'wallets:list', icon: '📋' },
          { id: 'add_wallet', text: '➕ Add Wallet', callback_data: 'wallets:add', icon: '➕' },
          { id: 'batch_operations', text: '🔄 Batch Ops', callback_data: 'wallets:batch', icon: '🔄' }
        ],
        layout: 'horizontal'
      },
      {
        title: '⚡ Alerts',
        items: [
          { id: 'manage_alerts', text: '🔔 Manage Alerts', callback_data: 'alerts:manage', icon: '🔔' },
          { id: 'alert_history', text: '📜 Alert History', callback_data: 'alerts:history', icon: '📜' },
          { id: 'alert_stats', text: '📊 Alert Stats', callback_data: 'alerts:stats', icon: '📊' }
        ],
        layout: 'horizontal'
      },
      {
        title: '📈 Analytics',
        items: [
          { id: 'portfolio_report', text: '💼 Portfolio Report', callback_data: 'analytics:portfolio', icon: '💼' },
          { id: 'market_analysis', text: '📊 Market Analysis', callback_data: 'analytics:markets', icon: '📊' },
          { id: 'export_data', text: '📤 Export Data', callback_data: 'analytics:export', icon: '📤' }
        ],
        layout: 'horizontal'
      },
      {
        title: '⚙️ Settings',
        items: [
          { id: 'notifications', text: '🔔 Notifications', callback_data: 'settings:notifications', icon: '🔔' },
          { id: 'preferences', text: '⚡ Preferences', callback_data: 'settings:preferences', icon: '⚡' },
          { id: 'groups', text: '👥 Wallet Groups', callback_data: 'settings:groups', icon: '👥' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list',
      backButton: false
    });
  }

  // Wallet management keyboard
  createWalletManagementKeyboard(wallets: Array<{
    address: string;
    alias?: string;
    totalValue: number;
    currency: string;
    isActive: boolean;
  }>): InlineKeyboardMarkup {
    const walletItems = wallets.map(wallet => ({
      id: wallet.address,
      text: wallet.alias ? `${wallet.alias} (${wallet.totalValue.toFixed(2)} ${wallet.currency})` :
                     `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)} (${wallet.totalValue.toFixed(2)} ${wallet.currency})`,
      callback_data: `wallet:select:${wallet.address}`,
      icon: wallet.isActive ? '🟢' : '🔴',
      badge: wallet.totalValue > 1000 ? '💰' : undefined,
      metadata: { address: wallet.address, alias: wallet.alias }
    }));

    const sections: KeyboardSection[] = [
      {
        title: `👛 Wallets (${wallets.length})`,
        items: walletItems,
        layout: 'vertical'
      },
      {
        items: [
          { id: 'add_multiple', text: '➕ Add Multiple', callback_data: 'wallets:add_multiple', icon: '➕', color: 'primary' },
          { id: 'create_group', text: '👥 Create Group', callback_data: 'wallets:create_group', icon: '👥', color: 'primary' },
          { id: 'import_wallets', text: '📥 Import', callback_data: 'wallets:import', icon: '📥' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Alert configuration keyboard
  createAlertConfigKeyboard(alertTypes: string[], existingAlerts: number): InlineKeyboardMarkup {
    const alertItems = alertTypes.map(type => ({
      id: type,
      text: this.formatAlertType(type),
      callback_data: `alert:setup:${type}`,
      icon: this.getAlertTypeIcon(type),
      color: this.getAlertTypeColor(type)
    }));

    const sections: KeyboardSection[] = [
      {
        title: '⚡ Quick Alert Setup',
        items: [
          { id: 'price_above', text: '⬆️ Price Above', callback_data: 'alert:price_above', icon: '⬆️' },
          { id: 'price_below', text: '⬇️ Price Below', callback_data: 'alert:price_below', icon: '⬇️' },
          { id: 'change_percent', text: '📈 % Change', callback_data: 'alert:change_percent', icon: '📈' }
        ],
        layout: 'horizontal'
      },
      {
        title: '🔔 Alert Types',
        items: alertItems,
        layout: 'vertical'
      },
      {
        items: [
          { id: 'manage_existing', text: `📋 Manage (${existingAlerts})`, callback_data: 'alerts:manage', icon: '📋', badge: existingAlerts > 0 ? existingAlerts.toString() : undefined },
          { id: 'alert_templates', text: '📝 Templates', callback_data: 'alerts:templates', icon: '📝' },
          { id: 'alert_stats', text: '📊 Statistics', callback_data: 'alerts:stats', icon: '📊' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Portfolio analytics keyboard
  createAnalyticsKeyboard(analyticsData: {
    periodOptions: string[];
    hasData: boolean;
    exportOptions: string[];
  }): InlineKeyboardMarkup {
    const periodItems = analyticsData.periodOptions.map(period => ({
      id: period,
      text: `📅 ${period}`,
      callback_data: `analytics:period:${period}`,
      icon: '📅'
    }));

    const sections: KeyboardSection[] = [];

    if (analyticsData.hasData) {
      sections.push({
        title: '📊 Time Periods',
        items: periodItems,
        layout: 'horizontal'
      });
    }

    sections.push({
      title: '📈 Analysis Types',
      items: [
        { id: 'performance', text: '💼 Performance', callback_data: 'analytics:performance', icon: '💼' },
        { id: 'risk_analysis', text: '⚠️ Risk Analysis', callback_data: 'analytics:risk', icon: '⚠️' },
        { id: 'market_insights', text: '💡 Market Insights', callback_data: 'analytics:insights', icon: '💡' },
        { id: 'comparison', text: '🔍 Comparison', callback_data: 'analytics:compare', icon: '🔍' }
      ],
      layout: 'grid'
    });

    sections.push({
      title: '📤 Export Options',
      items: analyticsData.exportOptions.map(option => ({
        id: option,
        text: `📤 ${option}`,
        callback_data: `analytics:export:${option}`,
        icon: '📤'
      })),
      layout: 'horizontal'
    });

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Paginated wallet selection keyboard
  createPaginatedWalletKeyboard(
    wallets: KeyboardItem[],
    options: PaginatedKeyboardOptions,
    extraActions?: KeyboardItem[]
  ): InlineKeyboardMarkup {
    const startIndex = (options.currentPage - 1) * options.itemsPerPage;
    const endIndex = Math.min(startIndex + options.itemsPerPage, options.totalItems);
    const pageItems = wallets.slice(startIndex, endIndex);

    const sections: KeyboardSection[] = [
      {
        title: `📄 Page ${options.currentPage} of ${Math.ceil(options.totalItems / options.itemsPerPage)}`,
        items: pageItems,
        layout: 'vertical'
      }
    ];

    // Add pagination controls
    const paginationItems: KeyboardItem[] = [];

    if (options.showFirstLast) {
      paginationItems.push(
        { id: 'first_page', text: options.navigationButtons?.first || '⏮️ First', callback_data: 'page:first', disabled: options.currentPage === 1 },
        { id: 'last_page', text: options.navigationButtons?.last || '⏭️ Last', callback_data: 'page:last', disabled: options.currentPage === Math.ceil(options.totalItems / options.itemsPerPage) }
      );
    }

    paginationItems.push(
      { id: 'prev_page', text: options.navigationButtons?.prev || '⬅️ Previous', callback_data: 'page:prev', disabled: options.currentPage === 1 },
      { id: 'next_page', text: options.navigationButtons?.next || '➡️ Next', callback_data: 'page:next', disabled: options.currentPage === Math.ceil(options.totalItems / options.itemsPerPage) }
    );

    sections.push({
      items: paginationItems,
      layout: 'horizontal'
    });

    // Add extra actions if provided
    if (extraActions && extraActions.length > 0) {
      sections.push({
        title: '⚡ Actions',
        items: extraActions,
        layout: 'horizontal'
      });
    }

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Interactive filter keyboard
  createFilterKeyboard(
    availableFilters: Array<{
      field: string;
      operator: string;
      value: string;
      active: boolean;
    }>,
    filterTypes: string[]
  ): InlineKeyboardMarkup {
    const filterItems = availableFilters.map(filter => ({
      id: `${filter.field}:${filter.operator}:${filter.value}`,
      text: `${filter.field} ${filter.operator} ${filter.value}`,
      callback_data: `filter:toggle:${filter.field}:${filter.operator}:${filter.value}`,
      icon: filter.active ? '✅' : '⭕',
      color: filter.active ? 'success' : 'secondary'
    }));

    const typeItems = filterTypes.map(type => ({
      id: type,
      text: `🏷️ ${type}`,
      callback_data: `filter:type:${type}`,
      icon: '🏷️'
    }));

    const sections: KeyboardSection[] = [
      {
        title: '🔍 Active Filters',
        items: filterItems,
        layout: 'vertical'
      },
      {
        title: '📋 Filter Types',
        items: typeItems,
        layout: 'horizontal'
      },
      {
        items: [
          { id: 'clear_all', text: '🗑️ Clear All', callback_data: 'filter:clear_all', icon: '🗑️', color: 'danger' },
          { id: 'save_preset', text: '💾 Save Preset', callback_data: 'filter:save', icon: '💾', color: 'primary' },
          { id: 'load_preset', text: '📂 Load Preset', callback_data: 'filter:load', icon: '📂' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Settings keyboard with nested menus
  createSettingsKeyboard(settings: {
    notifications: boolean;
    autoRefresh: boolean;
    advancedMode: boolean;
    currency: string;
  }): InlineKeyboardMarkup {
    const sections: KeyboardSection[] = [
      {
        title: '🔔 Notification Settings',
        items: [
          {
            id: 'notifications_toggle',
            text: `🔔 Notifications ${settings.notifications ? '✅' : '❌'}`,
            callback_data: 'settings:toggle:notifications',
            icon: settings.notifications ? '🔔' : '🔕',
            color: settings.notifications ? 'success' : 'secondary'
          },
          { id: 'notification_types', text: '📝 Types', callback_data: 'settings:notifications:types', icon: '📝' },
          { id: 'quiet_hours', text: '🌙 Quiet Hours', callback_data: 'settings:notifications:quiet_hours', icon: '🌙' }
        ],
        layout: 'vertical'
      },
      {
        title: '⚡ Interface Settings',
        items: [
          {
            id: 'auto_refresh_toggle',
            text: `🔄 Auto Refresh ${settings.autoRefresh ? '✅' : '❌'}`,
            callback_data: 'settings:toggle:auto_refresh',
            icon: '🔄',
            color: settings.autoRefresh ? 'success' : 'secondary'
          },
          {
            id: 'advanced_mode_toggle',
            text: `🚀 Advanced Mode ${settings.advancedMode ? '✅' : '❌'}`,
            callback_data: 'settings:toggle:advanced_mode',
            icon: '🚀',
            color: settings.advancedMode ? 'success' : 'secondary'
          },
          { id: 'theme', text: '🎨 Theme', callback_data: 'settings:theme', icon: '🎨' }
        ],
        layout: 'vertical'
      },
      {
        title: '💰 Currency & Display',
        items: [
          { id: 'currency', text: `💱 Currency: ${settings.currency}`, callback_data: 'settings:currency', icon: '💱' },
          { id: 'language', text: '🌐 Language', callback_data: 'settings:language', icon: '🌐' },
          { id: 'timezone', text: '🕐 Timezone', callback_data: 'settings:timezone', icon: '🕐' }
        ],
        layout: 'vertical'
      },
      {
        items: [
          { id: 'backup_settings', text: '💾 Backup Settings', callback_data: 'settings:backup', icon: '💾' },
          { id: 'reset_settings', text: '🔄 Reset', callback_data: 'settings:reset', icon: '🔄', color: 'warning' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Interactive group management keyboard
  createGroupManagementKeyboard(groups: Array<{
    id: string;
    name: string;
    walletCount: number;
    totalValue: number;
  }>): InlineKeyboardMarkup {
    const groupItems = groups.map(group => ({
      id: group.id,
      text: `${group.name} (${group.walletCount} wallets)`,
      callback_data: `group:select:${group.id}`,
      icon: '👥',
      badge: group.totalValue > 1000 ? '💰' : undefined,
      metadata: { groupId: group.id, name: group.name }
    }));

    const sections: KeyboardSection[] = [
      {
        title: `👥 Groups (${groups.length})`,
        items: groupItems,
        layout: 'vertical'
      },
      {
        items: [
          { id: 'create_group', text: '➕ Create Group', callback_data: 'group:create', icon: '➕', color: 'primary' },
          { id: 'group_templates', text: '📝 Templates', callback_data: 'group:templates', icon: '📝' },
          { id: 'import_groups', text: '📥 Import', callback_data: 'group:import', icon: '📥' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Confirm/cancel keyboard for destructive actions
  createConfirmationKeyboard(action: string, itemDescription: string): InlineKeyboardMarkup {
    const sections: KeyboardSection[] = [
      {
        items: [
          {
            id: 'confirm',
            text: `✅ Yes, ${action}`,
            callback_data: `confirm:${action}`,
            icon: '✅',
            color: 'danger'
          },
          {
            id: 'cancel',
            text: '❌ Cancel',
            callback_data: 'cancel',
            icon: '❌',
            color: 'secondary'
          }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Help and support keyboard
  createHelpKeyboard(): InlineKeyboardMarkup {
    const sections: KeyboardSection[] = [
      {
        title: '📚 Help Topics',
        items: [
          { id: 'getting_started', text: '🚀 Getting Started', callback_data: 'help:getting_started', icon: '🚀' },
          { id: 'wallet_management', text: '👛 Wallet Management', callback_data: 'help:wallets', icon: '👛' },
          { id: 'alerts_guide', text: '🔔 Alerts Guide', callback_data: 'help:alerts', icon: '🔔' },
          { id: 'analytics_guide', text: '📊 Analytics', callback_data: 'help:analytics', icon: '📊' }
        ],
        layout: 'grid'
      },
      {
        title: '💬 Support',
        items: [
          { id: 'contact_support', text: '📞 Contact Support', callback_data: 'help:contact', icon: '📞' },
          { id: 'feature_requests', text: '💡 Feature Requests', callback_data: 'help:features', icon: '💡' },
          { id: 'bug_reports', text: '🐛 Bug Reports', callback_data: 'help:bugs', icon: '🐛' },
          { id: 'community', text: '👥 Community', url: 'https://t.me/your_community', icon: '👥' }
        ],
        layout: 'horizontal'
      }
    ];

    return this.createSectionedKeyboard(sections, {
      type: 'inline',
      layout: 'list'
    });
  }

  // Main keyboard builder method
  private createSectionedKeyboard(
    sections: KeyboardSection[],
    config: KeyboardConfig
  ): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [];

    for (const section of sections) {
      // Add section title as a disabled button if provided
      if (section.title) {
        keyboard.push([{
          text: section.title,
          callback_data: `section:${section.title}`,
          callback_data: undefined // Make it non-clickable
        }]);
      }

      // Process section items based on layout
      if (section.layout === 'horizontal' || config.layout === 'grid') {
        const row: InlineKeyboardButton[] = [];
        for (const item of section.items) {
          row.push(this.createKeyboardButton(item));
        }
        keyboard.push(row);
      } else {
        // Vertical layout - each item in its own row
        for (const item of section.items) {
          keyboard.push([this.createKeyboardButton(item)]);
        }
      }
    }

    // Add navigation buttons if configured
    if (config.backButton) {
      keyboard.push([{
        text: '⬅️ Back',
        callback_data: 'navigation:back'
      }]);
    }

    if (config.refreshButton) {
      keyboard.push([{
        text: '🔄 Refresh',
        callback_data: 'navigation:refresh'
      }]);
    }

    return { inline_keyboard: keyboard };
  }

  private createKeyboardButton(item: KeyboardItem): InlineKeyboardButton {
    const button: InlineKeyboardButton = {
      text: this.formatButtonText(item)
    };

    if (item.callback_data && !item.disabled) {
      button.callback_data = item.callback_data;
    }

    if (item.url) {
      button.url = item.url;
    }

    if (item.disabled) {
      button.callback_data = 'disabled';
    }

    return button;
  }

  private formatButtonText(item: KeyboardItem): string {
    let text = '';

    if (item.icon) {
      text += `${item.icon} `;
    }

    text += item.text;

    if (item.badge) {
      text += ` (${item.badge})`;
    }

    if (item.disabled) {
      text = `❌ ${text}`;
    }

    return text;
  }

  private formatAlertType(type: string): string {
    const typeMap: Record<string, string> = {
      'price_above': 'Price Goes Above',
      'price_below': 'Price Goes Below',
      'change_percent': 'Percentage Change',
      'volume_spike': 'Volume Spike',
      'market_resolution': 'Market Resolution',
      'position_change': 'Position Change'
    };

    return typeMap[type] || type;
  }

  private getAlertTypeIcon(type: string): string {
    const iconMap: Record<string, string> = {
      'price_above': '⬆️',
      'price_below': '⬇️',
      'change_percent': '📈',
      'volume_spike': '📊',
      'market_resolution': '🎯',
      'position_change': '🔄'
    };

    return iconMap[type] || '🔔';
  }

  private getAlertTypeColor(type: string): KeyboardItem['color'] {
    const colorMap: Record<string, KeyboardItem['color']> = {
      'price_above': 'success',
      'price_below': 'warning',
      'change_percent': 'primary',
      'volume_spike': 'danger',
      'market_resolution': 'primary',
      'position_change': 'secondary'
    };

    return colorMap[type] || 'secondary';
  }

  // Utility methods
  parseCallbackData(callbackData: string): {
    action: string;
    params: string[];
    metadata?: Record<string, any>;
  } {
    const parts = callbackData.split(':');
    return {
      action: parts[0],
      params: parts.slice(1),
      metadata: parts.length > 2 ? { id: parts[1], detail: parts[2] } : undefined
    };
  }

  generateKeyboardId(userId: number, type: string, sessionId?: string): string {
    const timestamp = Date.now();
    const sessionPart = sessionId ? `_${sessionId}` : '';
    return `kb_${userId}_${type}${sessionPart}_${timestamp}`;
  }

  // Keyboard state management
  createKeyboardState(userId: number, keyboardId: string, data: any): void {
    // Store keyboard state for handling callbacks
    this.logger.debug('Keyboard state created', {
      userId,
      keyboardId,
      dataType: typeof data
    });
  }

  getKeyboardState(userId: number, keyboardId: string): any {
    // Retrieve keyboard state
    this.logger.debug('Keyboard state retrieved', {
      userId,
      keyboardId
    });
    return null;
  }

  clearKeyboardState(userId: number, keyboardId: string): void {
    // Clear keyboard state
    this.logger.debug('Keyboard state cleared', {
      userId,
      keyboardId
    });
  }
}