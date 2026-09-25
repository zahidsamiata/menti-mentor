import type { Response } from 'express';
import type { z } from 'zod';

/**
 * Ortak Zod girdi doğrulaması (Y-03, madde 47).
 *
 * Neden: `safeParse` + `400 { error: 'VALIDATION', details: flatten() }` bloğu ~30 controller'da
 * elle kopyalanmıştı; biçim bir dosyada kayarsa kullanıcı tutarsız hata görür. Yanıt biçimi
 * artık yalnız burada tanımlı. Davranış kopyalarla BİREBİR aynıdır.
 *
 * Kullanım (girdi kaynağı — body/query/params — çağıran tarafta aynen kalır):
 *   const parsed = validateRequest(Schema, req.body, res);
 *   if (!parsed.success) return parsed.response;
 *   parsed.data // şemanın çıktı tipi (preprocess/transform uygulanmış)
 *
 * Farklı biçimli yanıtlar (ör. `message` alanı ekleyen questionController → `firstValidationMessage`)
 * bilerek buraya alınmadı; kendi bloklarında kalır.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: Response };

export function validateRequest<S extends z.ZodType>(
  schema: S,
  input: unknown,
  res: Response,
): ValidationResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      response: res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() }),
    };
  }
  return { success: true, data: parsed.data };
}
