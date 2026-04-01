import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { env } from '../config/env';
import { socketAuthMiddleware, AuthenticatedSocket } from './middleware/socket-auth';
import { registerGameHandlers } from './handlers/game.handler';
import { registerLobbyHandlers } from './handlers/lobby.handler';
import { registerAdminHandlers, startAdminMetricsBroadcast } from './handlers/admin.handler';
import { logger } from '../utils/logger';

let io: Server | null = null;

export async function setupSocketIO(httpServer: HttpServer): Promise<Server> {
  io = new Server(httpServer, {
    cors: {
      origin: env.SOCKET_CORS_ORIGINS.split(','),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: env.SOCKET_PING_INTERVAL,
    pingTimeout: env.SOCKET_PING_TIMEOUT,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6, // 1MB max message size
  });

  // Set up Redis adapter for horizontal scaling
  try {
    const pubClient = new Redis(env.REDIS_URL);
    const subClient = pubClient.duplicate();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    io.adapter(createAdapter(pubClient as any, subClient as any));
    logger.info('Socket.IO Redis adapter connected');
  } catch (error) {
    logger.warn('Redis adapter setup failed, running in single-node mode', {
      error: (error as Error).message,
    });
  }

  // Authentication middleware
  io.use(socketAuthMiddleware);

  // Connection handler
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;

    logger.info('Client connected', {
      userId: authSocket.userId,
      socketId: socket.id,
      tier: authSocket.userTier,
    });

    // Register all event handlers
    registerGameHandlers(io!, authSocket);
    registerLobbyHandlers(io!, authSocket);
    registerAdminHandlers(io!, authSocket);

    // Emit connection success
    socket.emit('connected', {
      userId: authSocket.userId,
      username: authSocket.username,
      tier: authSocket.userTier,
    });
  });

  // Start admin metrics broadcast
  startAdminMetricsBroadcast(io);

  const connectedCount = io.engine?.clientsCount ?? 0;
  logger.info('Socket.IO server initialized', { connectedCount });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}
