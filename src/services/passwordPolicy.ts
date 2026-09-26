import { z } from 'zod';

/**
 * GV-19 — şifre kuralı TEK KAYNAK.
 *
 * Neden: kural önceden üç ayrı şemada `z.string().min(8)` olarak elle kopyalanmıştı (kayıt,
 * şifre sıfırlama, self-serve kurum kaydı) ve "12345678" / "abcdefgh" gibi tahmini kolay
 * şifreleri kabul ediyordu. Artık şifre BELİRLENEN her yol bu şemayı kullanır.
 *
 * ⚠️ Yalnız şifre belirlenirken uygulanır — girişte (LoginSchema) UYGULANMAZ; eski kurala göre
 * belirlenmiş şifreyle giriş yapan mevcut kullanıcılar etkilenmez.
 *
 * Üst sınır (128): bcrypt yalnız ilk 72 baytı kullanır ve uzun girdi hash süresini şişirir;
 * sınırsız alan gereksiz CPU harcatmaya açıktır. Frontend aynası: frontend/src/lib/validation.ts.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_MESSAGES = {
  TOO_SHORT: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı`,
  TOO_LONG: `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir`,
  NEEDS_LETTER: 'Şifre en az bir harf içermeli',
  NEEDS_DIGIT: 'Şifre en az bir rakam içermeli',
} as const;

// \p{L}: Türkçe (ç, ğ, ı, ö, ş, ü) dahil her alfabedeki harf.
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\d/;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_MESSAGES.TOO_SHORT)
  .max(PASSWORD_MAX_LENGTH, PASSWORD_MESSAGES.TOO_LONG)
  .regex(HAS_LETTER, PASSWORD_MESSAGES.NEEDS_LETTER)
  .regex(HAS_DIGIT, PASSWORD_MESSAGES.NEEDS_DIGIT);
