/**
 * F-05 (G1-26) — Cloudflare Turnstile CAPTCHA doğrulaması (public uçlar için).
 *
 * ── NEDEN ────────────────────────────────────────────────────────────────────
 * IP-bazlı rate limit (`rateLimiter.ts`) tek başına yeterli değildir: dağıtık/rotasyonlu
 * IP'lerden gelen scriptli spam/sahte-kayıt saldırısı limitin altında kalıp sızabilir.
 * Turnstile insan-doğrulamasını EK bir katman olarak ekler — rate limit'i DEĞİŞTİRMEZ.
 *
 * ── ANAHTAR YOKSA NO-OP (bilinçli) ────────────────────────────────────────────
 * `TURNSTILE_SECRET_KEY` boşsa middleware doğrudan `next()` çağırır: bugünkü davranış
 * (yalnız IP rate-limit) aynen korunur. PO gerçek bir Cloudflare hesabı + anahtar
 * sağlayana kadar (bkz. `docs/otonom/03-PO-ELLE-ISLER.md`) hiçbir kullanıcı akışı değişmez.
 *
 * ── HATA POLİTİKASI — TEK POLİTİKA: FAIL-CLOSED, HER ZAMAN 400 (503 DEĞİL) ────
 * Anahtar TANIMLIYSA üç durum da 400 döner (yalnız kod/mesaj değişir):
 *   - token yok/boş                              → CAPTCHA_GEREKLI
 *   - token geçersiz (Cloudflare `success:false`) → CAPTCHA_GECERSIZ
 *   - Cloudflare'a ulaşılamadı / zaman aşımı (3sn) → CAPTCHA_DOGRULANAMADI (fail-closed)
 *
 * Neden fail-closed, ve neden AYRIM YAPMADAN dört uca (register, self-serve/register,
 * forgot-password, suspicion-reports) TEK politika: PO gerçek bir CAPTCHA anahtarı
 * sağladıysa niyeti bu uçlarda insan-doğrulamasını ZORUNLU kılmaktır. Ağ hatasında
 * sessizce no-op'a düşmek (fail-open) tam da bir saldırganın — Cloudflare'a karşı DoS
 * uygulayarak ya da bir ağ kesintisini bekleyerek — korumayı devre dışı bırakmasına
 * izin verir; üstelik uçlar arasında açık/kapalı davranış farklı olursa güvenlik
 * konseyinin "komşu uç karşılaştırması" ilkesini ihlal eder (bkz. CLAUDE.md). 503 yerine
 * 400 kullanılır: 503 istemciye/monitörlere "sunucu tarafı arıza" sinyali verir (otomatik
 * yeniden deneme/alarm tetikler); CAPTCHA doğrulanamaması burada kullanıcı-tarafı bir
 * durum gibi ele alınır (kısa süre sonra tekrar dene) — davranış öngörülebilir kalır.
 *
 * ── GÜVENLİK ──────────────────────────────────────────────────────────────────
 * `secretKey` ve `token` hiçbir zaman loglanmaz (console'a basılmaz, hata yanıtına
 * gömülmez — catch bloğu hata nesnesini dahi yakalamaz). Zaman aşımı 3 saniye — public
 * uç yanıt süresi üçüncü parti servise bağımlı kalmasın diye kısa tutulur.
 */

import type { NextFunction, Request, Response } from 'express';
import { getTurnstileSecretKey } from '../config.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 3000;

export const CAPTCHA_MESSAGES = {
  MISSING: 'Lütfen robot olmadığınızı doğrulayın.',
  INVALID: 'Doğrulama başarısız oldu. Lütfen tekrar deneyin.',
  UNAVAILABLE: 'Doğrulama şu anda tamamlanamadı. Lütfen birazdan tekrar deneyin.',
} as const;

interface TurnstileSiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

function clientIp(req: Request): string {
  return (req.ip ?? req.socket?.remoteAddress ?? '').toString();
}

/**
 * Cloudflare `siteverify` çağrısı. Ağ hatası/zaman aşımında THROW eder — çağıran
 * middleware bunu fail-closed olarak yorumlar (bkz. dosya başı yorumu).
 */
async function verifyTurnstileToken(token: string, remoteIp: string, secretKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Turnstile siteverify HTTP ${res.status}`);
    }
    const data = (await res.json()) as TurnstileSiteverifyResponse;
    return data.success === true;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Public uç CAPTCHA middleware'i. `TURNSTILE_SECRET_KEY` tanımlı değilse no-op (`next()`).
 * Tanımlıysa `req.body.captchaToken`'ı Cloudflare'a doğrulatır (hata politikası: dosya başı).
 *
 * Rate limiter'dan SONRA mount edilmeli (limit aşan istek Cloudflare'a hiç gitmesin).
 */
export async function requireTurnstile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secretKey = getTurnstileSecretKey();
  if (!secretKey) {
    next();
    return;
  }

  const rawToken = (req.body as Record<string, unknown> | undefined)?.['captchaToken'];
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!token) {
    res.status(400).json({ error: 'CAPTCHA_GEREKLI', message: CAPTCHA_MESSAGES.MISSING });
    return;
  }

  try {
    const verified = await verifyTurnstileToken(token, clientIp(req), secretKey);
    if (!verified) {
      res.status(400).json({ error: 'CAPTCHA_GECERSIZ', message: CAPTCHA_MESSAGES.INVALID });
      return;
    }
    next();
  } catch {
    // Ağ hatası/zaman aşımı — hata nesnesi kasıtlı olarak yakalanmadı (token/secret
    // barındırabilecek hiçbir şey loglanmaz). Fail-closed (bkz. dosya başı).
    res.status(400).json({ error: 'CAPTCHA_DOGRULANAMADI', message: CAPTCHA_MESSAGES.UNAVAILABLE });
  }
}
