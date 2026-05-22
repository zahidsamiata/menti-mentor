import type { NextFunction, Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { RequestWithTenant } from '../types.js';
import { extractBearerToken, verifyToken } from './jwtAuth.js';

// Çok-tenant izolasyonu: tüm isteklerde tenantId zorunlu.
// Kimlik doğrulama önceliği:
//   1. Authorization: Bearer <JWT>  ← güvenli, imzalı
//   2. X-User-Id header              ← eski yöntem, geriye dönük uyumluluk
export async function requireTenant(req: RequestWithTenant, res: Response, next: NextFunction) {
  const headerTenantId = req.header('X-Tenant-Id')?.trim();
  const tenantId = headerTenantId || config.defaultTenantId;

  if (!tenantId) {
    res.status(400).json({
      error: 'TENANT_GEREKLI',
      message: 'X-Tenant-Id header zorunludur.',
    });
    return;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    res.status(401).json({
      error: 'TENANT_GECERSIZ',
      message: 'Belirtilen tenant bulunamadı.',
    });
    return;
  }

  req.tenant = { tenantId };

  // JWT Bearer token (tercih edilen yöntem)
  const bearerToken = extractBearerToken(req.header('Authorization'));
  if (bearerToken) {
    const payload = verifyToken(bearerToken);
    if (payload && payload.tenantId === tenantId) {
      req.auth = {
        userId: payload.sub,
        role: payload.role,
        fullName: payload.fullName,
      };
      return next();
    }
    // Token geçersiz ya da yanlış tenant — güvenlik nedeniyle 401 döndür
    if (payload && payload.tenantId !== tenantId) {
      res.status(401).json({
        error: 'KIMLIK_DOGRULANMADI',
        message: 'Token bu tenant için geçerli değil.',
      });
      return;
    }
    // Token imzası bozuk — auth olmadan devam et (anonim istek)
  }

  // X-User-Id geriye dönük uyumluluk (JWT yoksa)
  const userId = req.header('X-User-Id')?.trim();
  if (userId) {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
      select: { id: true, role: true, fullName: true },
    });
    req.auth = user
      ? { userId: user.id, role: user.role, fullName: user.fullName }
      : null;
  } else {
    req.auth = null;
  }

  next();
}
