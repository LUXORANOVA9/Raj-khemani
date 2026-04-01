import { evaluateHand, compareHands, HandRank } from '../../src/modules/game/engine/hand-evaluator';
import { Card, Rank, Suit } from '../../src/modules/game/engine/cards';

function card(rank: Rank, suit: Suit): Card {
  const suitIndex = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES].indexOf(suit);
  const index = suitIndex * 13 + (rank - 2);
  return { rank, suit, index };
}

describe('Hand Evaluator', () => {
  describe('evaluateHand', () => {
    it('should detect Trail (Three of a Kind)', () => {
      const hand = [
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.ACE, Suit.DIAMONDS),
        card(Rank.ACE, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.TRAIL);
      expect(result.tiebreakers).toEqual([Rank.ACE]);
    });

    it('should detect Trail of 2s as lowest trail', () => {
      const hand = [
        card(Rank.TWO, Suit.HEARTS),
        card(Rank.TWO, Suit.DIAMONDS),
        card(Rank.TWO, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.TRAIL);
      expect(result.tiebreakers).toEqual([Rank.TWO]);
    });

    it('should detect Pure Sequence (Straight Flush)', () => {
      const hand = [
        card(Rank.JACK, Suit.HEARTS),
        card(Rank.QUEEN, Suit.HEARTS),
        card(Rank.KING, Suit.HEARTS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.PURE_SEQUENCE);
      expect(result.tiebreakers).toEqual([Rank.KING]);
    });

    it('should detect A-K-Q Pure Sequence as highest straight', () => {
      const hand = [
        card(Rank.ACE, Suit.SPADES),
        card(Rank.KING, Suit.SPADES),
        card(Rank.QUEEN, Suit.SPADES),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.PURE_SEQUENCE);
      expect(result.tiebreakers).toEqual([Rank.ACE]);
    });

    it('should detect A-2-3 Pure Sequence as lowest straight', () => {
      const hand = [
        card(Rank.ACE, Suit.DIAMONDS),
        card(Rank.TWO, Suit.DIAMONDS),
        card(Rank.THREE, Suit.DIAMONDS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.PURE_SEQUENCE);
      expect(result.tiebreakers).toEqual([Rank.THREE]);
    });

    it('should detect Sequence (Straight) without same suit', () => {
      const hand = [
        card(Rank.SEVEN, Suit.HEARTS),
        card(Rank.EIGHT, Suit.DIAMONDS),
        card(Rank.NINE, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.SEQUENCE);
      expect(result.tiebreakers).toEqual([Rank.NINE]);
    });

    it('should detect Color (Flush)', () => {
      const hand = [
        card(Rank.ACE, Suit.CLUBS),
        card(Rank.JACK, Suit.CLUBS),
        card(Rank.FIVE, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.COLOR);
      expect(result.tiebreakers).toEqual([Rank.ACE, Rank.JACK, Rank.FIVE]);
    });

    it('should detect Pair', () => {
      const hand = [
        card(Rank.KING, Suit.HEARTS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.FIVE, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.PAIR);
      expect(result.tiebreakers).toEqual([Rank.KING, Rank.FIVE]);
    });

    it('should detect Pair when pair is in lower positions', () => {
      const hand = [
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.SEVEN, Suit.DIAMONDS),
        card(Rank.SEVEN, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.PAIR);
      expect(result.tiebreakers).toEqual([Rank.SEVEN, Rank.ACE]);
    });

    it('should detect High Card', () => {
      const hand = [
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.TEN, Suit.DIAMONDS),
        card(Rank.FIVE, Suit.CLUBS),
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(HandRank.HIGH_CARD);
      expect(result.tiebreakers).toEqual([Rank.ACE, Rank.TEN, Rank.FIVE]);
    });

    it('should throw for invalid hand size', () => {
      expect(() => evaluateHand([])).toThrow('Teen Patti hand must have exactly 3 cards');
      expect(() => evaluateHand([card(Rank.ACE, Suit.HEARTS), card(Rank.KING, Suit.HEARTS)])).toThrow();
    });
  });

  describe('compareHands', () => {
    it('Trail beats Pure Sequence', () => {
      const trail = evaluateHand([
        card(Rank.TWO, Suit.HEARTS),
        card(Rank.TWO, Suit.DIAMONDS),
        card(Rank.TWO, Suit.CLUBS),
      ]);
      const pureSeq = evaluateHand([
        card(Rank.ACE, Suit.SPADES),
        card(Rank.KING, Suit.SPADES),
        card(Rank.QUEEN, Suit.SPADES),
      ]);
      expect(compareHands(trail, pureSeq)).toBe(1);
      expect(compareHands(pureSeq, trail)).toBe(-1);
    });

    it('Pure Sequence beats Sequence', () => {
      const pureSeq = evaluateHand([
        card(Rank.FOUR, Suit.HEARTS),
        card(Rank.FIVE, Suit.HEARTS),
        card(Rank.SIX, Suit.HEARTS),
      ]);
      const seq = evaluateHand([
        card(Rank.JACK, Suit.HEARTS),
        card(Rank.QUEEN, Suit.DIAMONDS),
        card(Rank.KING, Suit.CLUBS),
      ]);
      expect(compareHands(pureSeq, seq)).toBe(1);
    });

    it('Sequence beats Color', () => {
      const seq = evaluateHand([
        card(Rank.FOUR, Suit.HEARTS),
        card(Rank.FIVE, Suit.DIAMONDS),
        card(Rank.SIX, Suit.CLUBS),
      ]);
      const color = evaluateHand([
        card(Rank.ACE, Suit.SPADES),
        card(Rank.KING, Suit.SPADES),
        card(Rank.JACK, Suit.SPADES),
      ]);
      expect(compareHands(seq, color)).toBe(1);
    });

    it('Color beats Pair', () => {
      const color = evaluateHand([
        card(Rank.TWO, Suit.HEARTS),
        card(Rank.FOUR, Suit.HEARTS),
        card(Rank.SIX, Suit.HEARTS),
      ]);
      const pair = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.ACE, Suit.DIAMONDS),
        card(Rank.KING, Suit.CLUBS),
      ]);
      expect(compareHands(color, pair)).toBe(1);
    });

    it('Pair beats High Card', () => {
      const pair = evaluateHand([
        card(Rank.TWO, Suit.HEARTS),
        card(Rank.TWO, Suit.DIAMONDS),
        card(Rank.THREE, Suit.CLUBS),
      ]);
      // Use non-sequential cards to ensure High Card (A-K-Q is a Sequence)
      const highCard = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.JACK, Suit.CLUBS),
      ]);
      expect(compareHands(pair, highCard)).toBe(1);
    });

    it('Higher trail beats lower trail', () => {
      const aceTrail = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.ACE, Suit.DIAMONDS),
        card(Rank.ACE, Suit.CLUBS),
      ]);
      const kingTrail = evaluateHand([
        card(Rank.KING, Suit.HEARTS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.KING, Suit.CLUBS),
      ]);
      expect(compareHands(aceTrail, kingTrail)).toBe(1);
      expect(compareHands(kingTrail, aceTrail)).toBe(-1);
    });

    it('Higher pair beats lower pair', () => {
      const acePair = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.ACE, Suit.DIAMONDS),
        card(Rank.TWO, Suit.CLUBS),
      ]);
      const kingPair = evaluateHand([
        card(Rank.KING, Suit.HEARTS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.ACE, Suit.CLUBS),
      ]);
      expect(compareHands(acePair, kingPair)).toBe(1);
    });

    it('Same pair with higher kicker wins', () => {
      const pairWithAce = evaluateHand([
        card(Rank.KING, Suit.HEARTS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.ACE, Suit.CLUBS),
      ]);
      const pairWithQueen = evaluateHand([
        card(Rank.KING, Suit.CLUBS),
        card(Rank.KING, Suit.SPADES),
        card(Rank.QUEEN, Suit.CLUBS),
      ]);
      expect(compareHands(pairWithAce, pairWithQueen)).toBe(1);
    });

    it('A-K-Q sequence beats K-Q-J sequence', () => {
      const akq = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.QUEEN, Suit.CLUBS),
      ]);
      const kqj = evaluateHand([
        card(Rank.KING, Suit.HEARTS),
        card(Rank.QUEEN, Suit.CLUBS),
        card(Rank.JACK, Suit.SPADES),
      ]);
      expect(compareHands(akq, kqj)).toBe(1);
    });

    it('4-5-6 sequence beats A-2-3 sequence', () => {
      const seq456 = evaluateHand([
        card(Rank.FOUR, Suit.HEARTS),
        card(Rank.FIVE, Suit.DIAMONDS),
        card(Rank.SIX, Suit.CLUBS),
      ]);
      const seqA23 = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.TWO, Suit.DIAMONDS),
        card(Rank.THREE, Suit.CLUBS),
      ]);
      expect(compareHands(seq456, seqA23)).toBe(1);
    });

    it('Tie when hands are identical ranks', () => {
      const hand1 = evaluateHand([
        card(Rank.ACE, Suit.HEARTS),
        card(Rank.KING, Suit.HEARTS),
        card(Rank.FIVE, Suit.HEARTS),
      ]);
      const hand2 = evaluateHand([
        card(Rank.ACE, Suit.DIAMONDS),
        card(Rank.KING, Suit.DIAMONDS),
        card(Rank.FIVE, Suit.DIAMONDS),
      ]);
      expect(compareHands(hand1, hand2)).toBe(0);
    });
  });
});
