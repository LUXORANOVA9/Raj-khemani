import { BaseVariant } from './base-variant';
import { ClassicTeenPatti } from './classic';
import { MuflisTeenPatti } from './muflis';
import { AK47TeenPatti } from './ak47';

const VARIANTS: Record<string, () => BaseVariant> = {
  classic: () => new ClassicTeenPatti(),
  muflis: () => new MuflisTeenPatti(),
  ak47: () => new AK47TeenPatti(),
};

export function createVariant(name: string): BaseVariant {
  const factory = VARIANTS[name];
  if (!factory) {
    throw new Error(`Unknown variant: ${name}. Available: ${Object.keys(VARIANTS).join(', ')}`);
  }
  return factory();
}

export function getAvailableVariants(): string[] {
  return Object.keys(VARIANTS);
}

export { BaseVariant, ClassicTeenPatti, MuflisTeenPatti, AK47TeenPatti };
