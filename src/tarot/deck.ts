export type TarotCategory = 'general' | 'love' | 'work' | 'finance';
export type TarotPosition = 'past' | 'present' | 'future';

export interface TarotCardDefinition {
  id: string;
  slug: string;
  nameEn: string;
  nameTh: string;
  upright: string;
  reversed: string;
}

const major: TarotCardDefinition[] = [
  ['00-fool', 'major-00-fool', 'The Fool', 'เดอะฟูล', 'new beginnings, trust, freedom', 'recklessness, hesitation, poor timing'],
  ['01-magician', 'major-01-magician', 'The Magician', 'เดอะเมจิเชียน', 'willpower, skill, manifestation', 'manipulation, scattered energy, unused talent'],
  ['02-high-priestess', 'major-02-high-priestess', 'The High Priestess', 'เดอะไฮพรีสเทส', 'intuition, mystery, inner knowing', 'hidden motives, disconnection, ignored intuition'],
  ['03-empress', 'major-03-empress', 'The Empress', 'ดิเอ็มเพรส', 'abundance, nurture, creativity', 'dependence, creative block, neglect'],
  ['04-emperor', 'major-04-emperor', 'The Emperor', 'ดิเอ็มเพอเรอร์', 'structure, authority, stability', 'rigidity, domination, lack of discipline'],
  ['05-hierophant', 'major-05-hierophant', 'The Hierophant', 'เดอะไฮโรแฟนต์', 'tradition, teaching, shared values', 'rebellion, personal belief, restriction'],
  ['06-lovers', 'major-06-lovers', 'The Lovers', 'เดอะเลิฟเวอร์ส', 'union, values, meaningful choice', 'imbalance, misalignment, difficult choice'],
  ['07-chariot', 'major-07-chariot', 'The Chariot', 'เดอะแชริออต', 'drive, victory, self-control', 'aggression, stalled progress, lost direction'],
  ['08-strength', 'major-08-strength', 'Strength', 'สเตร็งธ์', 'courage, compassion, quiet power', 'self-doubt, raw emotion, insecurity'],
  ['09-hermit', 'major-09-hermit', 'The Hermit', 'เดอะเฮอร์มิต', 'reflection, wisdom, solitude', 'isolation, withdrawal, avoidance'],
  ['10-wheel', 'major-10-wheel-of-fortune', 'Wheel of Fortune', 'วงล้อแห่งโชคชะตา', 'turning point, cycles, opportunity', 'setback, resistance, repeating patterns'],
  ['11-justice', 'major-11-justice', 'Justice', 'จัสติซ', 'truth, fairness, accountability', 'bias, avoidance, unfair outcome'],
  ['12-hanged-man', 'major-12-hanged-man', 'The Hanged Man', 'เดอะแฮงด์แมน', 'pause, surrender, new perspective', 'delay, resistance, needless sacrifice'],
  ['13-death', 'major-13-death', 'Death', 'เดธ', 'ending, transformation, release', 'fear of change, stagnation, clinging'],
  ['14-temperance', 'major-14-temperance', 'Temperance', 'เทมเพอแรนซ์', 'balance, patience, integration', 'excess, imbalance, haste'],
  ['15-devil', 'major-15-devil', 'The Devil', 'เดอะเดวิล', 'attachment, temptation, shadow', 'release, awareness, reclaiming control'],
  ['16-tower', 'major-16-tower', 'The Tower', 'เดอะทาวเวอร์', 'upheaval, revelation, liberation', 'avoided disaster, fear, delayed change'],
  ['17-star', 'major-17-star', 'The Star', 'เดอะสตาร์', 'hope, healing, renewal', 'discouragement, doubt, disconnection'],
  ['18-moon', 'major-18-moon', 'The Moon', 'เดอะมูน', 'dreams, uncertainty, intuition', 'clarity emerging, fear, confusion'],
  ['19-sun', 'major-19-sun', 'The Sun', 'เดอะซัน', 'joy, success, vitality', 'temporary sadness, overconfidence, delay'],
  ['20-judgement', 'major-20-judgement', 'Judgement', 'จัดจ์เมนต์', 'awakening, reckoning, calling', 'self-doubt, denial, harsh judgment'],
  ['21-world', 'major-21-world', 'The World', 'เดอะเวิลด์', 'completion, wholeness, achievement', 'unfinished business, delay, lack of closure'],
].map(([id, slug, nameEn, nameTh, upright, reversed]) => ({ id, slug, nameEn, nameTh, upright, reversed }));

