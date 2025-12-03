export interface PolymarketPosition {
  id: string;
  user: string;
  conditionId: string;
  outcome: string;
  side: 'YES' | 'NO';
  size: number;
  price: number;
  createdAt: string;
  updatedAt: string;
  status: 'ACTIVE' | 'SETTLED' | 'CANCELLED';
  payouts?: Record<string, number>;
  probability?: number;
  liquidity?: number;
}

export interface PolymarketTransaction {
  id: string;
  user: string;
  from?: string;
  to?: string;
  type: 'BUY' | 'SELL' | 'CANCEL';
  conditionId: string;
  outcome: string;
  amount: number;
  price: number;
  timestamp: string;
  hash: string;
  blockNumber?: number;
  gasUsed?: number;
  fee?: number;
}

export interface PolymarketCondition {
  id: string;
  question: string;
  title?: string;
  description: string;
  outcomes: string[];
  outcome?: string;
  endTime: string;
  resolveTime?: string;
  status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
  active?: boolean;
  category?: string;
  tags?: string[];
  volume?: number;
  volume24h?: number;
  liquidity?: number;
  currentPrice?: number;
  finalPrice?: number;
  collateral?: string;
  questionId?: string;
  outcomesWithPrices?: Array<{
    outcome: string;
    price: number;
    probability: number;
  }>;
  resolution?: {
    outcome: string;
    probability: number;
  };
}

export interface PolymarketUser {
  address: string;
  username?: string;
  firstSeen: string;
  lastSeen: string;
  totalVolume?: number;
  totalProfit?: number;
  winRate?: number;
  activePositions: number;
  settledPositions: number;
}

export interface PolymarketMarketData {
  conditionId: string;
  price: number;
  probability: number;
  volume24h?: number;
  priceChange24h?: number;
  liquidity?: number;
  timestamp: string;
}

export interface PolymarketEvent {
  type: 'POSITION_UPDATE' | 'TRANSACTION' | 'CONDITION_UPDATE' | 'PRICE_UPDATE' | 'RESOLUTION';
  data: {
    position?: PolymarketPosition;
    transaction?: PolymarketTransaction;
    condition?: PolymarketCondition;
    marketData?: PolymarketMarketData;
  };
  timestamp: string | number | Date;
  userId?: number | string;
  conditionId?: string;
}

export interface PolymarketWebSocketMessage {
  event: string;
  data: any;
  timestamp: string;
  channel?: string;
}

export interface PolymarketApiError {
  code: string;
  message: string;
  details?: any;
}

export interface PolymarketPricePoint {
  timestamp: string;
  price: number;
  volume?: number;
  source: 'ORDER_BOOK' | 'LAST_TRADE' | 'ORACLE';
}

export interface PolymarketOrderBook {
  conditionId: string;
  bids: Array<{
    price: number;
    size: number;
    total: number;
  }>;
  asks: Array<{
    price: number;
    size: number;
    total: number;
  }>;
  timestamp: string;
}

export interface PolymarketHistoricalData {
  conditionId: string;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  data: PolymarketPricePoint[];
  startTime: string;
  endTime: string;
}