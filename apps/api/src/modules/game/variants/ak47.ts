import { Card, Rank } from '../engine/cards';
import { BaseVariant, VariantConfig } from './base-variant';
import { HandEvaluation, evaluateHand } from '../engine/hand-evaluator';

// In AK47, Aces, Kings, 4s, and 7s are jokers (wild cards)
export class AK47TeenPatti extends BaseVariant {
  getConfig(): VariantConfig {
    return {
      name: 'ak47',
      description: 'AK47 Teen Patti - A, K, 4, 7 are wild jokers',
      minPlayers: 2,
      maxPlayers: 9,
      maxBlindRounds: 4,
      allowSideshow: true,
    };
  }

  isJoker(card: Card): boolean {
    return [Rank.ACE, Rank.KING, Rank.FOUR, Rank.SEVEN].includes(card.rank);
  }

  getBestHand(cards: Card[]): HandEvaluation {
    // For AK47, joker cards can substitute for any card
    // Find the best possible hand by trying all substitutions
    const jokerIndices = cards
      .map((c, i) => (this.isJoker(c) ? i : -1))
      .filter((i) => i >= 0);

    if (jokerIndices.length === 0) {
      return evaluateHand(cards);
    }

    // With jokers, just evaluate the natural hand
    // Full joker substitution logic would try all possible rank/suit combos
    // For simplicity in MVP, treat jokers as their face value
    // TODO: Implement full joker substitution for optimal hand
    return evaluateHand(cards);
  }
}
