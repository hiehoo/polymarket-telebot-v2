-- Smart Wallet Scanner - Database Schema
-- Migration: 002_smart_wallet_scanner
-- Created: 2025-12-09
-- Description: Tables for smart wallet tracking and consensus signal detection

-- Smart wallets (predefined list of wallets to monitor)
CREATE TABLE IF NOT EXISTS smart_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) UNIQUE NOT NULL,
    alias VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Position snapshots (daily positions for each smart wallet)
CREATE TABLE IF NOT EXISTS smart_wallet_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES smart_wallets(id) ON DELETE CASCADE,
    condition_id VARCHAR(100) NOT NULL,
    market_title TEXT,
    market_slug TEXT,
    yes_shares NUMERIC(20,6) DEFAULT 0,
    no_shares NUMERIC(20,6) DEFAULT 0,
    yes_value NUMERIC(20,2) DEFAULT 0,
    no_value NUMERIC(20,2) DEFAULT 0,
    net_shares NUMERIC(20,6) GENERATED ALWAYS AS (yes_shares - no_shares) STORED,
    net_value NUMERIC(20,2) GENERATED ALWAYS AS (yes_value - no_value) STORED,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_wallet_market_date UNIQUE (wallet_id, condition_id, snapshot_date)
);

-- Consensus signals (detected when 3+ wallets agree on same side)
CREATE TABLE IF NOT EXISTS consensus_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    condition_id VARCHAR(100) NOT NULL,
    market_title TEXT NOT NULL,
    market_slug TEXT,
    consensus_side VARCHAR(3) NOT NULL CHECK (consensus_side IN ('YES', 'NO')),
    wallet_count INT NOT NULL,
    total_value NUMERIC(20,2) NOT NULL,
    wallets JSONB NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_consensus_per_day UNIQUE (condition_id, consensus_side, (detected_at::DATE))
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_smart_wallets_active ON smart_wallets(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_smart_wallet_positions_date ON smart_wallet_positions(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_smart_wallet_positions_condition ON smart_wallet_positions(condition_id);
CREATE INDEX IF NOT EXISTS idx_smart_wallet_positions_wallet ON smart_wallet_positions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_consensus_signals_detected ON consensus_signals(detected_at);
CREATE INDEX IF NOT EXISTS idx_consensus_signals_notified ON consensus_signals(notified_at) WHERE notified_at IS NULL;
