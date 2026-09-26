import type { Request, Response } from 'express';
import { logger } from '../services/logger.js';
import { extractBearerToken, verifyToken, type JwtPayload } from './jwtAuth.js';
import { ACCOUNT_INACTIVE_BODY, resolveMembershipAccess } from './membershipAccess.js';
import { isTenantSuspended, TENANT_SUSPENDED_BODY } from './tenantSuspension.js';
import { getCachedTenant } from '../services/tenantCache.js';

/**
 * X-Tenant-Id header'ı KULLANMAYAN kurum-yöneticisi uçları için kimlik + yetki kapısı
 * (self-serve onboarding/davet/önizleme ve kurum ayarları: `/api/tenants/:id/...`).
 *
 * Neden ayrı yardımcı: bu uçlar `requireTenant` zincirinden geçmez; eskiden her controller kendi
 * `extractAdminPayload`'ını tutuyordu ve yalnız JWT imzası + `role === 'ADMIN'` bakıyordu. Token
 * ömrü boyunca, kurumdaki üyeliği kapatılmış (TenantMembership.isActive=false) ya da rolü
 * düşürülmüş bir yönetici kurum ayarlarını değiştirmeye devam edebiliyordu (GV-11).
 *
 * `requireTenant` (tenant.ts adım 4) ile AYNI kural uygulanır:
 *  - kurum-içi rol/erişim kaynağı `TenantMembership` (userId + tokenın tenantId'si) — `User.role` değil;
 *  - üyelik aktif DEĞİLSE veya üyelik rolü ADMIN DEĞİLSE 403;
 *  - hesap pasif / reddedilmişse 401 (GV-10; kural `membershipAccess.ts`'te, iki kapı ortak kullanır);
 *  - platform token'ı (aud:'platform') tenant yönetici ucunda geçmez (domain ayrımı, platformAuth ile simetrik);
 *  - kurum askıdaysa (platform dondurdu / başvuru reddedildi) 403 KURUM_ASKIDA (Y1-B9, requireTenant 4b ile aynı).
 *
 * Kurum eşleşmesi (URL `:id` = token tenantId) çağıran controller'da kalır; hata mesajı uca özeldir.
 */
export async function authenticateTenantAdmin(
  req: Request,
  res: Response,
): Promise<JwtPayload | null> {
  const token = extractBearerToken(req.header('Authorization'));
  if (!token) {
    res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'JWT token gereklidir.' });
    return null;
  }

  const payload = verifyToken(token);
  if (!payload || payload.role !== 'ADMIN' || payload.aud !== undefined) {
    res.status(403).json({ error: 'YETKI_YOK', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
    return null;
  }

  const access = await resolveMembershipAccess(payload.sub, payload.tenantId);

  if (!access.ok && access.reason === 'ACCOUNT_INACTIVE') {
    void logger.warn('AUTH', 'Pasif veya reddedilmiş hesapla kurum-yönetici ucu denemesi', {
      userId:   payload.sub,
      tenantId: payload.tenantId,
    });
    res.status(401).json(ACCOUNT_INACTIVE_BODY);
    return null;
  }

  if (!access.ok || access.role !== 'ADMIN') {
    void logger.warn('AUTH', 'Aktif yönetici üyeliği olmayan kurum-yönetici ucu denemesi', {
      userId:   payload.sub,
      tenantId: payload.tenantId,
    });
    res.status(403).json({
      error:   'UYELIK_BULUNAMADI',
      message: 'Bu kurum için aktif yönetici üyeliğiniz bulunmuyor.',
    });
    return null;
  }

  const tenant = await getCachedTenant(payload.tenantId);
  if (!tenant || isTenantSuspended(tenant)) {
    res.status(403).json(TENANT_SUSPENDED_BODY);
    return null;
  }

  return payload;
}
