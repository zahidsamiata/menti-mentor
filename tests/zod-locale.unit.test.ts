/**
 * IC-05 — Zod doğrulama hataları Türkçe; şemada yazılan özel mesaj önceliklidir.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import '../src/zodLocale.js';

function firstMessage(schema: z.ZodType, input: unknown): string {
  const r = schema.safeParse(input);
  if (r.success) throw new Error('beklenen hata oluşmadı');
  return r.error.issues[0]!.message;
}

describe('IC-05: Türkçe Zod mesajları', () => {
  it('uzunluk ve boşluk kısıtları sade Türkçe', () => {
    expect(firstMessage(z.string().max(1000), 'a'.repeat(1001))).toBe('En fazla 1000 karakter olabilir.');
    expect(firstMessage(z.string().min(3), 'ab')).toBe('En az 3 karakter olmalı.');
    expect(firstMessage(z.string().min(1), '')).toBe('Bu alan boş bırakılamaz.');
    expect(firstMessage(z.array(z.string()).max(2), ['a', 'b', 'c'])).toBe('En fazla 2 seçim yapılabilir.');
    expect(firstMessage(z.number().int().min(1).max(5), 9)).toBe('Değer en fazla 5 olabilir.');
  });

  it('eksik alan, biçim ve seçim hataları Türkçe', () => {
    expect(firstMessage(z.object({ ad: z.string() }), {})).toBe('Bu alan zorunlu.');
    expect(firstMessage(z.string().email(), 'x')).toBe('Geçerli bir e-posta adresi girin.');
    expect(firstMessage(z.enum(['A', 'B']), 'C')).toBe('Geçersiz seçim.');
  });

  it('negatif: İngilizce ya da teknik terim sızmaz (regex deseni, tip adı)', () => {
    const msgs = [
      firstMessage(z.string().regex(/^[a-z]+$/), 'ABC'),
      firstMessage(z.number(), 'x'),
      firstMessage(z.string().uuid(), 'q'),
      firstMessage(z.boolean(), 'evet'),
    ];
    for (const m of msgs) {
      expect(m).not.toMatch(/expected|string|number|boolean|Invalid|Too|\^|\$/);
    }
  });

  it('şemada yazılan özel mesaj korunur', () => {
    expect(firstMessage(z.string().min(2, 'Ad en az 2 harf olmalı'), 'a')).toBe('Ad en az 2 harf olmalı');
    expect(firstMessage(z.enum(['MENTOR', 'MENTI'], { error: 'Rol MENTOR veya MENTI olmalı' }), 'X')).toBe(
      'Rol MENTOR veya MENTI olmalı',
    );
  });
});