const suits = [
  { id: 'wands', en: 'Wands', th: 'ไม้เท้า', upright: 'passion, action, creativity', reversed: 'delay, scattered energy, burnout' },
  { id: 'cups', en: 'Cups', th: 'ถ้วย', upright: 'emotion, connection, intuition', reversed: 'emotional block, distance, imbalance' },
  { id: 'swords', en: 'Swords', th: 'ดาบ', upright: 'thought, truth, decision', reversed: 'confusion, conflict, difficult communication' },
  { id: 'pentacles', en: 'Pentacles', th: 'เหรียญ', upright: 'resources, work, practical growth', reversed: 'instability, short-term thinking, material concern' },
] as const;

const ranks = [
  { id: 'ace', en: 'Ace', th: 'เอซ', upright: 'a fresh seed and opportunity', reversed: 'a blocked or delayed beginning' },
  { id: 'two', en: 'Two', th: 'สอง', upright: 'choice, balance, partnership', reversed: 'indecision, tension, imbalance' },
  { id: 'three', en: 'Three', th: 'สาม', upright: 'growth, cooperation, first results', reversed: 'friction, delay, weak support' },
  { id: 'four', en: 'Four', th: 'สี่', upright: 'stability, pause, foundation', reversed: 'restlessness, instability, release' },
  { id: 'five', en: 'Five', th: 'ห้า', upright: 'challenge, change, conflict', reversed: 'recovery, reconciliation, lingering tension' },
  { id: 'six', en: 'Six', th: 'หก', upright: 'transition, support, progress', reversed: 'baggage, imbalance, slow movement' },
  { id: 'seven', en: 'Seven', th: 'เจ็ด', upright: 'assessment, courage, strategy', reversed: 'doubt, poor planning, overwhelm' },
  { id: 'eight', en: 'Eight', th: 'แปด', upright: 'movement, mastery, focused effort', reversed: 'delay, repetition, scattered focus' },
  { id: 'nine', en: 'Nine', th: 'เก้า', upright: 'independence, resilience, nearing completion', reversed: 'fatigue, worry, guardedness' },
  { id: 'ten', en: 'Ten', th: 'สิบ', upright: 'culmination, legacy, full cycle', reversed: 'burden, instability, incomplete cycle' },
  { id: 'page', en: 'Page', th: 'เด็กถือ', upright: 'curiosity, message, learning', reversed: 'immaturity, bad news, lack of follow-through' },
  { id: 'knight', en: 'Knight', th: 'อัศวิน', upright: 'pursuit, momentum, devotion', reversed: 'impulsiveness, stagnation, misdirected effort' },
  { id: 'queen', en: 'Queen', th: 'ราชินี', upright: 'maturity, care, inner command', reversed: 'insecurity, overextension, inward tension' },
  { id: 'king', en: 'King', th: 'ราชา', upright: 'mastery, leadership, responsibility', reversed: 'control, rigidity, misuse of power' },
] as const;

const minor: TarotCardDefinition[] = suits.flatMap((suit) => ranks.map((rank) => ({
  id: `${suit.id}-${rank.id}`,
  slug: `${suit.id}-${rank.id}`,
  nameEn: `${rank.en} of ${suit.en}`,
  nameTh: `${rank.th}${suit.th}`,
  upright: `${suit.upright}; ${rank.upright}`,
  reversed: `${suit.reversed}; ${rank.reversed}`,
})));

export const TAROT_DECK: readonly TarotCardDefinition[] = [...major, ...minor];
export const TAROT_POSITIONS: readonly TarotPosition[] = ['past', 'present', 'future'];

export function tarotCardById(id: string): TarotCardDefinition | undefined {
  return TAROT_DECK.find((card) => card.id === id);
}

export function shuffleWithRandom<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

