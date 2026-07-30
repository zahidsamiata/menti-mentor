/**
 * Tenant bazında rate limiter — in-memory sliding window.
 * Harici bağımlılık gerektirmez.
 *
 * RATE_LIMIT_RPM = genel limit (varsayılan 100 istek/dakika/tenant)
 */

import type { NextFunction, Request, Response } from 'express';

const DEFAULT_RPM = Number(process.env.RATE_LIMIT_RPM ?? 100);
const WINDOW_MS = 60_000;

const counters = new Map<string, { count: number; windowStart: number }>();

function checkLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    counters.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Bellek sızıntısını önlemek için eski kayıtları periyodik temizle
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of counters) {
    if (now - entry.windowStart > WINDOW_MS * 2) counters.delete(key);
  }
}, WINDOW_MS * 5);

export function generalRateLimiter(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.header('X-Tenant-Id')?.trim() ?? 'anon';
  if (!checkLimit(`general:${tenantId}`, DEFAULT_RPM)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: `İstek limiti aşıldı. Dakikada en fazla ${DEFAULT_RPM} istek gönderilebilir.`,
      retryAfter: 60,
    });
  }
  return next();
}

// Platform endpoint'leri X-Tenant-Id taşımaz → generalRateLimiter'ın 'anon' kovasına
// düşer (paylaşımlı, zayıf). Bu yüzden platform trafiğine IP-bazlı ayrı limitler koyuyoruz.
const PLATFORM_AUTH_RPM = Number(process.env.PLATFORM_AUTH_RPM ?? 10); // login brute-force koruması
const PLATFORM_READ_RPM = Number(process.env.PLATFORM_READ_RPM ?? 120); // panel okuma limiti

function clientIp(req: Request): string {
  return (req.ip ?? req.socket?.remoteAddress ?? 'unknown').toString();
}

/** POST /api/platform/auth — kimlik-bilgisi deneme (credential stuffing) koruması. IP başına sıkı. */
export function platformAuthRateLimiter(req: Request, res: Response, next: NextFunction) {
  if (!checkLimit(`platform-auth:${clientIp(req)}`, PLATFORM_AUTH_RPM)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: `Çok fazla giriş denemesi. Dakikada en fazla ${PLATFORM_AUTH_RPM} deneme yapılabilir.`,
      retryAfter: 60,
    });
  }
  return next();
}

/** Platform panel veri endpoint'leri — IP başına makul okuma limiti. */
export function platformReadRateLimiter(req: Request, res: Response, next: NextFunction) {
  if (!checkLimit(`platform-read:${clientIp(req)}`, PLATFORM_READ_RPM)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: `İstek limiti aşıldı. Dakikada en fazla ${PLATFORM_READ_RPM} istek gönderilebilir.`,
      retryAfter: 60,
    });
  }
  return next();
}
