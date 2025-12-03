import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

interface MarketData {
  id: string;
  question: string;
  description: string;
  outcomes: string[];
  volume: number;
  liquidity: number;
  endDate: string;
  resolved: boolean;
  slug?: string;
}

interface WalletPosition {
  marketId: string;
  market: string;
  position: string;
  shares: number;
  value: number;
  pnl: number;
  marketData?: MarketData;
}

export class SimplePolymarketService {
  private baseUrl = config.polymarket.apiUrl;
  private apiKey = config.polymarket.apiKey;

  constructor() {
    logger.info('Initializing Simple Polymarket Service', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey
    });
  }

  async getMarkets(limit = 10): Promise<MarketData[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: { limit, active: true }
      });

      logger.info(`Fetched ${response.data?.length || 0} markets from Polymarket`);

      if (!response.data) {
        return [];
      }

      return response.data.slice(0, limit).map((market: any) => ({
        id: market.id || market.conditionId,
        question: market.question || market.title || 'Unknown Market',
        description: market.description || '',
        outcomes: market.outcomes || ['Yes', 'No'],
        volume: market.volume || 0,
        liquidity: market.liquidity || 0,
        endDate: market.endDate || market.end_date_iso,
        resolved: market.resolved || false
      }));

    } catch (error: any) {
      logger.error('Error fetching markets:', {
        error: error.message,
        status: error.response?.status,
        url: `${this.baseUrl}/markets`
      });
      return [];
    }
  }

  async getWalletPositions(walletAddress: string): Promise<WalletPosition[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/positions`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: { user: walletAddress }
      });

      logger.info(`Fetched positions for wallet ${walletAddress}`, {
        positionCount: response.data?.length || 0
      });

      if (!response.data) {
        return [];
      }

      return response.data.map((position: any) => ({
        marketId: position.market_id || position.id,
        market: position.market?.question || 'Unknown Market',
        position: position.outcome || position.side,
        shares: parseFloat(position.size || position.shares || '0'),
        value: parseFloat(position.value || '0'),
        pnl: parseFloat(position.pnl || '0')
      }));

    } catch (error: any) {
      logger.error('Error fetching wallet positions:', {
        error: error.message,
        status: error.response?.status,
        walletAddress
      });
      return [];
    }
  }

  async getWalletPositionsWithMarketData(walletAddress: string): Promise<WalletPosition[]> {
    try {
      const positions = await this.getWalletPositions(walletAddress);

      logger.info(`Fetching market data for ${positions.length} positions`);

      // Fetch market data for each position
      const positionsWithMarketData = await Promise.all(
        positions.map(async (position) => {
          try {
            const marketData = await this.getMarketDetails(position.marketId);
            return {
              ...position,
              marketData
            };
          } catch (error) {
            logger.warn(`Failed to fetch market data for ${position.marketId}:`, error);
            return position; // Return position without market data if fetch fails
          }
        })
      );

      logger.info(`Successfully enriched ${positionsWithMarketData.filter(p => p.marketData).length}/${positions.length} positions with market data`);

      return positionsWithMarketData;

    } catch (error: any) {
      logger.error('Error fetching wallet positions with market data:', {
        error: error.message,
        status: error.response?.status,
        walletAddress
      });
      return [];
    }
  }

  async getMarketDetails(marketId: string): Promise<MarketData | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets/${marketId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.data) {
        return null;
      }

      const market = response.data;
      return {
        id: market.id || market.conditionId,
        question: market.question || market.title || 'Unknown Market',
        description: market.description || '',
        outcomes: market.outcomes || ['Yes', 'No'],
        volume: market.volume || 0,
        liquidity: market.liquidity || 0,
        endDate: market.endDate || market.end_date_iso,
        resolved: market.resolved || false
      };

    } catch (error: any) {
      logger.error('Error fetching market details:', {
        error: error.message,
        status: error.response?.status,
        marketId
      });
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: { limit: 1 },
        timeout: 5000
      });

      logger.info('Polymarket API health check passed');
      return response.status === 200;

    } catch (error: any) {
      logger.error('Polymarket API health check failed:', {
        error: error.message,
        status: error.response?.status
      });
      return false;
    }
  }
}