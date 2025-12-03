import { InlineKeyboardMarkup } from 'telegraf/types';

export function getWelcomeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📍 Track Wallet', callback_data: 'track_wallet' },
        { text: '📊 View Stats', callback_data: 'view_stats' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'open_settings' },
        { text: '❓ Help', callback_data: 'show_help' }
      ],
      [
        { text: '📖 Quick Tutorial', callback_data: 'start_tutorial' }
      ]
    ]
  };
}

export function getTutorialKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '▶️ Start Tutorial', callback_data: 'tutorial_start' }
      ],
      [
        { text: '⏭️ Skip Tutorial', callback_data: 'tutorial_skip' }
      ]
    ]
  };
}