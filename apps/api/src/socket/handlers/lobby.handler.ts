import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/socket-auth';
import * as tablesService from '../../modules/tables/tables.service';
import { logger } from '../../utils/logger';

export function registerLobbyHandlers(io: Server, socket: AuthenticatedSocket): void {
  // Join lobby for real-time table updates
  socket.on('join_lobby', (data?: { variant?: string }) => {
    const lobbyRoom = data?.variant ? `lobby:${data.variant}` : 'lobby:all';
    socket.join(lobbyRoom);
    socket.emit('lobby_joined', { room: lobbyRoom });
    logger.info('Player joined lobby', { userId: socket.userId, room: lobbyRoom });
  });

  // Leave lobby
  socket.on('leave_lobby', (data?: { variant?: string }) => {
    const lobbyRoom = data?.variant ? `lobby:${data.variant}` : 'lobby:all';
    socket.leave(lobbyRoom);
  });

  // Request table list
  socket.on('list_tables', async (data?: { status?: string; variant?: string }) => {
    try {
      const result = await tablesService.listTables({
        status: data?.status || 'waiting',
        variant: data?.variant,
        limit: 50,
      });
      socket.emit('table_list', result);
    } catch (error) {
      const err = error as Error;
      socket.emit('error', { code: 'LIST_FAILED', message: err.message });
    }
  });
}
