import { BaseVariant, VariantConfig } from './base-variant';

export class ClassicTeenPatti extends BaseVariant {
  getConfig(): VariantConfig {
    return {
      name: 'classic',
      description: 'Classic Teen Patti - standard hand rankings',
      minPlayers: 2,
      maxPlayers: 9,
      maxBlindRounds: 4,
      allowSideshow: true,
    };
  }
}
