/**
 * AJ-21 (KVKK): peer bakışında discResultCard ham DISC vektörü / ham puan taşımamalı.
 * toPublicDiscResultCard saf yardımcısının sözleşmesi — kart alanları korunur, ham alanlar düşer.
 */
import { describe, it, expect } from 'vitest';
import { toPublicDiscResultCard } from '../src/services/discVisibility.js';

const legacyCard = {
  archetype:      'Lider',
  icon:           '🦁',
  superPower:     'Karar',
  description:    'açıklama',
  strengths:      ['a', 'b'],
  growthArea:     'sabır',
  compatibleWith: ['S'],
  dominant:       'D',
  completedAt:    '2026-09-01T00:00:00.000Z',
  discVector:     { D: 0.7, I: 0.1, S: 0.1, C: 0.1, confidence: 0.8 },
  rawScores:      { D: 5, I: 1, S: 1, C: 1 },
};

describe('toPublicDiscResultCard (AJ-21)', () => {
  it('eski kayıttaki ham discVector ve rawScores alanlarını çıkarır', () => {
    const out = toPublicDiscResultCard(legacyCard) as Record<string, unknown>;
    expect(out).not.toHaveProperty('discVector');
    expect(out).not.toHaveProperty('rawScores');
  });

  it('kart alanlarını aynen korur ve girdiyi değiştirmez', () => {
    const out = toPublicDiscResultCard(legacyCard) as Record<string, unknown>;
    const { discVector: _v, rawScores: _r, ...cardOnly } = legacyCard;
    expect(out).toEqual(cardOnly);
    expect(legacyCard).toHaveProperty('discVector'); // kaynak nesne mutasyona uğramadı
  });

  it('null / nesne-olmayan değerleri olduğu gibi döndürür', () => {
    expect(toPublicDiscResultCard(null)).toBeNull();
    expect(toPublicDiscResultCard('x')).toBe('x');
  });
});
