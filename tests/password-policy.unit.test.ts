/**
 * GV-19 — şifre kuralı (tek kaynak) birim testi. DB gerektirmez.
 */
import { describe, it, expect } from 'vitest';
import {
  passwordSchema,
  PASSWORD_MESSAGES,
  PASSWORD_MAX_LENGTH,
} from '../src/services/passwordPolicy.js';

function firstError(value: string): string | undefined {
  const parsed = passwordSchema.safeParse(value);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe('GV-19: passwordSchema', () => {
  it.each(['Test1234!', 'abcdefg1', 'şifre2026', 'E2ePass!2026', 'TestPanel!2026'])(
    'geçerli şifre kabul edilir: %s',
    (pw) => {
      expect(passwordSchema.safeParse(pw).success).toBe(true);
    },
  );

  it('yalnız rakam ("12345678") reddedilir — harf şartı', () => {
    expect(firstError('12345678')).toBe(PASSWORD_MESSAGES.NEEDS_LETTER);
  });

  it('yalnız harf ("abcdefgh") reddedilir — rakam şartı', () => {
    expect(firstError('abcdefgh')).toBe(PASSWORD_MESSAGES.NEEDS_DIGIT);
  });

  it('8 karakterden kısa şifre reddedilir', () => {
    expect(firstError('abc123')).toBe(PASSWORD_MESSAGES.TOO_SHORT);
  });

  it('üst sınır: 128 karakter kabul, 129 karakter ret', () => {
    const atLimit = 'a1'.repeat(PASSWORD_MAX_LENGTH / 2);
    expect(atLimit).toHaveLength(PASSWORD_MAX_LENGTH);
    expect(passwordSchema.safeParse(atLimit).success).toBe(true);
    expect(firstError(`${atLimit}x`)).toBe(PASSWORD_MESSAGES.TOO_LONG);
  });

  it('Türkçe harf de "harf" sayılır', () => {
    expect(passwordSchema.safeParse('ğüşıöç12').success).toBe(true);
  });
});
