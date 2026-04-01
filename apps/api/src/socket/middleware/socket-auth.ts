import { Socket } from 'socket.io';
import { verifyAccessToken } from '../../modules/auth/auth.service';
import { getRedis } from '../../config/redis';
import { logger } from '../../utils/logger';

export interface AuthenticatedSocket extends Socket {
  userId: string;
  username: string;
  userTier: number;
  userPermissions: string;
}

export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('AUTH_REQUIRED'));
    }

    const payload = verifyAccessToken(token);

    // Attach user context to socket
    const authSocket = socket as AuthenticatedSocket;
    authSocket.userId = payload.userId;
    authSocket.username = payload.username;
    authSocket.userTier = payload.tier;
    authSocket.userPermissions = payload.permissions;

    // Track active connection in Redis
    const redis = getRedis();
    const existingSocketId = await redis.get(`user_socket:${payload.userId}`);

    if (existingSocketId && existingSocketId !== socket.id) {
      // Notify previous connection it's being replaced
      socket.to(existingSocketId).emit('session_replaced', {
        message: 'Another device connected with your account',
      });
      logger.info('Previous session replaced', { userId: payload.userId });
    }

    await redis.set(`user_socket:${payload.userId}`, socket.id, 'EX', 86400);

    logger.info('Socket authenticated', { userId: payload.userId, socketId: socket.id });
    next();
  } catch (err) {
    const error = err as Error;
    if (error.message === 'Token expired') {
      return next(new Error('TOKEN_EXPIRED'));
    }
    logger.warn('Socket auth failed', { error: error.message });
    next(new Error('AUTH_FAILED'));
  }
}

// Rate limiter middleware
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function socketRateLimiter(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const authSocket = socket as AuthenticatedSocket;
  const userId = authSocket.userId;
  if (!userId) return next();

  const now = Date.now();
  const limits = rateLimits.get(userId) || { count: 0, resetAt: now + 1000 };

  if (now > limits.resetAt) {
    limits.count = 0;
    limits.resetAt = now + 1000;
  }

  limits.count++;
  rateLimits.set(userId, limits);

  if (limits.count > 30) {
    return next(new Error('RATE_LIMIT_EXCEEDED'));
  }

  next();
}
