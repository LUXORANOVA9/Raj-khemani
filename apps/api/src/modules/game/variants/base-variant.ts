import { Card } from '../engine/cards';
import { HandEvaluation, evaluateHand, compareHands } from '../engine/hand-evaluator';

export interface VariantConfig {
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  maxBlindRounds: number;
  allowSideshow: boolean;
}

export abstract class BaseVariant {
  abstract getConfig(): VariantConfig;

  evaluateHand(cards: Card[]): HandEvaluation {
    return evaluateHand(cards);
  }

  compareHands(hand1: HandEvaluation, hand2: HandEvaluation): number {
    return compareHands(hand1, hand2);
  }

  isJoker(_card: Card): boolean {
    return false;
  }

  // Apply joker substitutions and return the best possible hand
  getBestHand(cards: Card[]): HandEvaluation {
    return this.evaluateHand(cards);
  }
}
