import { describe, expect, it } from 'vitest';
import { TAROT_DECK, shuffleWithRandom, tarotCardById } from './deck';

describe('tarot deck', () => {
  it('contains a complete, unique 78-card deck', () => {
    expect(TAROT_DECK).toHaveLength(78);
    expect(new Set(TAROT_DECK.map((card) => card.id)).size).toBe(78);
    expect(new Set(TAROT_DECK.map((card) => card.slug)).size).toBe(78);
    expect(TAROT_DECK.every((card) => card.nameTh && card.nameEn && card.upright && card.reversed)).toBe(true);
  });

  it('resolves known cards and rejects unknown ids', () => {
    expect(tarotCardById('00-fool')?.nameEn).toBe('The Fool');
    expect(tarotCardById('cups-queen')?.nameTh).toBe('ราชินีถ้วย');
    expect(tarotCardById('not-a-card')).toBeUndefined();
  });

  it('Fisher-Yates keeps every card exactly once', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff);
    const shuffled = shuffleWithRandom(TAROT_DECK.map((card) => card.id), random);
    expect(shuffled).not.toEqual(TAROT_DECK.map((card) => card.id));
    expect(new Set(shuffled)).toEqual(new Set(TAROT_DECK.map((card) => card.id)));
  });
});

