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

// Avatar yükleme — dosya diske yazdığı için kullanıcı başına sıkı limit (disk doldurma
// / spam koruması). requireAuth SONRASINDA mount edilmeli ki req.auth.userId hazır olsun.
const AVATAR_UPLOAD_RPM = Number(process.env.AVATAR_UPLOAD_RPM ?? 5);

/** POST /api/users/me/avatar — kullanıcı başına dakikada sınırlı yükleme. */
export function avatarUploadRateLimiter(req: Request, res: Response, next: NextFunction) {
  // req.auth tenant middleware'i tarafından set edilir; yoksa IP'ye düş (defensive).
  const userId = (req as unknown as { auth?: { userId?: string } }).auth?.userId ?? clientIp(req);
  if (!checkLimit(`avatar-upload:${userId}`, AVATAR_UPLOAD_RPM)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: `Çok fazla yükleme denemesi. Dakikada en fazla ${AVATAR_UPLOAD_RPM} fotoğraf yükleyebilirsiniz.`,
      retryAfter: 60,
    });
  }
  return next();
}

// ─── Kullanıcı login brute-force koruması ─────────────────────────────────────
// generalRateLimiter tenant-key'lidir (X-Tenant-Id). /api/auth/login public'tir ve
// çoğu zaman tenant header taşımaz → 'anon' kovasına düşer; credential-stuffing/brute-force
// için zayıf kalır. Platform login'de olduğu gibi burada da IP-bazlı sıkı limit uygulanır.
// Bu limiter generalRateLimiter'a EK'tir; onu DEĞİŞTİRMEZ.
// Eşik call-time'da okunur (module const değil) → test kendi eşiğini ayarlayabilir.
/** POST /api/auth/login — IP başına brute-force koruması (varsayılan 10 deneme/dk). */
export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['LOGIN_RATE_RPM'] ?? 10);
  if (!checkLimit(`login:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla giriş denemesi. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

// ─── Şifre sıfırlama brute-force / mail-DoS koruması ──────────────────────────
// /auth/forgot-password + /auth/reset-password public'tir ve tenant header taşımaz →
// generalRateLimiter'ın zayıf 'anon' kovasına düşer. forgot: kullanıcı-tarama + mail-DoS;
// reset: token brute-force. Login'den DAHA SIKI eşik (varsayılan 5/dk/IP). Aynı in-memory
// sayaçları kullanır → setup.ts'teki resetRateLimiters testler arası otomatik sıfırlar.
/** POST /api/auth/forgot-password + /reset-password — IP başına sıkı limit (varsayılan 5/dk). */
export function passwordResetRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['PASSWORD_RESET_RATE_RPM'] ?? 5);
  if (!checkLimit(`pwreset:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla şifre işlemi denemesi. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

// ─── Public onboarding / kötüye-kullanım koruması ────────────────────────────
// Aşağıdaki endpoint'ler kasıtlı public'tir ve çoğu X-Tenant-Id taşımaz → hepsi
// generalRateLimiter'ın zayıf 'anon' kovasına düşer. Login/passwordReset deseniyle
// aynı: IP-bazlı EK limit. Eşikler call-time'da okunur (test kendi eşiğini ayarlar;
// .env.test'te yüksek tutularak suite'in meşru akışları bozulmaz).

/** POST /api/auth/register — sahte/spam kayıt koruması (varsayılan 10/dk/IP). */
export function registerRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['REGISTER_RATE_RPM'] ?? 10);
  if (!checkLimit(`register:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla kayıt denemesi. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

/** POST /api/suspicion-reports — spam/kötüye-kullanım bildirimi koruması (varsayılan 5/dk/IP). */
export function suspicionReportRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['SUSPICION_RATE_RPM'] ?? 5);
  if (!checkLimit(`suspicion:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla bildirim gönderdiniz. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

// GET /api/invitations/:token/join — token imzalı JWT olduğundan brute-force kriptografik
// olarak infeasible; bu limit token-deneme + DoS/kötüye-kullanım azaltmadır. Eşik, kampüs/
// ofis NAT'ı ardından toplu katılımı (tek IP'den çok üye aynı anda) kilitlememek için makul
// tutulur (varsayılan 20/dk); env ile sıkılaştırılabilir.
/** GET /api/invitations/:token/join — davet token deneme + DoS koruması (varsayılan 20/dk/IP). */
export function invitationJoinRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['INVITE_JOIN_RATE_RPM'] ?? 20);
  if (!checkLimit(`invite-join:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla deneme. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

/** GET /api/tenants/self-serve/check-slug — slug numaralandırmasını yavaşlatma (varsayılan 30/dk/IP). */
export function checkSlugRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['CHECK_SLUG_RATE_RPM'] ?? 30);
  if (!checkLimit(`check-slug:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla sorgu. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

// ─── Self-servis KVKK hakları (G1-05) — kullanıcı başına sıkı limit ───────────
// /me/data-export ağır sorgudur (birden çok tablo); /me/delete-account geri alınamaz.
// Her ikisi de kullanıcı başına sınırlanır → spam/kötüye-kullanım azaltma. requireAuth
// SONRASINDA mount edilmeli ki req.auth.userId hazır olsun (yoksa IP'ye düşer, defensive).

/** GET /api/me/data-export — kullanıcı başına dakikada sınırlı dışa aktarma (varsayılan 5/dk). */
export function dataExportRateLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = (req as unknown as { auth?: { userId?: string } }).auth?.userId ?? clientIp(req);
  const limit = Number(process.env['DATA_EXPORT_RATE_RPM'] ?? 5);
  if (!checkLimit(`data-export:${userId}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla veri indirme talebi. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

/** POST /api/me/delete-account — kullanıcı başına dakikada sınırlı kapatma denemesi (varsayılan 5/dk). */
export function accountDeleteRateLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = (req as unknown as { auth?: { userId?: string } }).auth?.userId ?? clientIp(req);
  const limit = Number(process.env['ACCOUNT_DELETE_RATE_RPM'] ?? 5);
  if (!checkLimit(`account-delete:${userId}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla hesap kapatma denemesi. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

// ─── Self-serve kurum başvurusu spam koruması (G1-26) ─────────────────────────
// POST /api/tenants/self-serve/register PUBLIC'tir ve her çağrıda bir Tenant + admin User
// oluşturur (ağır + kalıcı). X-Tenant-Id taşımaz → generalRateLimiter'ın zayıf 'anon' kovasına
// düşer. register/suspicion deseniyle aynı: IP-bazlı EK sıkı limit. Eşik call-time'da okunur
// (test kendi eşiğini ayarlar). GEREKÇE: meşru bir kurucu tek başvuru yapar; 5/dk/IP insan
// akışını engellemez ama scriptli toplu sahte-başvuru burst'ünü keser. (Mevcut altyapı 1-dk
// sliding window; saat-bazlı limit window parametresi + cleanup revizyonu gerektirir → ayrı iş.)
/** POST /api/tenants/self-serve/register — sahte kurum başvurusu koruması (varsayılan 5/dk/IP). */
export function selfServeRegisterRateLimiter(req: Request, res: Response, next: NextFunction) {
  const limit = Number(process.env['SELF_SERVE_REGISTER_RATE_RPM'] ?? 5);
  if (!checkLimit(`self-serve-register:${clientIp(req)}`, limit)) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Çok fazla kurum başvurusu denemesi. Lütfen bir dakika sonra tekrar deneyin.',
      retryAfter: 60,
    });
  }
  return next();
}

/** Test yardımcısı: in-memory sayaçları sıfırlar (yalnızca testlerde kullanılır). */
export function resetRateLimiters(): void {
  counters.clear();
}
