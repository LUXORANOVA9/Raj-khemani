import {
  createDeck,
  shuffleDeck,
  hashDeck,
  encryptDeck,
  decryptDeck,
  validateDeck,
  cardToString,
  indexToCard,
  Rank,
  Suit,
} from '../../src/modules/game/engine/cards';

describe('Cards', () => {
  describe('createDeck', () => {
    it('should create a standard 52-card deck', () => {
      const deck = createDeck();
      expect(deck.length).toBe(52);
    });

    it('should have 13 cards per suit', () => {
      const deck = createDeck();
      const suits = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
      for (const suit of suits) {
        const suitCards = deck.filter((c) => c.suit === suit);
        expect(suitCards.length).toBe(13);
      }
    });

    it('should have unique indices', () => {
      const deck = createDeck();
      const indices = new Set(deck.map((c) => c.index));
      expect(indices.size).toBe(52);
    });

    it('should pass validation', () => {
      const deck = createDeck();
      expect(validateDeck(deck)).toBe(true);
    });
  });

  describe('shuffleDeck', () => {
    it('should return 52 cards', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      expect(shuffled.length).toBe(52);
    });

    it('should contain all the same cards', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      const originalIndices = new Set(deck.map((c) => c.index));
      const shuffledIndices = new Set(shuffled.map((c) => c.index));
      expect(shuffledIndices).toEqual(originalIndices);
    });

    it('should produce different orderings', () => {
      const deck = createDeck();
      const shuffled1 = shuffleDeck(deck);
      const shuffled2 = shuffleDeck(deck);
      // Very unlikely to be the same (1/52! chance)
      const order1 = shuffled1.map((c) => c.index).join(',');
      const order2 = shuffled2.map((c) => c.index).join(',');
      expect(order1).not.toBe(order2);
    });

    it('should pass validation after shuffle', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      expect(validateDeck(shuffled)).toBe(true);
    });
  });

  describe('hashDeck', () => {
    it('should produce consistent hash for same deck order', () => {
      const deck = createDeck();
      const hash1 = hashDeck(deck);
      const hash2 = hashDeck(deck);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different orders', () => {
      const deck1 = createDeck();
      const deck2 = shuffleDeck(deck1);
      expect(hashDeck(deck1)).not.toBe(hashDeck(deck2));
    });

    it('should return a 64-char hex string', () => {
      const deck = createDeck();
      const hash = hashDeck(deck);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('encrypt/decrypt deck', () => {
    it('should roundtrip encrypt and decrypt', () => {
      const deck = createDeck();
      const secret = 'test-secret';
      const encrypted = encryptDeck(deck, secret);
      const decrypted = decryptDeck(encrypted, secret);
      expect(decrypted).toEqual(deck.map((c) => c.index));
    });

    it('should fail with wrong secret', () => {
      const deck = createDeck();
      const encrypted = encryptDeck(deck, 'correct-secret');
      expect(() => decryptDeck(encrypted, 'wrong-secret')).toThrow();
    });
  });

  describe('cardToString', () => {
    it('should format card correctly', () => {
      const aceOfSpades = { rank: Rank.ACE, suit: Suit.SPADES, index: 51 };
      expect(cardToString(aceOfSpades)).toBe('AS');
    });

    it('should format number cards correctly', () => {
      const twoOfHearts = { rank: Rank.TWO, suit: Suit.HEARTS, index: 0 };
      expect(cardToString(twoOfHearts)).toBe('2H');
    });
  });

  describe('indexToCard', () => {
    it('should convert index 0 to 2 of Hearts', () => {
      const card = indexToCard(0);
      expect(card.rank).toBe(Rank.TWO);
      expect(card.suit).toBe(Suit.HEARTS);
    });

    it('should convert index 51 to Ace of Spades', () => {
      const card = indexToCard(51);
      expect(card.rank).toBe(Rank.ACE);
      expect(card.suit).toBe(Suit.SPADES);
    });

    it('should convert index 12 to Ace of Hearts', () => {
      const card = indexToCard(12);
      expect(card.rank).toBe(Rank.ACE);
      expect(card.suit).toBe(Suit.HEARTS);
    });
  });

  describe('validateDeck', () => {
    it('should reject deck with wrong size', () => {
      expect(validateDeck([])).toBe(false);
    });

    it('should reject deck with duplicate cards', () => {
      const deck = createDeck();
      deck[0] = deck[1]; // Create duplicate
      expect(validateDeck(deck)).toBe(false);
    });
  });
});
