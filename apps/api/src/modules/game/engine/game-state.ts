import { Card, createDeck, shuffleDeck, hashDeck, encryptDeck } from './cards';
import { evaluateHand, compareHands, HandEvaluation } from './hand-evaluator';

export enum GamePhase {
  WAITING = 'waiting',
  DEALING = 'dealing',
  BOOT_ROUND = 'boot_round',
  BETTING = 'betting',
  SHOWDOWN = 'showdown',
  SETTLEMENT = 'settlement',
  FINISHED = 'finished',
}

export enum PlayerStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  FOLDED = 'folded',
  PACKED = 'packed', // Same as fold in Teen Patti
}

export enum BettingMode {
  BLIND = 'blind',
  SEEN = 'seen',
}

export interface PlayerState {
  userId: string;
  seatIndex: number;
  cards: Card[];
  status: PlayerStatus;
  bettingMode: BettingMode;
  totalBet: number;
  isDealer: boolean;
  blindRoundsPlayed: number;
  handEvaluation?: HandEvaluation;
}

export interface GameAction {
  type: 'boot' | 'bet_blind' | 'bet_seen' | 'see_cards' | 'fold' | 'show' | 'sideshow_request' | 'sideshow_accept' | 'sideshow_reject';
  playerId: string;
  amount?: number;
  timestamp: number;
  sequenceNumber: number;
}

export interface GameConfig {
  tableId: string;
  variant: string;
  minBet: number;
  maxBet: number;
  bootAmount: number;
  maxBlindRounds: number;
  maxPlayers: number;
  commissionRate: number;
}

export interface GameState {
  id: string;
  config: GameConfig;
  phase: GamePhase;
  players: Map<string, PlayerState>;
  deck: Card[];
  deckHash: string;
  deckEncrypted: string;
  pot: number;
  currentBet: number;
  currentPlayerIndex: number;
  dealerIndex: number;
  roundNumber: number;
  actions: GameAction[];
  turnOrder: string[]; // User IDs in turn order
  sequenceCounter: number;
  createdAt: number;
  sideshowPending?: {
    requesterId: string;
    targetId: string;
  };
}

const DECK_ENCRYPTION_SECRET = process.env.DECK_ENCRYPTION_SECRET || 'dev-secret-for-deck-encryption';

export function createGameState(gameId: string, config: GameConfig): GameState {
  return {
    id: gameId,
    config,
    phase: GamePhase.WAITING,
    players: new Map(),
    deck: [],
    deckHash: '',
    deckEncrypted: '',
    pot: 0,
    currentBet: config.minBet,
    currentPlayerIndex: 0,
    dealerIndex: 0,
    roundNumber: 0,
    actions: [],
    turnOrder: [],
    sequenceCounter: 0,
    createdAt: Date.now(),
  };
}

export function addPlayer(state: GameState, userId: string, seatIndex: number): void {
  if (state.players.size >= state.config.maxPlayers) {
    throw new Error('Table is full');
  }
  if (state.phase !== GamePhase.WAITING && state.phase !== GamePhase.FINISHED) {
    throw new Error('Cannot join during active game');
  }
  if (state.players.has(userId)) {
    throw new Error('Player already at table');
  }

  // Check seat is free
  for (const player of state.players.values()) {
    if (player.seatIndex === seatIndex) {
      throw new Error('Seat is taken');
    }
  }

  state.players.set(userId, {
    userId,
    seatIndex,
    cards: [],
    status: PlayerStatus.WAITING,
    bettingMode: BettingMode.BLIND,
    totalBet: 0,
    isDealer: false,
    blindRoundsPlayed: 0,
  });
}

export function removePlayer(state: GameState, userId: string): void {
  if (state.phase !== GamePhase.WAITING && state.phase !== GamePhase.FINISHED) {
    // Mark as folded if game is active
    const player = state.players.get(userId);
    if (player) {
      player.status = PlayerStatus.FOLDED;
    }
    return;
  }
  state.players.delete(userId);
}

