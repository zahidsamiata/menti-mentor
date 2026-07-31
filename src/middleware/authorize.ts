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
    message: 'Bu işlem için kimlik doğrulaması gerekli. Authorization: Bearer <token> header\'ını gönderin.',
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

/**
 * Kaynak sahibi (self) VEYA ADMIN erişimini zorunlu kılar — IDOR koruması.
 *
 * NEDEN middleware (satır-içi değil): "kendi kaydı mı?" kontrolü kod tabanında
 * birçok controller'da (patchSelfProfile, gdprController, temperamentController,
 * adaptiveTestController) tekrarlanıyordu. Route seviyesinde tek yerde toplanınca
 * yeni `:id` endpoint'lerinin yetkilendirmesi tek satıra iner ve controller iş
 * mantığına odaklanır — requireAuth/requireRole ile aynı katman.
 *
 * GÜVENLİK: yalnızca "giriş yapmış olmak" YETMEZ. Yoldaki kaynak id'si istek
 * sahibininki değil ve rol ADMIN değilse 403. Böylece kullanıcı `:id`'yi
 * başkasınınkiyle değiştirerek kaynağına (ör. PII profili) erişemez.
 *
 * requireTenant'tan SONRA kullanılmalıdır (req.auth set edilmiş olmalı).
 */
export function requireSelfOrAdmin(paramName = 'id'): RequestHandler {
  return function selfOrAdminGuard(rawReq, res, next: NextFunction) {
    const req = rawReq as unknown as RequestWithTenant;

    if (!req.auth) {
      sendUnauthorized(res);
      return;
    }

    const isSelf = req.auth.userId === req.params[paramName];
    const isAdmin = req.auth.role === 'ADMIN';
    if (!isSelf && !isAdmin) {
      sendForbidden(res);
      return;
    }

    next();
  } as RequestHandler;
}
