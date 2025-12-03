export interface DatabaseUser {
  id: string;
  telegram_id: number;
  telegram_username?: string;
  ethereum_address?: string;
  is_active: boolean;
  notification_preferences: {
    enabled: boolean;
    position_updates: boolean;
    transactions: boolean;
    resolutions: boolean;
    price_alerts: boolean;
    large_positions: boolean;
    min_position_size: number;
    min_transaction_amount: number;
    price_change_threshold: number;
  };
  created_at: Date;
  updated_at: Date;
  last_notification_at?: Date;
}

export interface TrackedWallet {
  id: string;
  user_id: string;
  wallet_address: string;
  alias?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_activity_at?: Date;
}

export interface PositionAlert {
  id: string;
  user_id: string;
  condition_id: string;
  wallet_address?: string;
  alert_type: 'position_opened' | 'position_closed' | 'position_size_threshold' | 'price_threshold';
  threshold_value?: number;
  is_active: boolean;
  created_at: Date;
  triggered_at?: Date;
}

export interface TransactionAlert {
  id: string;
  user_id: string;
  wallet_address?: string;
  alert_type: 'transaction_created' | 'transaction_amount_threshold' | 'whale_transaction';
  threshold_value?: number;
  is_active: boolean;
  created_at: Date;
  triggered_at?: Date;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  notification_type: 'position' | 'transaction' | 'resolution' | 'price_alert';
  message_text: string;
  message_data: any;
  sent_at: Date;
  delivery_status: 'pending' | 'sent' | 'failed';
  error_message?: string;
  retry_count: number;
  created_at: Date;
}

export interface MarketResolution {
  id: string;
  condition_id: string;
  condition_question: string;
  resolution_outcome: string;
  resolution_probability?: number;
  resolved_at: Date;
  affected_users: string[];
}

export interface WalletActivity {
  id: string;
  wallet_address: string;
  activity_type: 'transaction' | 'position_update' | 'resolution';
  activity_data: any;
  occurred_at: Date;
  processed_at?: Date;
  is_processed: boolean;
}

export interface UserSession {
  id: string;
  user_id: string;
  session_data: any;
  expires_at: Date;
  created_at: Date;
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_name: string;
  api_key: string;
  permissions: string[];
  is_active: boolean;
  last_used_at?: Date;
  expires_at?: Date;
  created_at: Date;
}

export interface RateLimit {
  id: string;
  user_id: string;
  request_count: number;
  window_start: Date;
  window_end: Date;
}

export interface DatabaseHealthCheck {
  database_url: string;
  redis_url: string;
  database_connected: boolean;
  redis_connected: boolean;
  timestamp: Date;
  response_time_ms: number;
}