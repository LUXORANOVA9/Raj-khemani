import { Card, Rank } from './cards';

// Teen Patti hand rankings (highest to lowest):
// 1. Trail/Set (Three of a Kind) - e.g., A-A-A
// 2. Pure Sequence (Straight Flush) - e.g., A-2-3 same suit
// 3. Sequence (Straight) - e.g., 4-5-6
// 4. Color/Flush - three cards same suit
// 5. Pair - two cards same rank
// 6. High Card

export enum HandRank {
  HIGH_CARD = 1,
  PAIR = 2,
  COLOR = 3,       // Flush
  SEQUENCE = 4,    // Straight
  PURE_SEQUENCE = 5, // Straight Flush
  TRAIL = 6,       // Three of a Kind
}

export const HAND_RANK_NAMES: Record<HandRank, string> = {
  [HandRank.HIGH_CARD]: 'High Card',
  [HandRank.PAIR]: 'Pair',
  [HandRank.COLOR]: 'Color (Flush)',
  [HandRank.SEQUENCE]: 'Sequence (Straight)',
  [HandRank.PURE_SEQUENCE]: 'Pure Sequence (Straight Flush)',
  [HandRank.TRAIL]: 'Trail (Three of a Kind)',
};

export interface HandEvaluation {
  rank: HandRank;
  // Tiebreakers: sorted from most significant to least
  // For Trail: [tripleRank]
  // For Pure Sequence/Sequence: [highCard] (A-2-3 high card is 3)
  // For Color/High Card: [card1, card2, card3] sorted descending
  // For Pair: [pairRank, kicker]
  tiebreakers: number[];
  description: string;
}

// Sort 3 cards by rank descending
function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank);
}

function isTrail(cards: Card[]): boolean {
  return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank;
}

function isSameSuit(cards: Card[]): boolean {
  return cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
}

// Check if 3 cards form a sequence (straight)
// Special case: A-2-3 is the lowest straight, A-K-Q is the highest
function isSequence(sortedCards: Card[]): boolean {
  const ranks = sortedCards.map((c) => c.rank);

  // Normal consecutive: e.g., 7-6-5
  if (ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1) {
    return true;
  }

  // Special wrap-around: A-2-3 (sorted as A, 3, 2 = 14, 3, 2)
  if (ranks[0] === Rank.ACE && ranks[1] === Rank.THREE && ranks[2] === Rank.TWO) {
    return true;
  }

  return false;
}

// Get the high card value for a sequence
// A-K-Q -> A (14), K-Q-J -> K (13), A-2-3 -> 3 (special lowest)
function getSequenceHighCard(sortedCards: Card[]): number {
  const ranks = sortedCards.map((c) => c.rank);

  // A-2-3 special case: high card is 3 (lowest possible straight)
  if (ranks[0] === Rank.ACE && ranks[1] === Rank.THREE && ranks[2] === Rank.TWO) {
    return Rank.THREE;
  }

  return ranks[0];
}

function getPairInfo(sortedCards: Card[]): { pairRank: number; kicker: number } | null {
  const ranks = sortedCards.map((c) => c.rank);

  if (ranks[0] === ranks[1]) {
    return { pairRank: ranks[0], kicker: ranks[2] };
  }
  if (ranks[1] === ranks[2]) {
    return { pairRank: ranks[1], kicker: ranks[0] };
  }
  if (ranks[0] === ranks[2]) {
    // e.g., sorted as K, 5, K -> shouldn't happen after sort, but handle
    return { pairRank: ranks[0], kicker: ranks[1] };
  }

  return null;
}

export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length !== 3) {
    throw new Error('Teen Patti hand must have exactly 3 cards');
  }

  const sorted = sortCards(cards);
  const ranks = sorted.map((c) => c.rank);

  // Check Trail (Three of a Kind)
  if (isTrail(sorted)) {
    return {
      rank: HandRank.TRAIL,
      tiebreakers: [ranks[0]],
      description: `Trail of ${ranks[0]}s`,
    };
  }

  const sameSuit = isSameSuit(sorted);
  const sequential = isSequence(sorted);

  // Check Pure Sequence (Straight Flush)
  if (sameSuit && sequential) {
    const highCard = getSequenceHighCard(sorted);
    return {
      rank: HandRank.PURE_SEQUENCE,
      tiebreakers: [highCard],
      description: `Pure Sequence, high ${highCard}`,
    };
  }

  // Check Sequence (Straight)
  if (sequential) {
    const highCard = getSequenceHighCard(sorted);
    return {
      rank: HandRank.SEQUENCE,
      tiebreakers: [highCard],
      description: `Sequence, high ${highCard}`,
    };
  }

  // Check Color (Flush)
  if (sameSuit) {
    return {
      rank: HandRank.COLOR,
      tiebreakers: [ranks[0], ranks[1], ranks[2]],
      description: `Color, ${ranks[0]}-${ranks[1]}-${ranks[2]}`,
    };
  }

  // Check Pair
  const pairInfo = getPairInfo(sorted);
  if (pairInfo) {
    return {
      rank: HandRank.PAIR,
      tiebreakers: [pairInfo.pairRank, pairInfo.kicker],
      description: `Pair of ${pairInfo.pairRank}s, kicker ${pairInfo.kicker}`,
    };
  }

  // High Card
  return {
    rank: HandRank.HIGH_CARD,
    tiebreakers: [ranks[0], ranks[1], ranks[2]],
    description: `High Card ${ranks[0]}-${ranks[1]}-${ranks[2]}`,
  };
}

// Compare two hands. Returns:
//  1 if hand1 wins
// -1 if hand2 wins
//  0 if tie
export function compareHands(hand1: HandEvaluation, hand2: HandEvaluation): number {
  // Compare rank first
  if (hand1.rank !== hand2.rank) {
    return hand1.rank > hand2.rank ? 1 : -1;
  }

  // Same rank, compare tiebreakers
  const maxLen = Math.max(hand1.tiebreakers.length, hand2.tiebreakers.length);
  for (let i = 0; i < maxLen; i++) {
    const t1 = hand1.tiebreakers[i] ?? 0;
    const t2 = hand2.tiebreakers[i] ?? 0;
    if (t1 !== t2) {
      return t1 > t2 ? 1 : -1;
    }
  }

  return 0; // True tie
}

// Special Muflis variant: rankings are inverted (worst hand wins)
export function compareHandsMuflis(hand1: HandEvaluation, hand2: HandEvaluation): number {
  return -compareHands(hand1, hand2);
}
