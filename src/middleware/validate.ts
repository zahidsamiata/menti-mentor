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
 * Ek insan-okunur mesaj (AJ-43): bazı uçlar (questionController → `firstValidationMessage`) alan
 * etiketli Türkçe `message` da döner. Bu, ayrı elle kopya blok yerine `options.message` ile verilir;
 * böylece biçim yine yalnız burada kurulur: `{ error: 'VALIDATION', message?, details }`.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: Response };

export interface ValidateOptions {
  /** Verilirse yanıta `message` alanı eklenir (kullanıcıya gösterilecek tek cümle). */
  message?: (error: z.ZodError) => string;
}

export function validateRequest<S extends z.ZodType>(
  schema: S,
  input: unknown,
  res: Response,
  options: ValidateOptions = {},
): ValidationResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const body = options.message
      ? { error: 'VALIDATION', message: options.message(parsed.error), details: parsed.error.flatten() }
      : { error: 'VALIDATION', details: parsed.error.flatten() };
    return { success: false, response: res.status(400).json(body) };
  }
  return { success: true, data: parsed.data };
}
