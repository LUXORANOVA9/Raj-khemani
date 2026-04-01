import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/socket-auth';
import * as tablesService from '../../modules/tables/tables.service';
import { UserTier } from '../../utils/permissions';
import { logger } from '../../utils/logger';

// Track connected admin sockets for dashboard updates
const adminSockets = new Set<string>();

export function registerAdminHandlers(io: Server, socket: AuthenticatedSocket): void {
  // Only allow admin-tier users
  if (socket.userTier > UserTier.ADMIN) {
    return;
  }

  // Join admin monitoring feed
  socket.on('join_admin_feed', () => {
    socket.join('admin:live_feed');
    adminSockets.add(socket.id);

    // Send initial dashboard state
    socket.emit('dashboard_state', {
      activeTables: tablesService.getActiveTableCount(),
      onlineAdmins: adminSockets.size,
      timestamp: Date.now(),
    });

    logger.info('Admin joined feed', { userId: socket.userId, tier: socket.userTier });
  });

  socket.on('leave_admin_feed', () => {
    socket.leave('admin:live_feed');
    adminSockets.delete(socket.id);
  });

  // Observe a specific table (spectator mode for admins)
  socket.on('observe_table', (data: { tableId: string }) => {
    socket.join(`table:${data.tableId}:observers`);
    const state = tablesService.getGameState(data.tableId);
    if (state) {
      // Admins get full state (all cards visible)
      socket.emit('observed_table_state', {
        gameId: state.id,
        phase: state.phase,
        pot: state.pot,
        currentBet: state.currentBet,
        players: Array.from(state.players.values()).map((p) => ({
          userId: p.userId,
          seatIndex: p.seatIndex,
          status: p.status,
          bettingMode: p.bettingMode,
          totalBet: p.totalBet,
          cards: p.cards, // Admins see all cards
        })),
      });
    }
  });

  socket.on('stop_observing', (data: { tableId: string }) => {
    socket.leave(`table:${data.tableId}:observers`);
  });

  // Handle admin disconnect
  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
  });
}

// Periodic admin dashboard metrics broadcast
export function startAdminMetricsBroadcast(io: Server): NodeJS.Timeout {
  return setInterval(() => {
    if (adminSockets.size > 0) {
      io.to('admin:live_feed').emit('metrics_update', {
        activeTables: tablesService.getActiveTableCount(),
        onlineAdmins: adminSockets.size,
        timestamp: Date.now(),
      });
    }
  }, 5000); // Every 5 seconds
}
