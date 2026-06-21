import type { NextFunction, Response } from 'express';
import { config } from '../config.js';
import type { RequestWithTenant } from '../types.js';
import { extractBearerToken, verifyToken } from './jwtAuth.js';
import { logger } from '../services/logger.js';
import { getCachedTenant } from '../services/tenantCache.js';
import { prisma, runWithTenant } from '../db.js';

/**
 * Çok-tenant izolasyon middleware'i — Sıfır Sızıntı Güvenlik Duvarı.
 *
 * Adımlar (sırayla):
 *  1. X-Tenant-Id header'ını oku ve tenant'ı cache üzerinden doğrula.
 *  2. Authorization Bearer JWT'yi doğrula (yoksa anonim RLS bağlamıyla devam).
 *  3. JWT tenant'ı ile istek tenant'ı eşleşiyor mu denetle (cross-tenant saldırı önlemi).
 *  4. Kullanıcının TenantMembership.isActive olduğunu doğrula (sıfır-sızıntı kapısı).
 *  5. Tüm downstream async zincirini runWithTenant ile RLS bağlamına al.
 *     Bu sayede Prisma extension tüm okuma sorgularına tenantId filtresi enjekte eder.
 */
export async function requireTenant(
  req: RequestWithTenant,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ── 1. Tenant kimliği ───────────────────────────────────────────────────────
  const headerTenantId = req.header('X-Tenant-Id')?.trim();
  const tenantId       = headerTenantId || config.defaultTenantId;

  if (!tenantId) {
    res.status(400).json({
      error:   'TENANT_GEREKLI',
      message: 'X-Tenant-Id header zorunludur.',
    });
    return;
  }

  const tenant = await getCachedTenant(tenantId);
  if (!tenant) {
    res.status(401).json({
      error:   'TENANT_GECERSIZ',
      message: 'Belirtilen tenant bulunamadı.',
    });
    return;
  }

  req.tenant = { tenantId };
  req.auth   = null;

  // ── 2. JWT çözümle ─────────────────────────────────────────────────────────
  const bearerToken = extractBearerToken(req.header('Authorization'));
  if (!bearerToken) {
    runWithTenant(tenantId, () => next());
    return;
  }

  const payload = verifyToken(bearerToken);
  if (!payload) {
    runWithTenant(tenantId, () => next());
    return;
  }

  // ── 3. Cross-Tenant Penetrasyon Engeli ────────────────────────────────────
  // JWT'deki tenantId ile X-Tenant-Id header'ı çelişiyorsa istek KESINLIKLE reddedilir.
  // 403 (Forbidden) kullanılır: kimlik doğrulandı ancak bu tenant'a erişim yetkisi yok.
  // 401 (Unauthorized) yanlış olur — kullanıcının kimliği biliniyor, yetkisi yok.
  if (payload.tenantId !== tenantId) {
    void logger.warn('AUTH', 'Cross-tenant penetrasyon girişimi engellendi', {
      tokenTenantId:     payload.tenantId,
      requestedTenantId: tenantId,
      userId:            payload.sub,
    });
    res.status(403).json({
      error:   'CROSS_TENANT_ERISIM_ENGELLENDI',
      message: 'Bu token başka bir kuruma ait. Kendi kurumunuzun bağlantısını kullanın.',
    });
    return;
  }

  // ── 4. Aktif TenantMembership doğrulama ────────────────────────────────────
  // findUnique kullanılır: RLS extension findUnique'i filtrelemez, bu yüzden
  // composite key'e (userId + tenantId) tam eşleşme güvenliği sağlar.
  const membership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId: payload.sub, tenantId } },
    select: { isActive: true },
  });

  if (!membership?.isActive) {
    void logger.warn('AUTH', 'Aktif üyeliği olmayan tenant erişim denemesi', {
      userId:   payload.sub,
      tenantId,
    });
    res.status(403).json({
      error:   'UYELIK_BULUNAMADI',
      message: 'Bu kurum için aktif üyeliğiniz bulunmuyor.',
    });
    return;
  }

  // ── 5. Auth context + RLS bağlamı ──────────────────────────────────────────
  req.auth = {
    userId:   payload.sub,
    role:     payload.role,
    fullName: payload.fullName,
  };

  runWithTenant(tenantId, () => next());
}
