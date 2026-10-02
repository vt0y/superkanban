import type { TarotCategory } from './deck';

/** Starter questions shown as chips under the question box, per focus. */
export const TAROT_SUGGESTIONS: Record<TarotCategory, { th: string; en: string }[]> = {
  general: [
    { th: 'ช่วงนี้ฉันควรโฟกัสกับอะไร', en: 'What should I focus on right now?' },
    { th: 'อะไรกำลังรอฉันอยู่ข้างหน้า', en: 'What is waiting for me ahead?' },
    { th: 'ฉันควรปล่อยวางเรื่องไหน', en: 'What should I let go of?' },
  ],
  love: [
    { th: 'ความสัมพันธ์ของฉันกำลังไปทางไหน', en: 'Where is my relationship heading?' },
    { th: 'ฉันควรเปิดใจให้ใครสักคนไหม', en: 'Should I open my heart to someone new?' },
    { th: 'อะไรที่ฉันยังไม่เข้าใจในความรัก', en: 'What am I missing about love?' },
  ],
  work: [
    { th: 'โปรเจกต์นี้จะออกมาเป็นอย่างไร', en: 'How will this project turn out?' },
    { th: 'ฉันควรเปลี่ยนงานหรือไม่', en: 'Is it time for a career change?' },
    { th: 'ทีมของฉันต้องการอะไรจากฉัน', en: 'What does my team need from me?' },
  ],
  finance: [
    { th: 'การเงินของฉันช่วงนี้เป็นอย่างไร', en: 'How are my finances looking?' },
    { th: 'ฉันควรระวังเรื่องการใช้จ่ายไหม', en: 'Should I be careful with spending?' },
    { th: 'โอกาสทางการเงินจะมาจากทางไหน', en: 'Where might new money come from?' },
  ],
};
