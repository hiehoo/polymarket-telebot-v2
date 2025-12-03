import { InlineKeyboardMarkup } from 'telegraf/types';

export function getWalletActionKeyboard(walletId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📊 Balance', callback_data: `wallet_balance_${walletId}` },
        { text: '📜 History', callback_data: `wallet_history_${walletId}` }
      ],
      [
        { text: '⚙️ Edit', callback_data: `wallet_edit_${walletId}` },
        { text: '🔔 Alerts', callback_data: `wallet_alerts_${walletId}` }
      ],
      [
        { text: '❌ Remove', callback_data: `wallet_remove_${walletId}` }
      ]
    ]
  };
}

export function getWalletListKeyboard(wallets: Array<{id: string; alias?: string; address: string}>): InlineKeyboardMarkup {
  const keyboard = wallets.map(wallet => [
    {
      text: wallet.alias || `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`,
      callback_data: `wallet_select_${wallet.id}`
    }
  ]);

  if (wallets.length > 0) {
    keyboard.push([
      { text: '➕ Add New Wallet', callback_data: 'add_wallet' },
      { text: '⚙️ Manage All', callback_data: 'manage_wallets' }
    ]);
  } else {
    keyboard.push([
      { text: '➕ Add Your First Wallet', callback_data: 'add_wallet' }
    ]);
  }

  keyboard.push([
    { text: '🔙 Main Menu', callback_data: 'main_menu' }
  ]);

  return { inline_keyboard: keyboard };
}

export function getAddWalletKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📷 Scan QR Code', callback_data: 'scan_qr' },
        { text: '📝 Enter Address', callback_data: 'enter_address' }
      ],
      [
        { text: '🔙 Cancel', callback_data: 'cancel_add_wallet' }
      ]
    ]
  };
}

export function getWalletSettingsKeyboard(walletId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🏷️ Set Alias', callback_data: `wallet_alias_${walletId}` },
        { text: '🔔 Configure Alerts', callback_data: `wallet_alerts_${walletId}` }
      ],
      [
        { text: '📊 Update Frequency', callback_data: `wallet_freq_${walletId}` },
        { text: '🔒 Privacy Settings', callback_data: `wallet_privacy_${walletId}` }
      ],
      [
        { text: '🔙 Back', callback_data: 'wallet_list' }
      ]
    ]
  };
}