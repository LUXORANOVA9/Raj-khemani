import crypto from 'crypto';

export enum Suit {
  HEARTS = 'H',
  DIAMONDS = 'D',
  CLUBS = 'C',
  SPADES = 'S',
}

export enum Rank {
  TWO = 2,
  THREE = 3,
  FOUR = 4,
  FIVE = 5,
  SIX = 6,
  SEVEN = 7,
  EIGHT = 8,
  NINE = 9,
  TEN = 10,
  JACK = 11,
  QUEEN = 12,
  KING = 13,
  ACE = 14,
}

export interface Card {
  rank: Rank;
  suit: Suit;
  index: number; // 0-51 unique identifier
}

export const RANK_NAMES: Record<Rank, string> = {
  [Rank.TWO]: '2',
  [Rank.THREE]: '3',
  [Rank.FOUR]: '4',
  [Rank.FIVE]: '5',
  [Rank.SIX]: '6',
  [Rank.SEVEN]: '7',
  [Rank.EIGHT]: '8',
  [Rank.NINE]: '9',
  [Rank.TEN]: '10',
  [Rank.JACK]: 'J',
  [Rank.QUEEN]: 'Q',
  [Rank.KING]: 'K',
  [Rank.ACE]: 'A',
};

export const SUIT_NAMES: Record<Suit, string> = {
  [Suit.HEARTS]: 'Hearts',
  [Suit.DIAMONDS]: 'Diamonds',
  [Suit.CLUBS]: 'Clubs',
  [Suit.SPADES]: 'Spades',
};

// Create a standard 52-card deck
export function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
  const ranks = [
    Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN,
    Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE,
  ];

  let index = 0;
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit, index });
      index++;
    }
  }

  return deck;
}

// Provably fair Fisher-Yates shuffle with crypto.randomBytes
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const randomBytes = crypto.randomBytes(4);
    const randomIndex = randomBytes.readUInt32BE(0) % (i + 1);
    [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
  }

  return shuffled;
}

// Create a verifiable hash of the deck order
export function hashDeck(deck: Card[]): string {
  const deckString = deck.map((c) => c.index).join(',');
  return crypto.createHash('sha256').update(deckString).digest('hex');
}

// Encrypt deck for storage (for dispute resolution)
export function encryptDeck(deck: Card[], secret: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(secret, 'teen-patti-salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const deckString = JSON.stringify(deck.map((c) => c.index));
  let encrypted = cipher.update(deckString, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Decrypt deck for dispute resolution
export function decryptDeck(encrypted: string, secret: string): number[] {
  const [ivHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(secret, 'teen-patti-salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// Validate deck integrity (52 unique cards)
export function validateDeck(deck: Card[]): boolean {
  if (deck.length !== 52) return false;

  const seen = new Set<number>();
  for (const card of deck) {
    if (card.index < 0 || card.index > 51) return false;
    if (seen.has(card.index)) return false;
    seen.add(card.index);
  }

  return seen.size === 52;
}

export function cardToString(card: Card): string {
  return `${RANK_NAMES[card.rank]}${card.suit}`;
}

export function indexToCard(index: number): Card {
  const suitIndex = Math.floor(index / 13);
  const rankValue = (index % 13) + 2;
  const suits = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
  return { rank: rankValue as Rank, suit: suits[suitIndex], index };
}
