import { InlineKeyboardMarkup } from 'telegraf/types';

export function getHelpKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📍 Tracking Wallets', callback_data: 'help_track' },
        { text: '🔔 Alert Settings', callback_data: 'help_alerts' }
      ],
      [
        { text: '⚙️ Configuration', callback_data: 'help_settings' },
        { text: '📊 Data & Stats', callback_data: 'help_stats' }
      ],
      [
        { text: '🔍 Advanced Features', callback_data: 'help_advanced' },
        { text: '❓ FAQ', callback_data: 'help_faq' }
      ],
      [
        { text: '🏠 Main Menu', callback_data: 'main_menu' }
      ]
    ]
  };
}

export function getBackToHelpKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🔙 Back to Help', callback_data: 'help_main' }
      ]
    ]
  };
}

export function getAdvancedHelpKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🔍 Search Transactions', callback_data: 'help_search' },
        { text: '📤 Export Data', callback_data: 'help_export' }
      ],
      [
        { text: '📈 Market Analysis', callback_data: 'help_analysis' },
        { text: '🔗 API Integration', callback_data: 'help_api' }
      ],
      [
        { text: '🔙 Back to Help', callback_data: 'help_main' }
      ]
    ]
  };
}