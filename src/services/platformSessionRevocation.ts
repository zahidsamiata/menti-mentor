import { prisma } from '../db.js';
import { isAccessTokenRevoked, revokeAccessToken } from './accessTokenRevocation.js';

/**
 * AJ-51 — platform yöneticisi çıkışının sunucu yeniden başlatmasından sonra da geçerli kalması.
 *
 * SORUN: platform girişi ortam değişkenindeki kimlik bilgisiyle yapılır; DB'de oturum kaydı YOK
 * (kullanıcı anahtarlarındaki `sid` → RefreshToken bağı — AJ-31, membershipAccess.ts — burada
 * kurulamaz). Çıkış yalnız bellek-içi jti listesine yazıyordu (accessTokenRevocation.ts); süreç
 * yeniden başlayınca liste sıfırlanıyor, çıkış yapılmış platform anahtarı ömrü dolana kadar
 * (config.jwt.expiresIn, varsayılan 1h) yeniden geçerli oluyordu.
 *
 * ÇÖZÜM (migration YOK — mevcut `SystemLog` tablosu): çıkışta anahtarın `jti`'si + `exp`'i
 * SystemLog'a `AUTH` / `PLATFORM_LOGOUT` kaydı olarak yazılır. `requirePlatformAdmin` önce bellek
 * listesine bakar (verifyPlatformToken içinde); orada yoksa bu jti için anahtarın verildiği
 * andan (iat) sonra yazılmış bir çıkış kaydı arar. Bulunursa jti bellek listesine de eklenir →
 * aynı süreçte o anahtar için bir daha DB'ye gidilmez. Platform istekleri seyrek (tek yönetici),
 * istek başına tek indeksli sorgu kabul edilir: `level + category + createdAt` bileşik indeksi
 * (schema.prisma SystemLog) aralığı daraltır, `meta.jti` eşitliği kalan birkaç satırda süzülür.
 *
 * SAKLAMA: SystemLog kayıtları yalnız `purgeExpiredData` ile 90 gün sonra silinir
 * (gdprService.ts SYSTEM_LOG_RETENTION_DAYS) — anahtar ömrü (saatler) bundan çok kısadır,
 * çıkış kaydı anahtar yaşadığı sürece DB'de durur.
 *
 * JTI'SİZ ANAHTAR: `signToken` AJ-03'ten beri her anahtara jti yazar; jti'siz platform anahtarı
 * ancak AJ-03 öncesi imzalanmış olabilir ve ömrü (≤ config.jwt.expiresIn) çoktan dolmuştur.
 * Böyle bir anahtar zaten iptal listesine de giremez (iptal jti ister) → davranışı değişmez:
 * yalnız bellek kontrolü (fiilen kabul). AJ-87'nin tür-siz (typ'siz) geçiş anahtarları AJ-03
 * sonrası imzalandığı için jti TAŞIR → DB kontrolüne girer.
 */

export const PLATFORM_LOGOUT_CATEGORY = 'AUTH';
export const PLATFORM_LOGOUT_MESSAGE = 'PLATFORM_LOGOUT';

/**
 * Çıkış kaydı `createdAt`'i DB/uygulama saatiyle yazılır, `iat` imzalayanın saatiyledir; küçük saat
 * farkında kaydın aramanın dışında kalmaması için alt sınır bu kadar geriye çekilir.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export type PlatformSessionDecision =
  | { ok: true }
  | { ok: false; reason: 'REVOKED_IN_MEMORY' | 'LOGOUT_RECORDED' };

/**
 * Saf karar fonksiyonu (DB'siz birim testlenir).
 * @param jti               Anahtarın jti claim'i (yoksa undefined).
 * @param revokedInMemory   Bu süreçteki bellek-içi iptal listesinde mi.
 * @param logoutRecordFound DB'de bu jti için çıkış kaydı bulundu mu (jti yoksa sorgulanmaz → false).
 */
export function decidePlatformSession(
  jti: string | undefined,
  revokedInMemory: boolean,
  logoutRecordFound: boolean,
): PlatformSessionDecision {
  if (revokedInMemory) return { ok: false, reason: 'REVOKED_IN_MEMORY' };
  if (jti && logoutRecordFound) return { ok: false, reason: 'LOGOUT_RECORDED' };
  return { ok: true };
}

/** Anahtarın DB'de çıkış kaydını aramak gerekir mi — jti'siz anahtar ve bellekte iptal edilmiş anahtar için hayır. */
export function needsLogoutRecordLookup(jti: string | undefined, revokedInMemory: boolean): jti is string {
  return !revokedInMemory && typeof jti === 'string' && jti.length > 0;
}

async function findPlatformLogoutRecord(jti: string, iat: number | undefined): Promise<boolean> {
  const issuedAtMs = typeof iat === 'number' ? iat * 1000 : 0;
  const record = await prisma.systemLog.findFirst({
    where: {
      level:     'INFO',
      category:  PLATFORM_LOGOUT_CATEGORY,
      message:   PLATFORM_LOGOUT_MESSAGE,
      createdAt: { gte: new Date(issuedAtMs - CLOCK_SKEW_TOLERANCE_MS) },
      meta:      { path: ['jti'], equals: jti },
    },
    select: { id: true },
  });
  return record !== null;
}

/**
 * Platform anahtarının oturumu hâlâ açık mı? Bellek → (yoksa) DB. DB'de çıkış kaydı bulunursa
 * jti bellek listesine eklenir (önbellek). DB hatası yukarı fırlar → istek 500 ile kesilir
 * (kapalı başarısızlık; komşu `requireTenant` ile aynı).
 */
export async function resolvePlatformSession(payload: {
  jti?: string;
  iat?: number;
  exp?: number;
}): Promise<PlatformSessionDecision> {
  const revokedInMemory = isAccessTokenRevoked(payload.jti);
  let logoutRecordFound = false;
  if (needsLogoutRecordLookup(payload.jti, revokedInMemory)) {
    logoutRecordFound = await findPlatformLogoutRecord(payload.jti, payload.iat);
    if (logoutRecordFound && payload.exp) revokeAccessToken(payload.jti, payload.exp);
  }
  return decidePlatformSession(payload.jti, revokedInMemory, logoutRecordFound);
}

/**
 * Platform çıkışını kalıcı kaydeder: önce bellek listesi (bu süreç için anında), sonra SystemLog.
 * DB yazımı BEKLENİR; hata yukarı fırlatılır — çağıran (platformLogout) hatayı loglar ama çerezi
 * yine temizler (kullanıcının çıkışı engellenmez; bellek iptali bu süreçte geçerlidir).
 * meta yalnız jti + exp içerir — kişisel veri yok.
 */
export async function recordPlatformLogout(jti: string, exp: number): Promise<void> {
  revokeAccessToken(jti, exp);
  await prisma.systemLog.create({
    data: {
      level:    'INFO',
      category: PLATFORM_LOGOUT_CATEGORY,
      message:  PLATFORM_LOGOUT_MESSAGE,
      meta:     { jti, exp },
    },
  });
}