export function startRound(state: GameState): void {
  const activePlayers = Array.from(state.players.values()).filter(
    (p) => p.status !== PlayerStatus.FOLDED
  );

  if (activePlayers.length < 2) {
    throw new Error('Need at least 2 players to start');
  }

  // Shuffle deck
  const deck = createDeck();
  state.deck = shuffleDeck(deck);
  state.deckHash = hashDeck(state.deck);
  state.deckEncrypted = encryptDeck(state.deck, DECK_ENCRYPTION_SECRET);

  // Reset state
  state.phase = GamePhase.DEALING;
  state.pot = 0;
  state.currentBet = state.config.minBet;
  state.roundNumber++;
  state.actions = [];
  state.sequenceCounter = 0;
  state.sideshowPending = undefined;

  // Reset all players
  for (const player of state.players.values()) {
    player.cards = [];
    player.status = PlayerStatus.ACTIVE;
    player.bettingMode = BettingMode.BLIND;
    player.totalBet = 0;
    player.blindRoundsPlayed = 0;
    player.handEvaluation = undefined;
    player.isDealer = false;
  }

  // Set dealer (rotate from last round)
  const playerIds = Array.from(state.players.keys());
  state.dealerIndex = state.roundNumber % playerIds.length;
  const dealerPlayer = state.players.get(playerIds[state.dealerIndex]);
  if (dealerPlayer) {
    dealerPlayer.isDealer = true;
  }

  // Build turn order (clockwise from dealer)
  state.turnOrder = [];
  for (let i = 0; i < playerIds.length; i++) {
    const idx = (state.dealerIndex + 1 + i) % playerIds.length;
    state.turnOrder.push(playerIds[idx]);
  }

  // Deal 3 cards to each player
  let cardIndex = 0;
  for (const playerId of state.turnOrder) {
    const player = state.players.get(playerId);
    if (player) {
      player.cards = [state.deck[cardIndex], state.deck[cardIndex + 1], state.deck[cardIndex + 2]];
      cardIndex += 3;
    }
  }

  // Move to boot round
  state.phase = GamePhase.BOOT_ROUND;
}

export function processBootRound(state: GameState): void {
  if (state.phase !== GamePhase.BOOT_ROUND) {
    throw new Error('Not in boot round');
  }

  const bootAmount = state.config.bootAmount || state.config.minBet;

  // Everyone posts boot (ante)
  for (const [playerId, player] of state.players.entries()) {
    if (player.status === PlayerStatus.ACTIVE) {
      player.totalBet += bootAmount;
      state.pot += bootAmount;

      state.actions.push({
        type: 'boot',
        playerId,
        amount: bootAmount,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });
    }
  }

  state.currentBet = bootAmount;
  state.currentPlayerIndex = 0;
  state.phase = GamePhase.BETTING;
}

export function getCurrentPlayerId(state: GameState): string | null {
  if (state.phase !== GamePhase.BETTING) return null;

  const activePlayers = state.turnOrder.filter((id) => {
    const p = state.players.get(id);
    return p && p.status === PlayerStatus.ACTIVE;
  });

  if (activePlayers.length < 2) return null;

  return activePlayers[state.currentPlayerIndex % activePlayers.length] || null;
}

