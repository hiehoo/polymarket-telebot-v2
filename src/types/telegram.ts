export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  description?: string;
  invite_link?: string;
  pinned_message?: any;
  permissions?: any;
  slow_mode_delay?: number;
  message_auto_delete_time?: number;
  has_protected_content?: boolean;
  sticker_set_name?: string;
  can_set_sticker_set?: boolean;
  linked_chat_id?: number;
  location?: any;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: any[];
  reply_to_message?: TelegramMessage;
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_date?: number;
  photo?: any;
  audio?: any;
  document?: any;
  video?: any;
  animation?: any;
  voice?: any;
  video_note?: any;
  caption?: string;
  contact?: any;
  location?: any;
  venue?: any;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  new_chat_title?: string;
  new_chat_photo?: any;
  delete_chat_photo?: boolean;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  channel_chat_created?: boolean;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  pinned_message?: TelegramMessage;
  invoice?: any;
  successful_payment?: any;
  connected_website?: any;
  passport_data?: any;
  reply_markup?: any;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data: string;
  chat_instance?: string;
  game_short_name?: string;
}

export interface TelegramInlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
  offset?: string;
  chat_type?: 'sender' | 'private' | 'group' | 'supergroup' | 'channel';
  location?: any;
}

export interface TelegramInlineResult {
  type: string;
  id: string;
  title?: string;
  input_message_content?: any;
  description?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  reply_markup?: any;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: any;
  login_url?: any;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
  callback_game?: any;
  pay?: any;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
  input_field_placeholder?: string;
  is_persistent?: boolean;
}

export interface TelegramKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
  request_poll?: any;
  request_users?: any;
  request_chat?: any;
  web_app?: any;
}

export interface TelegramUserPreferences {
  userId: number;
  notifications: {
    enabled: boolean;
    types: {
      positionUpdates: boolean;
      transactions: boolean;
      resolutions: boolean;
      priceAlerts: boolean;
      largePositions: boolean;
    };
    thresholds: {
      minPositionSize: number;
      minTransactionAmount: number;
      priceChangeThreshold: number;
    };
    quietHours?: {
      enabled: boolean;
      start: string;
      end: string;
      timezone: string;
    };
  };
  wallets: string[];
  favorites: string[];
  language: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationData {
  type: 'transaction' | 'position_update' | 'resolution' | 'price_alert' | 'system';
  title: string;
  message: string;
  userId: number;
  priority: 'low' | 'normal' | 'medium' | 'high' | 'urgent';
  metadata?: {
    source?: string;
    timestamp?: number;
    tags?: string[];
    transactionHash?: string;
    amount?: number;
    currency?: string;
    positionChange?: 'opened' | 'increased' | 'decreased' | 'closed';
    previousSize?: number;
    newSize?: number;
    tokenSymbol?: string;
    conditionId?: string;
    resolution?: 'YES' | 'NO' | 'MAYBE';
    outcome?: string;
    price?: number;
    priceChange?: number;
    threshold?: number;
    [key: string]: any;
  };
}

export interface WalletTracking {
  id: string;
  userId: number;
  address: string;
  alias?: string;
  network: 'ethereum' | 'solana' | 'polygon' | 'bsc';
  isActive: boolean;
  alertSettings: {
    transactions: boolean;
    positions: boolean;
    resolutions: boolean;
    priceAlerts: boolean;
    minTransactionAmount: number;
    minPositionChange: number;
  };
  metadata?: {
    tags: string[];
    notes?: string;
    source: 'manual' | 'import' | 'scan';
  };
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
}

export interface UserProfile {
  id: number;
  telegramId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  isPremium: boolean;
  languageCode: string;
  isBot: boolean;
  isActive: boolean;
  plan: 'free' | 'premium' | 'enterprise';
  limits: {
    maxWallets: number;
    maxAlerts: number;
    apiCallsPerHour: number;
  };
  preferences: TelegramUserPreferences;
  wallets: WalletTracking[];
  statistics: {
    totalTrackedWallets: number;
    totalTransactions: number;
    totalVolume: number;
    joinDate: string;
    lastActiveDate: string;
    notificationsSent: number;
  };
  subscription?: {
    status: 'active' | 'expired' | 'cancelled' | 'trial';
    startDate: string;
    endDate: string;
    features: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface CommandContext {
  user: TelegramUser;
  chat: TelegramChat;
  message: TelegramMessage;
  session?: any;
  walletContext?: {
    currentWallet?: WalletTracking;
    walletList: WalletTracking[];
  };
  navigation?: {
    currentPage: string;
    previousPage?: string;
    pageData?: any;
  };
}

export interface BotState {
  command?: string;
  step?: number;
  data?: Record<string, any>;
  tempData?: Record<string, any>;
  expiresAt?: number;
}

export interface UserSession {
  userId: number;
  state: BotState;
  preferences: Partial<TelegramUserPreferences>;
  lastActivity: number;
  createdAt: number;
}