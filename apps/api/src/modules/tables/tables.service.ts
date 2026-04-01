import { query, queryOne, withTransaction } from '../../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors';
import { createGameState, GameState, addPlayer, removePlayer, startRound, processBootRound, processAction, getPlayerView } from '../game/engine/game-state';
import { createVariant } from '../game/variants';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface TableRecord {
  id: string;
  name: string;
  variant: string;
  min_buy_in: string;
  max_buy_in: string;
  min_bet: string;
  max_bet: string | null;
  max_players: number;
  is_private: boolean;
  status: string;
  created_by: string;
  commission_rate: string;
  created_at: string;
  player_count?: number;
}

// In-memory game state store (would use Redis in production for horizontal scaling)
const activeGames = new Map<string, GameState>();

export async function createTable(data: {
  name: string;
  variant: string;
  minBuyIn: number;
  maxBuyIn: number;
  minBet: number;
  maxBet?: number;
  maxPlayers?: number;
  isPrivate?: boolean;
  commissionRate?: number;
  createdBy: string;
}): Promise<TableRecord> {
  // Validate variant exists
  const variantInstance = createVariant(data.variant);
  const variantConfig = variantInstance.getConfig();

  const maxPlayers = data.maxPlayers || variantConfig.maxPlayers;
  if (maxPlayers < variantConfig.minPlayers || maxPlayers > variantConfig.maxPlayers) {
    throw new ValidationError(
      `Player count must be between ${variantConfig.minPlayers} and ${variantConfig.maxPlayers} for ${data.variant}`
    );
  }

  return withTransaction(async (client) => {
    // Create escrow account for this table
    const escrowResult = await client.query(
      `INSERT INTO chip_accounts (owner_id, account_type, balance) VALUES ($1, 'table_escrow', 0.00) RETURNING id`,
      [data.createdBy]
    );
    const escrowAccountId = escrowResult.rows[0].id;

    const result = await client.query(
      `INSERT INTO game_tables (name, variant, min_buy_in, max_buy_in, min_bet, max_bet, max_players, is_private, created_by, commission_rate, escrow_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.name,
        data.variant,
        data.minBuyIn,
        data.maxBuyIn,
        data.minBet,
        data.maxBet || null,
        maxPlayers,
        data.isPrivate || false,
        data.createdBy,
        data.commissionRate || 0.05,
        escrowAccountId,
      ]
    );

    const table = result.rows[0];

    logger.info('Table created', { tableId: table.id, variant: data.variant, createdBy: data.createdBy });

    return table;
  });
}

export async function getTable(tableId: string): Promise<TableRecord> {
  const table = await queryOne<TableRecord>(
    `SELECT t.*, 
            (SELECT COUNT(*) FROM user_hierarchy_paths WHERE ancestor_id = t.id) as player_count
     FROM game_tables t
     WHERE t.id = $1`,
    [tableId]
  );

  if (!table) {
    throw new NotFoundError('Table');
  }

  return table;
}

export async function listTables(filters: {
  status?: string;
  variant?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ tables: TableRecord[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (filters.variant) {
    params.push(filters.variant);
    conditions.push(`t.variant = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM game_tables t ${whereClause}`,
    params
  );

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  params.push(limit, offset);

  const tables = await query<TableRecord>(
    `SELECT t.* FROM game_tables t ${whereClause} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    tables,
    total: parseInt(countResult[0]?.count ?? '0', 10),
  };
}

export async function closeTable(tableId: string, userId: string): Promise<void> {
  const table = await getTable(tableId);
  if (table.created_by !== userId) {
    throw new ForbiddenError('Only the table creator can close it');
  }

  await query(
    `UPDATE game_tables SET status = 'closed', closed_at = NOW() WHERE id = $1`,
    [tableId]
  );

  // Clean up in-memory state
  activeGames.delete(tableId);

  logger.info('Table closed', { tableId, closedBy: userId });
}

// Game state management (in-memory)
export function getOrCreateGameState(tableId: string, config: {
  variant: string;
  minBet: number;
  maxBet: number;
  maxPlayers: number;
  commissionRate: number;
}): GameState {
  let state = activeGames.get(tableId);
  if (!state) {
    const gameId = uuidv4();
    state = createGameState(gameId, {
      tableId,
      variant: config.variant,
      minBet: config.minBet,
      maxBet: config.maxBet,
      bootAmount: config.minBet,
      maxBlindRounds: 4,
      maxPlayers: config.maxPlayers,
      commissionRate: config.commissionRate,
    });
    activeGames.set(tableId, state);
  }
  return state;
}

export function getGameState(tableId: string): GameState | undefined {
  return activeGames.get(tableId);
}

export function joinTable(tableId: string, userId: string, seatIndex: number, tableConfig: {
  variant: string;
  minBet: number;
  maxBet: number;
  maxPlayers: number;
  commissionRate: number;
}): GameState {
  const state = getOrCreateGameState(tableId, tableConfig);
  addPlayer(state, userId, seatIndex);
  return state;
}

export function leaveTable(tableId: string, userId: string): GameState | undefined {
  const state = activeGames.get(tableId);
  if (state) {
    removePlayer(state, userId);
    if (state.players.size === 0) {
      activeGames.delete(tableId);
      return undefined;
    }
  }
  return state;
}

export function startGame(tableId: string): GameState {
  const state = activeGames.get(tableId);
  if (!state) {
    throw new NotFoundError('Game state');
  }
  startRound(state);
  processBootRound(state);
  return state;
}

export function handleGameAction(
  tableId: string,
  playerId: string,
  actionType: string,
  amount?: number
): { state: GameState; result: { success: boolean; message: string; gameOver?: boolean; winnerId?: string } } {
  const state = activeGames.get(tableId);
  if (!state) {
    throw new NotFoundError('Game state');
  }

  const result = processAction(state, playerId, actionType, amount);
  return { state, result };
}

export function getPlayerGameView(tableId: string, playerId: string): Record<string, unknown> | null {
  const state = activeGames.get(tableId);
  if (!state) return null;
  return getPlayerView(state, playerId);
}

export function getActiveTableCount(): number {
  return activeGames.size;
}
