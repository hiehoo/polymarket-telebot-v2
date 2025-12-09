-- Polymarket Telegram Bot - Initial Database Schema
-- Migration: 001_initial_schema
-- Created: 2025-12-02
-- Description: Creates core tables for user management, wallet tracking, notifications, and system monitoring

-- Enable UUID extension for PostgreSQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table for storing Telegram user information
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_username VARCHAR(255),
    ethereum_address VARCHAR(42),
    is_active BOOLEAN DEFAULT true,
    notification_preferences JSONB DEFAULT '{
      "enabled": true,
      "position_updates": true,
      "transactions": true,
      "resolutions": true,
      "price_alerts": true,
      "large_positions": true,
      "min_position_size": 1000,
      "min_transaction_amount": 100,
      "price_change_threshold": 5
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_notification_at TIMESTAMP WITH TIME ZONE
);

-- Tracked wallets table for monitoring specific wallet addresses
CREATE TABLE IF NOT EXISTS tracked_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    wallet_address VARCHAR(42) NOT NULL,
    alias VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT tracked_wallets_user_wallet_unique UNIQUE (user_id, wallet_address)
);

-- Position alerts table for wallet activity notifications
CREATE TABLE IF NOT EXISTS position_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    condition_id VARCHAR(100) NOT NULL,
    wallet_address VARCHAR(42),
    alert_type VARCHAR(50) NOT NULL, -- 'position_opened', 'position_closed', 'position_size_threshold', 'price_threshold'
    threshold_value BIGINT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    triggered_at TIMESTAMP WITH TIME ZONE
);

-- Transaction alerts table for wallet transaction notifications
CREATE TABLE IF NOT EXISTS transaction_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    wallet_address VARCHAR(42),
    alert_type VARCHAR(50) NOT NULL, -- 'transaction_created', 'transaction_amount_threshold', 'whale_transaction'
    threshold_value BIGINT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    triggered_at TIMESTAMP WITH TIME ZONE
);

-- Notification log table for tracking all sent notifications
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    notification_type VARCHAR(50) NOT NULL, -- 'position', 'transaction', 'resolution', 'price_alert'
    message_text TEXT NOT NULL,
    message_data JSONB,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    delivery_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Market resolutions table for storing resolved market data
CREATE TABLE IF NOT EXISTS market_resolutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    condition_id VARCHAR(100) NOT NULL,
    condition_question TEXT NOT NULL,
    resolution_outcome VARCHAR(100),
    resolution_probability NUMERIC(5, 4),
    resolved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    affected_users UUID[] DEFAULT '{}'
);

-- Wallet activity table for storing all wallet events
CREATE TABLE IF NOT EXISTS wallet_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(42) NOT NULL,
    activity_type VARCHAR(50) NOT NULL, -- 'transaction', 'position_update', 'resolution'
    activity_data JSONB,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    is_processed BOOLEAN DEFAULT false
);

-- User sessions table for managing active sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    session_data JSONB,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- API keys table for managing external API access
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    key_name VARCHAR(100) NOT NULL,
    api_key VARCHAR(255) NOT NULL,
    permissions VARCHAR(100)[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Rate limiting table for preventing abuse
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    request_count INTEGER DEFAULT 0,
    window_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    window_end TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Database health check table for monitoring
CREATE TABLE IF NOT EXISTS database_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    database_url VARCHAR(255),
    redis_url VARCHAR(255),
    database_connected BOOLEAN DEFAULT false,
    redis_connected BOOLEAN DEFAULT false,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER
);

-- Indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_ethereum_address ON users(ethereum_address);
CREATE INDEX IF NOT EXISTS idx_tracked_wallets_user_id ON tracked_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_wallets_address ON tracked_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_activity_address ON wallet_activity(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_activity_occurred_at ON wallet_activity(occurred_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_position_alerts_user_id ON position_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_alerts_user_id ON transaction_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_market_resolutions_condition_id ON market_resolutions(condition_id);

-- Insert initial configuration (idempotent)
INSERT INTO users (telegram_id, is_active, notification_preferences, created_at, updated_at)
VALUES (1, true,
  '{"enabled": true, "position_updates": true, "transactions": true, "resolutions": true, "price_alerts": true, "large_positions": true, "min_position_size": 1000, "min_transaction_amount": 100, "price_change_threshold": 5}',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (telegram_id) DO NOTHING;