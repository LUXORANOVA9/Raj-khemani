import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/socket-auth';
import * as tablesService from '../../modules/tables/tables.service';
import { getPlayerView } from '../../modules/game/engine/game-state';
import { logger } from '../../utils/logger';

export function registerGameHandlers(io: Server, socket: AuthenticatedSocket): void {
  const userId = socket.userId;

  // Join a table
  socket.on('join_table', async (data: { tableId: string; seatIndex: number }) => {
    try {
      const { tableId, seatIndex } = data;

      // Get table info from DB
      const table = await tablesService.getTable(tableId);

      // Join the game state
      const state = tablesService.joinTable(tableId, userId, seatIndex, {
        variant: table.variant,
        minBet: parseFloat(table.min_bet),
        maxBet: parseFloat(table.max_bet || table.min_bet),
        maxPlayers: table.max_players,
        commissionRate: parseFloat(table.commission_rate),
      });

      // Join Socket.IO room
      socket.join(`table:${tableId}`);

      // Send current game state to joining player
      const playerView = getPlayerView(state, userId);
      socket.emit('table_state', playerView);

      // Notify others
      socket.to(`table:${tableId}`).emit('player_joined', {
        userId,
        username: socket.username,
        seatIndex,
        playerCount: state.players.size,
      });

      logger.info('Player joined table', { userId, tableId, seatIndex });
    } catch (error) {
      const err = error as Error;
      socket.emit('error', { code: 'JOIN_FAILED', message: err.message });
    }
  });

  // Leave a table
  socket.on('leave_table', (data: { tableId: string }) => {
    try {
      const { tableId } = data;

      const state = tablesService.leaveTable(tableId, userId);

      socket.leave(`table:${tableId}`);

      // Notify remaining players
      socket.to(`table:${tableId}`).emit('player_left', {
        userId,
        username: socket.username,
        playerCount: state?.players.size ?? 0,
      });

      logger.info('Player left table', { userId, tableId });
    } catch (error) {
      const err = error as Error;
      socket.emit('error', { code: 'LEAVE_FAILED', message: err.message });
    }
  });

  // Start game (table creator or admin)
  socket.on('start_game', (data: { tableId: string }) => {
    try {
      const { tableId } = data;

      const state = tablesService.startGame(tableId);

      // Broadcast game started to the room
      io.to(`table:${tableId}`).emit('game_started', {
        pot: state.pot,
        currentBet: state.currentBet,
        roundNumber: state.roundNumber,
        phase: state.phase,
      });

      // Send individual card views to each player
      for (const [playerId] of state.players) {
        const playerView = getPlayerView(state, playerId);
        // Find the socket for this player in the room
        const roomSockets = io.sockets.adapter.rooms.get(`table:${tableId}`);
        if (roomSockets) {
          for (const socketId of roomSockets) {
            const s = io.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
            if (s && s.userId === playerId) {
              s.emit('table_state', playerView);
            }
          }
        }
      }

      logger.info('Game started', { tableId, roundNumber: state.roundNumber });
    } catch (error) {
      const err = error as Error;
      socket.emit('error', { code: 'START_FAILED', message: err.message });
    }
  });

  // Game action (bet, fold, show, sideshow, see cards)
  socket.on('game_action', (data: { tableId: string; action: string; amount?: number }) => {
    try {
      const { tableId, action, amount } = data;

      const { state, result } = tablesService.handleGameAction(tableId, userId, action, amount);

      if (result.success) {
        // Broadcast action to all players at table
        io.to(`table:${tableId}`).emit('action_performed', {
          playerId: userId,
          action,
          amount,
          pot: state.pot,
          currentBet: state.currentBet,
          phase: state.phase,
          message: result.message,
        });

        // Send updated views to each player
        const roomSockets = io.sockets.adapter.rooms.get(`table:${tableId}`);
        if (roomSockets) {
          for (const socketId of roomSockets) {
            const s = io.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
            if (s && s.userId) {
              const playerView = getPlayerView(state, s.userId);
              s.emit('table_state', playerView);
            }
          }
        }

        // Handle game over
        if (result.gameOver) {
          io.to(`table:${tableId}`).emit('game_over', {
            winnerId: result.winnerId,
            pot: state.pot,
            message: result.message,
          });
        }
      } else {
        socket.emit('action_rejected', {
          action,
          reason: result.message,
        });
      }
    } catch (error) {
      const err = error as Error;
      socket.emit('error', { code: 'ACTION_FAILED', message: err.message });
    }
  });

  // Chat message at table
  socket.on('table_chat', (data: { tableId: string; message: string }) => {
    const { tableId, message } = data;

    // Sanitize and limit message length
    const sanitized = message.substring(0, 200).trim();
    if (!sanitized) return;

    io.to(`table:${tableId}`).emit('chat_message', {
      userId,
      username: socket.username,
      message: sanitized,
      timestamp: Date.now(),
    });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    logger.info('Socket disconnected', { userId, reason, socketId: socket.id });

    // Note: We don't auto-remove from tables on disconnect
    // because the player might reconnect. A timeout mechanism
    // would handle truly disconnected players.
  });
}
