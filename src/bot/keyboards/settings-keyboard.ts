import { InlineKeyboardMarkup } from 'telegraf/types';

export function getSettingsKeyboard(preferences: {
  notifications?: boolean;
  language?: string;
  timezone?: string;
}): InlineKeyboardMarkup {
  const notifStatus = preferences.notifications ? '🟢' : '🔴';
  const langDisplay = preferences.language || 'English';
  const tzDisplay = preferences.timezone || 'UTC';

  return {
    inline_keyboard: [
      [
        { text: `${notifStatus} Notifications`, callback_data: 'toggle_notifications' },
        { text: `🌐 ${langDisplay}`, callback_data: 'change_language' }
      ],
      [
        { text: `🕐 ${tzDisplay}`, callback_data: 'change_timezone' },
        { text: `🔔 Alert Types`, callback_data: 'alert_types' }
      ],
      [
        { text: `📊 Data Privacy`, callback_data: 'privacy_settings' },
        { text: `💾 Backup Data`, callback_data: 'backup_data' }
      ],
      [
        { text: `🗑️ Clear Cache`, callback_data: 'clear_cache' },
        { text: `📈 Usage Stats`, callback_data: 'usage_stats' }
      ],
      [
        { text: `🔙 Main Menu`, callback_data: 'main_menu' }
      ]
    ]
  };
}

export function getAlertTypesKeyboard(alerts: {
  transactions?: boolean;
  positions?: boolean;
  resolutions?: boolean;
  priceAlerts?: boolean;
}): InlineKeyboardMarkup {
  const getStatus = (enabled?: boolean) => enabled ? '🟢' : '🔴';

  return {
    inline_keyboard: [
      [
        { text: `${getStatus(alerts.transactions)} Transactions`, callback_data: 'toggle_transactions' },
        { text: `${getStatus(alerts.positions)} Position Changes`, callback_data: 'toggle_positions' }
      ],
      [
        { text: `${getStatus(alerts.resolutions)} Market Resolutions`, callback_data: 'toggle_resolutions' },
        { text: `${getStatus(alerts.priceAlerts)} Price Alerts`, callback_data: 'toggle_price_alerts' }
      ],
      [
        { text: `💰 Minimum Amount`, callback_data: 'set_min_amount' },
        { text: `📊 Percentage Changes`, callback_data: 'set_percentage' }
      ],
      [
        { text: `🔙 Back to Settings`, callback_data: 'open_settings' }
      ]
    ]
  };
}

export function getLanguageKeyboard(currentLanguage: string): InlineKeyboardMarkup {
  const languages = [
    { code: 'en', name: '🇬🇧 English', flag: '🇬🇧' },
    { code: 'es', name: '🇪🇸 Español', flag: '🇪🇸' },
    { code: 'fr', name: '🇫🇷 Français', flag: '🇫🇷' },
    { code: 'de', name: '🇩🇪 Deutsch', flag: '🇩🇪' },
    { code: 'zh', name: '🇨🇳 中文', flag: '🇨🇳' },
    { code: 'ja', name: '🇯🇵 日本語', flag: '🇯🇵' }
  ];

  const keyboard = languages.map(lang => [
    {
      text: `${lang.name}${lang.code === currentLanguage ? ' ✅' : ''}`,
      callback_data: `set_lang_${lang.code}`
    }
  ]);

  keyboard.push([
    { text: '🔙 Back to Settings', callback_data: 'open_settings' }
  ]);

  return { inline_keyboard: keyboard };
}