import type { Request, Response, NextFunction } from 'express';
import { verifyToken, PLATFORM_AUDIENCE } from './jwtAuth.js';
import { PLATFORM_COOKIE } from '../controllers/platformController.js';

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

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const token = parseCookieToken(req.headers.cookie);
  if (!token) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Platform oturumu gerekli.' });
  }

  const payload = verifyToken(token);
  // Çift kontrol (defense-in-depth): hem isPlatformAdmin claim'i hem de aud:'platform'.
  // aud kontrolü, tenant/kullanıcı token'ının (aud taşımaz) platform endpoint'inde
  // geçerli sayılmasını imkânsız kılar. Eski (aud'suz) platform token'ları geçersizdir
  // → yeniden giriş gerekir (bilinçli güvenlik kesiti).
  if (!payload || !payload.isPlatformAdmin || payload.aud !== PLATFORM_AUDIENCE) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Bu endpoint yalnızca platform yöneticisine açıktır.' });
  }

  next();
}