export function processAction(
  state: GameState,
  playerId: string,
  actionType: string,
  amount?: number
): { success: boolean; message: string; gameOver?: boolean; winnerId?: string } {
  if (state.phase !== GamePhase.BETTING) {
    return { success: false, message: 'Game is not in betting phase' };
  }

  const player = state.players.get(playerId);
  if (!player || player.status !== PlayerStatus.ACTIVE) {
    return { success: false, message: 'Player is not active' };
  }

  // Sideshow accept/reject must be handled by the target, not the current turn player
  if (state.sideshowPending && (actionType === 'sideshow_accept' || actionType === 'sideshow_reject')) {
    if (state.sideshowPending.targetId !== playerId) {
      return { success: false, message: 'No sideshow pending for you' };
    }
  } else {
    const currentPlayerId = getCurrentPlayerId(state);
    if (currentPlayerId !== playerId) {
      return { success: false, message: 'Not your turn' };
    }
  }

  switch (actionType) {
    case 'see_cards': {
      if (player.bettingMode === BettingMode.SEEN) {
        return { success: false, message: 'Cards already seen' };
      }
      player.bettingMode = BettingMode.SEEN;
      player.handEvaluation = evaluateHand(player.cards);

      state.actions.push({
        type: 'see_cards',
        playerId,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      // Seeing cards does NOT advance turn
      return { success: true, message: 'Cards revealed to player' };
    }

    case 'fold': {
      player.status = PlayerStatus.FOLDED;
      state.actions.push({
        type: 'fold',
        playerId,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      // Check if only one player remains
      const remaining = getActivePlayers(state);
      if (remaining.length === 1) {
        return endGame(state, remaining[0].userId);
      }

      advanceTurn(state);
      return { success: true, message: 'Player folded' };
    }

    case 'bet_blind': {
      if (player.bettingMode !== BettingMode.BLIND) {
        return { success: false, message: 'Cannot bet blind after seeing cards' };
      }

      const betAmount = amount || state.currentBet;
      if (betAmount < state.currentBet || betAmount > state.currentBet * 2) {
        return { success: false, message: `Blind bet must be between ${state.currentBet} and ${state.currentBet * 2}` };
      }

      player.totalBet += betAmount;
      state.pot += betAmount;
      state.currentBet = betAmount;
      player.blindRoundsPlayed++;

      state.actions.push({
        type: 'bet_blind',
        playerId,
        amount: betAmount,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      advanceTurn(state);
      return { success: true, message: `Blind bet of ${betAmount}` };
    }

    case 'bet_seen': {
      if (player.bettingMode !== BettingMode.SEEN) {
        return { success: false, message: 'Must see cards first' };
      }

      // Seen players bet 2x the current bet
      const minBet = state.currentBet * 2;
      const maxBet = state.currentBet * 4;
      const betAmount = amount || minBet;

      if (betAmount < minBet || betAmount > maxBet) {
        return { success: false, message: `Seen bet must be between ${minBet} and ${maxBet}` };
      }

      player.totalBet += betAmount;
      state.pot += betAmount;
      // Current bet for next player is half if they're blind, full if seen
      state.currentBet = Math.floor(betAmount / 2);

      state.actions.push({
        type: 'bet_seen',
        playerId,
        amount: betAmount,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      advanceTurn(state);
      return { success: true, message: `Seen bet of ${betAmount}` };
    }

    case 'show': {
      // Show can only be requested when 2 players remain
      const activePlayers = getActivePlayers(state);
      if (activePlayers.length !== 2) {
        return { success: false, message: 'Show only available with 2 players remaining' };
      }

      if (player.bettingMode !== BettingMode.SEEN) {
        return { success: false, message: 'Must see cards to request show' };
      }

      // Pay show cost (equal to current bet for seen player)
      const showCost = state.currentBet * 2;
      player.totalBet += showCost;
      state.pot += showCost;

      state.actions.push({
        type: 'show',
        playerId,
        amount: showCost,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      // Evaluate both hands and determine winner
      const opponent = activePlayers.find((p) => p.userId !== playerId)!;
      const playerHand = evaluateHand(player.cards);
      const opponentHand = evaluateHand(opponent.cards);

      const result = compareHands(playerHand, opponentHand);

      if (result >= 0) {
        // Requester wins or ties (ties go to non-requester in some rules, but standard is requester advantage)
        return endGame(state, result > 0 ? playerId : opponent.userId);
      } else {
        return endGame(state, opponent.userId);
      }
    }

    case 'sideshow_request': {
      if (player.bettingMode !== BettingMode.SEEN) {
        return { success: false, message: 'Must be seen to request sideshow' };
      }

      const activePlayers = getActivePlayers(state);
      if (activePlayers.length <= 2) {
        return { success: false, message: 'Sideshow not available with only 2 players' };
      }

      // Find previous active seen player
      const playerIndex = activePlayers.findIndex((p) => p.userId === playerId);
      let targetIndex = playerIndex - 1;
      if (targetIndex < 0) targetIndex = activePlayers.length - 1;
      const target = activePlayers[targetIndex];

      if (target.bettingMode !== BettingMode.SEEN) {
        return { success: false, message: 'Previous player must be seen for sideshow' };
      }

      // Pay sideshow cost
      const sideshowCost = state.currentBet * 2;
      player.totalBet += sideshowCost;
      state.pot += sideshowCost;

      state.sideshowPending = { requesterId: playerId, targetId: target.userId };

      state.actions.push({
        type: 'sideshow_request',
        playerId,
        amount: sideshowCost,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      return { success: true, message: `Sideshow requested against ${target.userId}` };
    }

    case 'sideshow_accept': {
      if (!state.sideshowPending || state.sideshowPending.targetId !== playerId) {
        return { success: false, message: 'No sideshow pending for you' };
      }

      const requester = state.players.get(state.sideshowPending.requesterId)!;
      const requesterHand = evaluateHand(requester.cards);
      const targetHand = evaluateHand(player.cards);

      const result = compareHands(requesterHand, targetHand);

      // Loser folds
      if (result >= 0) {
        player.status = PlayerStatus.FOLDED;
      } else {
        requester.status = PlayerStatus.FOLDED;
      }

      state.sideshowPending = undefined;

      state.actions.push({
        type: 'sideshow_accept',
        playerId,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      // Check if only one player remains
      const remaining = getActivePlayers(state);
      if (remaining.length === 1) {
        return endGame(state, remaining[0].userId);
      }

      advanceTurn(state);
      return { success: true, message: 'Sideshow completed' };
    }

    case 'sideshow_reject': {
      if (!state.sideshowPending || state.sideshowPending.targetId !== playerId) {
        return { success: false, message: 'No sideshow pending for you' };
      }

      state.sideshowPending = undefined;

      state.actions.push({
        type: 'sideshow_reject',
        playerId,
        timestamp: Date.now(),
        sequenceNumber: state.sequenceCounter++,
      });

      advanceTurn(state);
      return { success: true, message: 'Sideshow rejected' };
    }

    default:
      return { success: false, message: `Unknown action: ${actionType}` };
  }
}

function getActivePlayers(state: GameState): PlayerState[] {
  return state.turnOrder
    .map((id) => state.players.get(id)!)
    .filter((p) => p.status === PlayerStatus.ACTIVE);
}

function advanceTurn(state: GameState): void {
  const activePlayers = getActivePlayers(state);
  if (activePlayers.length < 2) return;

  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % activePlayers.length;
}

function endGame(state: GameState, winnerId: string): { success: boolean; message: string; gameOver: true; winnerId: string } {
  state.phase = GamePhase.SHOWDOWN;

  // Evaluate all remaining hands for the record
  for (const player of state.players.values()) {
    if (!player.handEvaluation && player.cards.length === 3) {
      player.handEvaluation = evaluateHand(player.cards);
    }
  }

  state.phase = GamePhase.SETTLEMENT;

  return {
    success: true,
    message: `Game over! Winner: ${winnerId}. Pot: ${state.pot}`,
    gameOver: true,
    winnerId,
  };
}

// Get the view of the game state for a specific player
// Hides other players' cards unless game is in showdown
export function getPlayerView(state: GameState, playerId: string): Record<string, unknown> {
  const player = state.players.get(playerId);

  const players = Array.from(state.players.values()).map((p) => {
    const isCurrentPlayer = p.userId === playerId;
    const isShowdown = state.phase === GamePhase.SHOWDOWN || state.phase === GamePhase.SETTLEMENT;

    return {
      userId: p.userId,
      seatIndex: p.seatIndex,
      status: p.status,
      bettingMode: p.bettingMode,
      totalBet: p.totalBet,
      isDealer: p.isDealer,
      // Only show cards to the player themselves, or during showdown
      cards: (isCurrentPlayer && p.bettingMode === BettingMode.SEEN) || isShowdown ? p.cards : undefined,
      handEvaluation: isShowdown ? p.handEvaluation : undefined,
      hasSeenCards: p.bettingMode === BettingMode.SEEN,
    };
  });

  return {
    gameId: state.id,
    phase: state.phase,
    pot: state.pot,
    currentBet: state.currentBet,
    currentPlayerId: getCurrentPlayerId(state),
    roundNumber: state.roundNumber,
    players,
    myCards: player?.bettingMode === BettingMode.SEEN ? player.cards : undefined,
    isMyTurn: getCurrentPlayerId(state) === playerId,
    sideshowPending: state.sideshowPending,
  };
}
