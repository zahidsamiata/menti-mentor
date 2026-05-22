import type { NextFunction, RequestHandler, Response } from 'express';
import type { RequestWithTenant } from '../types.js';

// Yetkilendirme hataları için ortak yardımcı
function sendForbidden(res: Response) {
  res.status(403).json({
    error: 'YETKI_YETERSIZ',
    message: 'Bu işlemi gerçekleştirme yetkiniz yok.',
  });
}

function sendUnauthorized(res: Response) {
  res.status(401).json({
    error: 'KIMLIK_DOGRULANMADI',
    message: 'Bu işlem için kimlik doğrulaması gerekli. X-User-Id header\'ını gönderin.',
  });
}

/**
 * Kullanıcının kimlik doğrulamasını zorunlu kılar.
 * req.auth null ise 401 döndürür.
 * requireTenant'tan SONRA kullanılmalıdır (req.auth tenant middleware'i tarafından set edilir).
 */
export function requireAuth(): RequestHandler {
  return function authGuard(rawReq, res, next: NextFunction) {
    const req = rawReq as unknown as RequestWithTenant;
    if (!req.auth) {
      sendUnauthorized(res);
      return;
    }
    next();
  } as RequestHandler;
}

/**
 * Belirtilen rollerden en az birini gerektirir.
 * Kullanıcı kimliği doğrulanmamışsa 401, yanlış roldeyse 403 döndürür.
 * requireTenant'tan SONRA kullanılmalıdır.
 *
 * Kullanım: requireRole('ADMIN', 'MENTOR')
 */
export function requireRole(...roles: Array<'ADMIN' | 'MENTOR' | 'MENTI'>): RequestHandler {
  return function roleGuard(rawReq, res, next: NextFunction) {
    const req = rawReq as unknown as RequestWithTenant;

    // Önce kimlik doğrulaması kontrolü
    if (!req.auth) {
      sendUnauthorized(res);
      return;
    }

    // Ardından rol kontrolü
    if (!roles.includes(req.auth.role)) {
      sendForbidden(res);
      return;
    }

    next();
  } as RequestHandler;
}
