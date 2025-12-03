import { redisClient } from '../../services/redis/redis-client';
import { BotSession } from '../middleware/session';
import { logger } from '../../utils/logger';

const SESSION_KEY = (userId: number) => `session:${userId}`;

export async function getUserSession(userId: number): Promise<BotSession | null> {
  try {
    const sessionData = await redisClient.get(SESSION_KEY(userId));

    if (!sessionData) {
      return null;
    }

    try {
      const parsed = JSON.parse(sessionData);
      // Validate session structure
      if (!parsed || typeof parsed !== 'object' || !parsed.userId || !parsed.state) {
        logger.warn(`Invalid session structure for user ${userId}`);
        return null;
      }
      return parsed;
    } catch (parseError) {
      logger.error(`Failed to parse session for user ${userId}:`, parseError);
      return null;
    }
  } catch (error) {
    logger.error(`Error getting session for user ${userId}:`, error);
    return null;
  }
}

export async function saveUserSession(session: BotSession): Promise<boolean> {
  try {
    const sessionData = JSON.stringify(session);
    await redisClient.setex(
      SESSION_KEY(session.userId),
      24 * 60 * 60, // 24 hours
      sessionData
    );
    return true;
  } catch (error) {
    logger.error(`Error saving session for user ${session.userId}:`, error);
    return false;
  }
}

export async function updateUserSessionState(
  userId: number,
  state: BotSession['state']
): Promise<boolean> {
  try {
    const session = await getUserSession(userId);
    if (!session) {
      return false;
    }

    session.state = state;
    session.lastActivity = Date.now();

    return await saveUserSession(session);
  } catch (error) {
    logger.error(`Error updating session state for user ${userId}:`, error);
    return false;
  }
}

export async function clearUserSession(userId: number): Promise<boolean> {
  try {
    await redisClient.del(SESSION_KEY(userId));
    return true;
  } catch (error) {
    logger.error(`Error clearing session for user ${userId}:`, error);
    return false;
  }
}

export async function updateUserPreferences(
  userId: number,
  preferences: Partial<BotSession['preferences']>
): Promise<boolean> {
  try {
    const session = await getUserSession(userId);
    if (!session) {
      session = {
        userId,
        preferences: {},
        lastActivity: Date.now(),
        createdAt: Date.now()
      };
    }

    session.preferences = {
      ...session.preferences,
      ...preferences
    };
    session.lastActivity = Date.now();

    return await saveUserSession(session);
  } catch (error) {
    logger.error(`Error updating preferences for user ${userId}:`, error);
    return false;
  }
}