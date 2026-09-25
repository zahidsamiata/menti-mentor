import type { NextFunction, Response } from 'express';
import { config } from '../config.js';
import type { RequestWithTenant } from '../types.js';
import { extractBearerToken, verifyToken } from './jwtAuth.js';
import { logger } from '../services/logger.js';
import { getCachedTenant } from '../services/tenantCache.js';
import { runWithTenant } from '../db.js';
import { ACCOUNT_INACTIVE_BODY, resolveMembershipAccess } from './membershipAccess.js';

/**
 * Çok-tenant izolasyon middleware'i — Sıfır Sızıntı Güvenlik Duvarı.
 *
 * Adımlar (sırayla):
 *  1. X-Tenant-Id header'ını oku ve tenant'ı cache üzerinden doğrula.
 *  2. Authorization Bearer JWT'yi doğrula (yoksa anonim RLS bağlamıyla devam).
 *  3. JWT tenant'ı ile istek tenant'ı eşleşiyor mu denetle (cross-tenant saldırı önlemi).
 *  4. Kullanıcının TenantMembership.isActive olduğunu doğrula (sıfır-sızıntı kapısı);
 *     hesap pasif/reddedilmişse 401. Kurum-içi rol JWT'den DEĞİL üyelikten okunur (GV-10).
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

  // ── 4. Aktif üyelik + açık hesap doğrulama (tek sorgu; bkz. membershipAccess.ts) ──
  const access = await resolveMembershipAccess(payload.sub, tenantId);

  if (!access.ok && access.reason === 'ACCOUNT_INACTIVE') {
    // Reddedilen / pasife alınan kullanıcı: elindeki access token süresi dolmadan kesilir.
    void logger.warn('AUTH', 'Pasif veya reddedilmiş hesapla erişim denemesi', {
      userId:   payload.sub,
      tenantId,
    });
    res.status(401).json(ACCOUNT_INACTIVE_BODY);
    return;
  }

  if (!access.ok) {
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
  // Rol üyelikten gelir: token alındıktan sonra rolü değişen (ör. yöneticilikten düşürülen)
  // kullanıcı bir sonraki istekte yeni rolüyle değerlendirilir. Fark loglanmaz: token ömrü boyunca
  // her istekte SystemLog satırı yazardı.
  req.auth = {
    userId:   payload.sub,
    role:     access.role,
    fullName: payload.fullName,
  };

  runWithTenant(tenantId, () => next());
}
