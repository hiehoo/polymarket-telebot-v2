/**
 * Session Manager for Telegram Bot Users
 * Manages user sessions with Redis, including storage, retrieval, and cleanup
 */

import { redisClient } from './redis-client';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';
import { sessionConfig, redisKeys, ttl } from '@/config/redis';
import type {
  UserSession,
  SessionConfig,
  RedisResult,
} from '@/types/redis';

export class SessionManager {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private sessionIndex = new Map<number, string>(); // In-memory index for quick lookups
  private isInitialized = false;

  /**
   * Initialize the session manager
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        return;
      }

      // Load existing sessions into memory index
      await this.loadSessionIndex();

      // Start cleanup interval
      this.startCleanupInterval();

      this.isInitialized = true;
      logger.info('Session manager initialized', {
        cleanupInterval: sessionConfig.cleanupInterval,
        maxSessions: sessionConfig.maxSessions,
        defaultTtl: sessionConfig.defaultTtl,
      });

    } catch (error) {
      logger.error('Failed to initialize session manager', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Create or update a user session
   */
  async createOrUpdateSession(userId: number, sessionData: Partial<UserSession>): Promise<UserSession> {
    try {
      const existingSession = await this.getSession(userId);

      const session: UserSession = existingSession ? {
        ...existingSession,
        ...sessionData,
        lastActivity: Date.now(),
      } : {
        telegramUserId: userId,
        username: sessionData.username,
        firstName: sessionData.firstName,
        lastName: sessionData.lastName,
        languageCode: sessionData.languageCode,
        isActive: sessionData.isActive ?? true,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        preferences: sessionData.preferences || this.getDefaultPreferences(),
        metadata: sessionData.metadata || {},
      };

      // Validate session data
      this.validateSessionData(session);

      // Check session limit
      await this.checkSessionLimit();

      // Store in Redis
      const sessionKey = redisKeys.session(userId);
      const serializedSession = await this.serializeSession(session);

      await redisClient.set(sessionKey, serializedSession, sessionConfig.defaultTtl);

      // Update session index
      await this.updateSessionIndex(userId, sessionKey);

      // Update in-memory index
      this.sessionIndex.set(userId, sessionKey);

      logger.debug('Session created/updated', {
        userId,
        isActive: session.isActive,
        lastActivity: new Date(session.lastActivity).toISOString(),
        isNew: !existingSession,
      });

      return session;

    } catch (error) {
      logger.error('Failed to create/update session', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to create session for user ${userId}`,
        ErrorType.DATABASE,
        500
      );
    }
  }

  /**
   * Get a user session
   */
  async getSession(userId: number): Promise<UserSession | null> {
    try {
      const sessionKey = redisKeys.session(userId);
      const sessionData = await redisClient.get(sessionKey);

      if (!sessionData) {
        return null;
      }

      const session = await this.deserializeSession(sessionData);

      // Update last activity
      await this.updateLastActivity(userId);

      logger.debug('Session retrieved', {
        userId,
        isActive: session.isActive,
        lastActivity: new Date(session.lastActivity).toISOString(),
      });

      return session;

    } catch (error) {
      logger.error('Failed to get session', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Update specific fields in a user session
   */
  async updateSessionFields(userId: number, updates: Partial<UserSession>): Promise<boolean> {
    try {
      const session = await this.getSession(userId);

      if (!session) {
        logger.warn('Session not found for update', { userId });
        return false;
      }

      const updatedSession = {
        ...session,
        ...updates,
        lastActivity: Date.now(),
      };

      await this.createOrUpdateSession(userId, updatedSession);

      logger.debug('Session fields updated', {
        userId,
        updatedFields: Object.keys(updates),
      });

      return true;

    } catch (error) {
      logger.error('Failed to update session fields', {
        userId,
        updates,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId: number, preferences: Partial<UserSession['preferences']>): Promise<boolean> {
    try {
      const session = await this.getSession(userId);

      if (!session) {
        logger.warn('Session not found for preference update', { userId });
        return false;
      }

      const updatedPreferences = {
        ...session.preferences,
        ...preferences,
      };

      return await this.updateSessionFields(userId, { preferences: updatedPreferences });

    } catch (error) {
      logger.error('Failed to update preferences', {
        userId,
        preferences,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Add a wallet to user's tracked wallets
   */
  async addTrackedWallet(userId: number, walletAddress: string): Promise<boolean> {
    try {
      const session = await this.getSession(userId);

      if (!session) {
        logger.warn('Session not found for wallet addition', { userId });
        return false;
      }

      const normalizedWallet = walletAddress.toLowerCase().trim();

      if (!this.isValidWalletAddress(normalizedWallet)) {
        throw new AppError('Invalid wallet address format', ErrorType.VALIDATION);
      }

      const wallets = new Set(session.preferences.wallets.map(w => w.toLowerCase()));

      if (wallets.has(normalizedWallet)) {
        logger.debug('Wallet already tracked', { userId, wallet: normalizedWallet });
        return true;
      }

      wallets.add(normalizedWallet);
      const updatedWallets = Array.from(wallets);

      return await this.updatePreferences(userId, {
        wallets: updatedWallets,
      });

    } catch (error) {
      logger.error('Failed to add tracked wallet', {
        userId,
        walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Remove a wallet from user's tracked wallets
   */
  async removeTrackedWallet(userId: number, walletAddress: string): Promise<boolean> {
    try {
      const session = await this.getSession(userId);

      if (!session) {
        logger.warn('Session not found for wallet removal', { userId });
        return false;
      }

      const normalizedWallet = walletAddress.toLowerCase().trim();
      const wallets = session.preferences.wallets.filter(w => w.toLowerCase() !== normalizedWallet);

      return await this.updatePreferences(userId, {
        wallets,
      });

    } catch (error) {
      logger.error('Failed to remove tracked wallet', {
        userId,
        walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get user's tracked wallets
   */
  async getTrackedWallets(userId: number): Promise<string[]> {
    try {
      const session = await this.getSession(userId);

      if (!session) {
        return [];
      }

      return [...session.preferences.wallets];

    } catch (error) {
      logger.error('Failed to get tracked wallets', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Deactivate a user session
   */
  async deactivateSession(userId: number): Promise<boolean> {
    try {
      return await this.updateSessionFields(userId, { isActive: false });

    } catch (error) {
      logger.error('Failed to deactivate session', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Activate a user session
   */
  async activateSession(userId: number): Promise<boolean> {
    try {
      return await this.updateSessionFields(userId, { isActive: true });

    } catch (error) {
      logger.error('Failed to activate session', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Delete a user session
   */
  async deleteSession(userId: number): Promise<boolean> {
    try {
      const sessionKey = redisKeys.session(userId);

      await redisClient.del(sessionKey);

      // Remove from indexes
      await this.removeFromSessionIndex(userId);
      this.sessionIndex.delete(userId);

      logger.debug('Session deleted', { userId });
      return true;

    } catch (error) {
      logger.error('Failed to delete session', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get all active sessions
   */
  async getActiveSessions(): Promise<UserSession[]> {
    try {
      const activeSessions: UserSession[] = [];

      for (const [userId] of this.sessionIndex) {
        const session = await this.getSession(userId);
        if (session && session.isActive) {
          activeSessions.push(session);
        }
      }

      return activeSessions;

    } catch (error) {
      logger.error('Failed to get active sessions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    withWallets: number;
    averageSessionAge: number;
  }> {
    try {
      const sessions: UserSession[] = [];

      for (const [userId] of this.sessionIndex) {
        const session = await this.getSession(userId);
        if (session) {
          sessions.push(session);
        }
      }

      const now = Date.now();
      const total = sessions.length;
      const active = sessions.filter(s => s.isActive).length;
      const inactive = total - active;
      const withWallets = sessions.filter(s => s.preferences.wallets.length > 0).length;

      const averageSessionAge = total > 0
        ? sessions.reduce((sum, s) => sum + (now - s.createdAt), 0) / total
        : 0;

      return {
        total,
        active,
        inactive,
        withWallets,
        averageSessionAge,
      };

    } catch (error) {
      logger.error('Failed to get session stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        total: 0,
        active: 0,
        inactive: 0,
        withWallets: 0,
        averageSessionAge: 0,
      };
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      let cleanedCount = 0;
      const now = Date.now();
      const expiredUsers: number[] = [];

      // Find expired sessions
      for (const [userId, sessionKey] of this.sessionIndex) {
        try {
          const ttl = await redisClient.ttl(sessionKey);
          if (ttl === -1 || ttl === -2) {
            // No TTL set or key doesn't exist, check manually
            const session = await this.getSession(userId);
            if (!session || (now - session.lastActivity) > sessionConfig.defaultTtl * 1000) {
              expiredUsers.push(userId);
            }
          }
        } catch (error) {
          // If we can't check TTL, assume expired
          expiredUsers.push(userId);
        }
      }

      // Clean up expired sessions
      for (const userId of expiredUsers) {
        const success = await this.deleteSession(userId);
        if (success) {
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info('Cleaned up expired sessions', {
          cleanedCount,
          remainingSessions: this.sessionIndex.size,
        });
      }

      return cleanedCount;

    } catch (error) {
      logger.error('Failed to cleanup expired sessions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Private helper methods
   */
  private getDefaultPreferences(): UserSession['preferences'] {
    return {
      notifications: {
        positions: true,
        transactions: true,
        resolutions: true,
        priceAlerts: true,
        marketUpdates: false,
      },
      thresholds: {
        minPositionSize: 100, // $100 USD
        maxPositionSize: 100000, // $100,000 USD
        priceChangePercent: 5, // 5%
      },
      wallets: [],
    };
  }

  private validateSessionData(session: UserSession): void {
    if (!session.telegramUserId || session.telegramUserId <= 0) {
      throw new AppError('Invalid Telegram user ID', ErrorType.VALIDATION);
    }

    if (session.preferences.wallets.some(wallet => !this.isValidWalletAddress(wallet))) {
      throw new AppError('Invalid wallet address in preferences', ErrorType.VALIDATION);
    }

    if (session.preferences.thresholds.minPositionSize < 0 ||
        session.preferences.thresholds.maxPositionSize < 0 ||
        session.preferences.thresholds.priceChangePercent < 0) {
      throw new AppError('Invalid threshold values', ErrorType.VALIDATION);
    }
  }

  private isValidWalletAddress(address: string): boolean {
    // Basic Ethereum address validation
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  private async checkSessionLimit(): Promise<void> {
    if (this.sessionIndex.size >= sessionConfig.maxSessions) {
      // Clean up expired sessions first
      await this.cleanupExpiredSessions();

      // Still over limit?
      if (this.sessionIndex.size >= sessionConfig.maxSessions) {
        throw new AppError(
          'Maximum session limit reached',
          ErrorType.RATE_LIMIT,
          429
        );
      }
    }
  }

  private async updateLastActivity(userId: number): Promise<void> {
    try {
      const sessionKey = redisKeys.session(userId);
      // Extend TTL and update last activity timestamp in hash
      await redisClient.expire(sessionKey, sessionConfig.defaultTtl);
      await redisClient.hset(sessionKey, 'lastActivity', Date.now().toString());
    } catch (error) {
      logger.warn('Failed to update last activity', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async loadSessionIndex(): Promise<void> {
    try {
      // Scan for session keys
      const pattern = `${sessionConfig.keyPrefix}*`;
      const keys = await redisClient.scan('0', 'MATCH', pattern, 'COUNT', 1000);

      for (const sessionKey of keys[1]) {
        const userId = parseInt(sessionKey.split(':').pop() || '0');
        if (userId > 0) {
          this.sessionIndex.set(userId, sessionKey);
        }
      }

      logger.info('Session index loaded', {
        totalSessions: this.sessionIndex.size,
      });

    } catch (error) {
      logger.error('Failed to load session index', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async updateSessionIndex(userId: number, sessionKey: string): Promise<void> {
    try {
      await redisClient.sadd(redisKeys.sessionIndex('users'), userId.toString());
    } catch (error) {
      logger.warn('Failed to update session index', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async removeFromSessionIndex(userId: number): Promise<void> {
    try {
      await redisClient.srem(redisKeys.sessionIndex('users'), userId.toString());
    } catch (error) {
      logger.warn('Failed to remove from session index', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        logger.error('Cleanup interval error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, sessionConfig.cleanupInterval);
  }

  private async serializeSession(session: UserSession): Promise<string> {
    const data = {
      ...session,
      // Convert dates to numbers for Redis storage
      lastActivity: session.lastActivity,
      createdAt: session.createdAt,
    };

    if (sessionConfig.encryption) {
      // TODO: Implement encryption
      logger.warn('Session encryption not implemented yet');
    }

    if (sessionConfig.compression) {
      // TODO: Implement compression
      logger.warn('Session compression not implemented yet');
    }

    return JSON.stringify(data);
  }

  private async deserializeSession(serializedData: string): Promise<UserSession> {
    try {
      const data = JSON.parse(serializedData);
      return data as UserSession;
    } catch (error) {
      throw new AppError('Invalid session data format', ErrorType.DATABASE);
    }
  }

  /**
   * Shutdown the session manager
   */
  async shutdown(): Promise<void> {
    try {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      this.sessionIndex.clear();
      this.isInitialized = false;

      logger.info('Session manager shutdown successfully');

    } catch (error) {
      logger.error('Error during session manager shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// Create and export singleton instance
export const sessionManager = new SessionManager();

// Export types and utilities
export { SessionManager };