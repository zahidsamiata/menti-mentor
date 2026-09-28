import type { Request, Response } from 'express';
import { logger } from '../services/logger.js';
import { extractBearerToken, verifyToken, type JwtPayload } from './jwtAuth.js';
import { ACCOUNT_INACTIVE_BODY, SESSION_REVOKED_BODY, resolveMembershipAccess } from './membershipAccess.js';
import { isTenantSuspended, TENANT_SUSPENDED_BODY } from './tenantSuspension.js';
import { getCachedTenant } from '../services/tenantCache.js';

/**
 * X-Tenant-Id header'ı KULLANMAYAN kurum-yöneticisi uçları için kimlik + yetki kapısı
 * (self-serve onboarding/davet/önizleme ve kurum ayarları: `/api/tenants/:id/...`).
 *
 * Neden ayrı yardımcı: bu uçlar `requireTenant` zincirinden geçmez; eskiden her controller kendi
 * `extractAdminPayload`'ını tutuyordu ve yalnız JWT imzası + anahtardaki `role === 'ADMIN'` bakıyordu. Token
 * ömrü boyunca, kurumdaki üyeliği kapatılmış (TenantMembership.isActive=false) ya da rolü
 * düşürülmüş bir yönetici kurum ayarlarını değiştirmeye devam edebiliyordu (GV-11).
 *
 * `requireTenant` (tenant.ts adım 4) ile AYNI kural uygulanır:
 *  - kurum-içi rol/erişim kaynağı `TenantMembership` (userId + tokenın tenantId'si) — `User.role` değil;
 *    anahtardaki `role` claim'i (= User.role) ön-kontrol olarak da KULLANILMAZ (AJ-118);
 *  - üyelik aktif DEĞİLSE veya üyelik rolü ADMIN DEĞİLSE 403;
 *  - hesap pasif / reddedilmişse 401 (GV-10; kural `membershipAccess.ts`'te, iki kapı ortak kullanır);
 *  - anahtarın oturumu (sid → RefreshToken) çıkışla kapatıldıysa 401 (AJ-31, aynı ortak kural);
 *  - platform token'ı (aud:'platform') tenant yönetici ucunda geçmez (domain ayrımı, platformAuth ile simetrik);
 *  - kurum askıdaysa (platform dondurdu / başvuru reddedildi) 403 KURUM_ASKIDA (Y1-B9, requireTenant 4b ile aynı).
 *
 * Kurum eşleşmesi (URL `:id` = token tenantId) GEREKEN uçlar bunu DOĞRUDAN çağırmaz:
 * `authenticateTenantAdminForParam` kullanır (AJ-44) — eşleşme tek yerde, yeni uçta unutulamaz.
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

  // AJ-118: anahtardaki `role` kişi-genel `User.role`'dür; kurum-içi yöneticilik kararı YALNIZ aşağıdaki
  // üyelik rolünden (access.role) verilir. Eskiden burada `payload.role !== 'ADMIN'` ön-kontrolü vardı:
  // üyelikte ADMIN ama User.role'ü MENTOR/MENTI kişi (AJ-115 sonrası yönetici panelini görür) bu uçlardan
  // reddediliyordu. Geçersiz anahtar ve platform anahtarı (aud) reddi aynen korunur.
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'ADMIN' || payload.aud !== undefined) {
    res.status(403).json({ error: 'YETKI_YOK', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
    return null;
  }

  // AJ-31: requireTenant ile aynı — anahtarın oturumu (sid) kapatıldıysa 401.
  const access = await resolveMembershipAccess(payload.sub, payload.tenantId, payload.sid);

  if (!access.ok && access.reason === 'SESSION_REVOKED') {
    res.status(401).json(SESSION_REVOKED_BODY);
    return null;
  }

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

/** `authenticateTenantAdminForParam` başarı sonucu: doğrulanmış kimlik + URL'deki (= oturumdaki) kurum. */
export interface TenantAdminParamContext {
  payload:  JwtPayload;
  tenantId: string;
}

/**
 * AJ-44 (F-23 kalanı): URL'de kurum kimliği taşıyan (`/api/tenants/:id/...`) kurum-yönetici uçlarının
 * TEK kapısı — `authenticateTenantAdmin` + URL `:paramName` ile oturumdaki (token) kurumun eşleşmesi.
 *
 * Neden: eşleşme eskiden her controller'da elle yazılıydı (`payload.tenantId !== tenantId`); bugün
 * hepsinde var ama yeni bir uçta unutulursa bir kurumun yöneticisi başka kurumun `:id`'siyle o
 * kurumun kaynağına yazabilirdi. Kimlik oturumdan gelir, URL yalnız eşleştirilir.
 *
 * Davranış eski elle kontrolle AYNI: eşleşmezse 403 `YETKI_YOK` + uca özel `mismatchMessage`
 * (mesaj uca özeldir, o yüzden parametre). Yanıt yazıldıysa `null` döner — çağıran yalnız `return` eder.
 */
export async function authenticateTenantAdminForParam(
  req: Request,
  res: Response,
  mismatchMessage: string,
  paramName = 'id',
): Promise<TenantAdminParamContext | null> {
  const payload = await authenticateTenantAdmin(req, res);
  if (!payload) return null;

  const tenantId = req.params[paramName];
  if (typeof tenantId !== 'string' || payload.tenantId !== tenantId) {
    res.status(403).json({ error: 'YETKI_YOK', message: mismatchMessage });
    return null;
  }

  return { payload, tenantId };
}
