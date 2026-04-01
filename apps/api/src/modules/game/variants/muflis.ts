import { BaseVariant, VariantConfig } from './base-variant';
import { HandEvaluation, compareHandsMuflis } from '../engine/hand-evaluator';

export class MuflisTeenPatti extends BaseVariant {
  getConfig(): VariantConfig {
    return {
      name: 'muflis',
      description: 'Muflis Teen Patti - lowest hand wins (inverted rankings)',
      minPlayers: 2,
      maxPlayers: 9,
      maxBlindRounds: 4,
      allowSideshow: true,
    };
  }

  compareHands(hand1: HandEvaluation, hand2: HandEvaluation): number {
    return compareHandsMuflis(hand1, hand2);
  }
}
