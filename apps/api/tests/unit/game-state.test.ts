import {
  createGameState,
  addPlayer,
  removePlayer,
  startRound,
  processBootRound,
  processAction,
  getCurrentPlayerId,
  getPlayerView,
  GamePhase,
  BettingMode,
  PlayerStatus,
  GameConfig,
} from '../../src/modules/game/engine/game-state';

function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    tableId: 'test-table-1',
    variant: 'classic',
    minBet: 10,
    maxBet: 1000,
    bootAmount: 10,
    maxBlindRounds: 4,
    maxPlayers: 9,
    commissionRate: 0.05,
    ...overrides,
  };
}

describe('Game State Machine', () => {
  describe('createGameState', () => {
    it('should create initial state in WAITING phase', () => {
      const state = createGameState('game-1', makeConfig());
      expect(state.phase).toBe(GamePhase.WAITING);
      expect(state.players.size).toBe(0);
      expect(state.pot).toBe(0);
    });
  });

  describe('addPlayer / removePlayer', () => {
    it('should add players to the game', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      expect(state.players.size).toBe(2);
    });

    it('should reject duplicate player', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      expect(() => addPlayer(state, 'player-1', 1)).toThrow('Player already at table');
    });

    it('should reject taken seat', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      expect(() => addPlayer(state, 'player-2', 0)).toThrow('Seat is taken');
    });

    it('should reject when table is full', () => {
      const state = createGameState('game-1', makeConfig({ maxPlayers: 2 }));
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      expect(() => addPlayer(state, 'player-3', 2)).toThrow('Table is full');
    });

    it('should remove player in waiting phase', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      removePlayer(state, 'player-1');
      expect(state.players.size).toBe(0);
    });
  });

  describe('startRound', () => {
    it('should fail with fewer than 2 players', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      expect(() => startRound(state)).toThrow('Need at least 2 players');
    });

    it('should deal 3 cards to each player', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);

      for (const player of state.players.values()) {
        expect(player.cards.length).toBe(3);
        expect(player.status).toBe(PlayerStatus.ACTIVE);
        expect(player.bettingMode).toBe(BettingMode.BLIND);
      }
    });

    it('should create a valid deck hash', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);

      expect(state.deckHash).toMatch(/^[a-f0-9]{64}$/);
      expect(state.deckEncrypted.length).toBeGreaterThan(0);
    });

    it('should transition to BOOT_ROUND phase', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);
      expect(state.phase).toBe(GamePhase.BOOT_ROUND);
    });
  });

  describe('processBootRound', () => {
    it('should collect boot from all active players', () => {
      const state = createGameState('game-1', makeConfig({ bootAmount: 10 }));
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      addPlayer(state, 'player-3', 2);
      startRound(state);
      processBootRound(state);

      expect(state.pot).toBe(30); // 10 * 3 players
      expect(state.phase).toBe(GamePhase.BETTING);
      expect(state.currentBet).toBe(10);

      for (const player of state.players.values()) {
        expect(player.totalBet).toBe(10);
      }
    });
  });

  describe('processAction', () => {
    function setupBettingGame() {
      const state = createGameState('game-1', makeConfig({ bootAmount: 10, minBet: 10 }));
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      addPlayer(state, 'player-3', 2);
      startRound(state);
      processBootRound(state);
      return state;
    }

    it('should allow blind bet during betting phase', () => {
      const state = setupBettingGame();
      const currentPlayer = getCurrentPlayerId(state)!;

      const result = processAction(state, currentPlayer, 'bet_blind', 10);
      expect(result.success).toBe(true);
      expect(state.pot).toBe(40); // 30 boot + 10 bet
    });

    it('should reject action from wrong player', () => {
      const state = setupBettingGame();
      const currentPlayer = getCurrentPlayerId(state)!;
      const wrongPlayer = state.turnOrder.find((id) => id !== currentPlayer)!;

      const result = processAction(state, wrongPlayer, 'bet_blind', 10);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Not your turn');
    });

    it('should allow fold and advance turn', () => {
      const state = setupBettingGame();
      const currentPlayer = getCurrentPlayerId(state)!;

      const result = processAction(state, currentPlayer, 'fold');
      expect(result.success).toBe(true);
      const player = state.players.get(currentPlayer)!;
      expect(player.status).toBe(PlayerStatus.FOLDED);
    });

    it('should allow seeing cards', () => {
      const state = setupBettingGame();
      const currentPlayer = getCurrentPlayerId(state)!;

      const result = processAction(state, currentPlayer, 'see_cards');
      expect(result.success).toBe(true);
      const player = state.players.get(currentPlayer)!;
      expect(player.bettingMode).toBe(BettingMode.SEEN);
      expect(player.handEvaluation).toBeDefined();
    });

    it('should end game when only one player remains after folds', () => {
      const state = createGameState('game-1', makeConfig({ bootAmount: 10, minBet: 10 }));
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);
      processBootRound(state);

      const firstPlayer = getCurrentPlayerId(state)!;
      const result = processAction(state, firstPlayer, 'fold');

      expect(result.success).toBe(true);
      expect(result.gameOver).toBe(true);
      expect(result.winnerId).toBeDefined();
    });

    it('should allow show when 2 players remain', () => {
      const state = createGameState('game-1', makeConfig({ bootAmount: 10, minBet: 10 }));
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);
      processBootRound(state);

      const player1 = getCurrentPlayerId(state)!;
      // See cards first (required for show)
      processAction(state, player1, 'see_cards');
      // Bet as seen player
      processAction(state, player1, 'bet_seen', 20);

      const player2 = getCurrentPlayerId(state)!;
      processAction(state, player2, 'see_cards');
      // Request show
      const result = processAction(state, player2, 'show');

      expect(result.success).toBe(true);
      expect(result.gameOver).toBe(true);
      expect(result.winnerId).toBeDefined();
    });
  });

  describe('getPlayerView', () => {
    it('should hide other players\' cards during betting', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);
      processBootRound(state);

      const view = getPlayerView(state, 'player-1');
      const players = view.players as Array<{ userId: string; cards?: unknown }>;

      for (const p of players) {
        if (p.userId === 'player-1') {
          // Own cards hidden until seen
          expect(p.cards).toBeUndefined();
        } else {
          expect(p.cards).toBeUndefined();
        }
      }
    });

    it('should show own cards after seeing', () => {
      const state = createGameState('game-1', makeConfig());
      addPlayer(state, 'player-1', 0);
      addPlayer(state, 'player-2', 1);
      startRound(state);
      processBootRound(state);

      // Player 1 sees their cards
      const player1 = state.players.get('player-1')!;
      player1.bettingMode = BettingMode.SEEN;

      const view = getPlayerView(state, 'player-1');
      expect(view.myCards).toBeDefined();
    });
  });
});
