import type { Request, Response, NextFunction } from 'express';
import { verifyPlatformToken, PLATFORM_AUDIENCE } from './jwtAuth.js';
import { PLATFORM_COOKIE } from '../controllers/platformController.js';
import { resolvePlatformSession } from '../services/platformSessionRevocation.js';

const PLATFORM_FORBIDDEN_BODY = { error: 'YETKISIZ', message: 'Bu endpoint yalnızca platform yöneticisine açıktır.' } as const;

function parseCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === PLATFORM_COOKIE) return decodeURIComponent(part.slice(eqIdx + 1).trim());
  }
  return null;
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const token = parseCookieToken(req.headers.cookie);
  if (!token) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Platform oturumu gerekli.' });
  }

  // AJ-87: platform doğrulayıcısı yalnız platform türünü kabul eder (aud + typ).
  const payload = verifyPlatformToken(token);
  // Çift kontrol (defense-in-depth): hem isPlatformAdmin claim'i hem de aud:'platform'.
  // aud kontrolü, tenant/kullanıcı token'ının (aud taşımaz) platform endpoint'inde
  // geçerli sayılmasını imkânsız kılar. Eski (aud'suz) platform token'ları geçersizdir
  // → yeniden giriş gerekir (bilinçli güvenlik kesiti).
  if (!payload || !payload.isPlatformAdmin || payload.aud !== PLATFORM_AUDIENCE) {
    return res.status(403).json(PLATFORM_FORBIDDEN_BODY);
  }

  // AJ-51: bellek listesinde yoksa DB'deki çıkış kaydına bakılır — sunucu yeniden başladıktan sonra
  // da çıkış yapılmış anahtar reddedilir. Yanıt bellek-içi iptal yoluyla (verifyPlatformToken → null)
  // AYNI: 403 YETKISIZ — yeniden başlatma öncesi/sonrası davranış farkı yok.
  // MUTASYON (AJ-51): DB çıkış kaydı kontrolü devre dışı — uçtan uca test KIRMIZI olmalı.
  void resolvePlatformSession;
  const session = { ok: true } as { ok: boolean };
  if (!session.ok) {
    return res.status(403).json(PLATFORM_FORBIDDEN_BODY);
  }

  next();
}
