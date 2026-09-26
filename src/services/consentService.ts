/**
 * KVKK Rıza (Consent) Servisi — G1-07
 *
 * Tipli + sürümlü + geri-alınabilir rıza kayıtları.
 * Tasarım: docs/kararlar/konu/consent-modeli-plani-2026-08-28.md
 *
 * İlkeler:
 *   - `kvkkConsentAt` (User/Tenant) ile DUAL-WRITE: eski alan legacy ispat olarak
 *     yazılmaya devam eder (geri alma yolu); Consent tablosu tipli/sürümlü kaydı tutar.
 *   - "Güncel rıza" = özne+type için `revokedAt = null` olan EN YENİ `grantedAt` satırı.
 *   - Geri çekme = aktif satıra `revokedAt = now()`; YENİ SATIR AÇILMAZ (ileriye dönük).
 *   - Sürüm geçmişi korunur: aynı özne+type için ikinci rıza YENİ satır açar, eskisi silinmez.
 *
 * Not (tenant-scope): `Consent` KASITLI olarak `db.ts` TENANT_SCOPED listesinde DEĞİL —
 * birey rızası (userId dolu, tenantId null) GLOBAL'dir; kurum rızası (tenantId dolu) kurumun
 * kendisine aittir. RLS filtresi bu tabloya uygulanmaz.
 */
import type { ConsentType, ConsentSource, Consent } from '@prisma/client';
import type { PrismaExtended } from '../db.js';
import { prisma } from '../db.js';
import { logger } from './logger.js';

/**
 * Rıza metni sürümü.
 * TODO(G1-10): avukat aydınlatma metni gelince sürüm sabitlenecek; metin değişince artırılır
 * ve `hasValidConsent(..., requiredVersion)` eski sürümleri geçersiz sayar (yeniden onay).
 */
export const CONSENT_VERSION = 'v1.0';

// Extended client (db.ts) VEYA onun $transaction client'ı kabul edilir — ikisinde de
// `consent` delegate'i var (bkz. membership.ts aynı Pick deseni). Kayıt akışında aynı
// transaction'a bağlanabilmek için tüm fonksiyonlar opsiyonel `db` alır.
type Db = Pick<PrismaExtended, 'consent'>;

/** Rıza öznesi: userId (birey) VEYA tenantId (kurum) — TAM OLARAK biri dolu. */
export type ConsentSubject = { userId?: string | null; tenantId?: string | null };

export type RecordConsentOpts = {
  source: ConsentSource;
  version?: string; // varsayılan CONSENT_VERSION
  grantedAt?: Date; // varsayılan now(); backfill kvkkConsentAt geçer
  db?: Db; // kayıt transaction'ı (atomiklik)
};

/** Özneyi doğrula: userId ⊻ tenantId (tam biri). Aksi halde hata (ikisi dolu / ikisi boş). */
function normalizeSubject(subject: ConsentSubject): { userId: string | null; tenantId: string | null } {
  const userId = subject.userId ?? null;
  const tenantId = subject.tenantId ?? null;
  if (Boolean(userId) === Boolean(tenantId)) {
    throw new Error('Consent öznesi geçersiz: userId VEYA tenantId — tam olarak biri dolu olmalı.');
  }
  return { userId, tenantId };
}

/**
 * Kayıt akışında yazılan rıza tipleri. Tek onay kutusu (G1-01) HER İKİ tipi de kapsar
 * (KVKK Aydınlatma Metni linki gösterilir + açık rıza verilir); ayrı kutular G1-08 işi.
 *
 * ⚠️ GERİYE DÖNÜK UYUMLULUK (AN-30, 2026-09-26): granüler rıza (aşağıda) FLAG'lı olarak
 * eklendi; bu sabit ve `recordSignupConsent` SİLİNMEDİ — eski istemciler (flag kapalıyken
 * FE, doğrudan API çağıran entegrasyonlar) hâlâ bunu kullanır. Davranış BİREBİR aynı kaldı.
 */
export const SIGNUP_CONSENT_TYPES: ConsentType[] = ['AYDINLATMA', 'ACIK_RIZA'];

/**
 * AN-30 / KARAR-34 — kayıt ekranında ZORUNLU rıza grubu (hepsi onaylanmadan kayıt olmaz).
 * KARAR-34 SORU 1: DISC eşleştirme · yurt dışı saklama · veri işleme · anonim iyileştirme.
 * `AYDINLATMA`/`ACIK_RIZA` eski tek-kutu davranışıyla aynı anlamı taşıdığı için bu grupta
 * kalmaya devam eder (granüler ekranda da gösterilir, yalnız birleşik metin yerine ayrı).
 */
export const MANDATORY_SIGNUP_CONSENT_TYPES: ConsentType[] = [
  'AYDINLATMA',
  'ACIK_RIZA',
  'DISC_ESLESTIRME',
  'YURT_DISI_SAKLAMA',
  'VERI_ISLEME',
  'ANONIM_IYILESTIRME',
];

/**
 * AN-30 / KARAR-34 — kayıt ekranında İSTEĞE BAĞLI rıza grubu. Onaylanmazsa kayıt yine de
 * tamamlanır; ilgili tip için SATIR YAZILMAZ (rıza verilmemiş = kayıt yok, doğru KVKK davranışı).
 */
export const OPTIONAL_SIGNUP_CONSENT_TYPES: ConsentType[] = ['KURUMLARARASI_PAYLASIM', 'OCEAN_PROFIL'];

/**
 * Kayıt akışı için AYDINLATMA + ACIK_RIZA'yı tek seferde yazar (dual-write yardımcısı).
 * Kayıt transaction'ında `db: tx` geçilerek atomik yazılır (rızasız kayıt olmamalı).
 */
export async function recordSignupConsent(
  subject: ConsentSubject,
  source: ConsentSource,
  opts: { db?: Db; grantedAt?: Date; version?: string } = {},
): Promise<void> {
  await recordConsentBatch(subject, SIGNUP_CONSENT_TYPES, { source, ...opts });
}

/**
 * AN-30 / KARAR-34 — kayıt ekranında AYRI AYRI onay kutularıyla toplanan rızayı yazar.
 *
 * `granted.mandatory` çağıran tarafından (Zod `z.literal(true)` ile) ZATEN doğrulanmış olmalı;
 * burada yeniden kontrol edilmez — yalnız MANDATORY_SIGNUP_CONSENT_TYPES'ın tamamı yazılır.
 * İsteğe bağlı tipler yalnız `true` ise yazılır; `false`/`undefined` için SATIR AÇILMAZ.
 */
export async function recordGranularSignupConsent(
  subject: ConsentSubject,
  granted: { mandatory: true; crossTenantSharing?: boolean; oceanProfiling?: boolean },
  opts: { source: ConsentSource; db?: Db; grantedAt?: Date; version?: string },
): Promise<void> {
  const types: ConsentType[] = [...MANDATORY_SIGNUP_CONSENT_TYPES];
  if (granted.crossTenantSharing) types.push('KURUMLARARASI_PAYLASIM');
  if (granted.oceanProfiling) types.push('OCEAN_PROFIL');
  await recordConsentBatch(subject, types, opts);
}

/** Tek tip rıza kaydı oluşturur (yeni satır — sürüm geçmişi korunur). */
export async function recordConsent(
  subject: ConsentSubject,
  type: ConsentType,
  opts: RecordConsentOpts,
): Promise<void> {
  await recordConsentBatch(subject, [type], opts);
}

/**
 * Birden çok tipi TEK seferde kaydeder (ör. kayıtta AYDINLATMA + ACIK_RIZA birlikte).
 * FE'de henüz ayrı kutu yok (G1-08 işi); kod hazır — tek onay iki tipi de yazar.
 */
export async function recordConsentBatch(
  subject: ConsentSubject,
  types: ConsentType[],
  opts: RecordConsentOpts,
): Promise<void> {
  if (types.length === 0) return;
  const { userId, tenantId } = normalizeSubject(subject);
  const db = opts.db ?? prisma;
  const version = opts.version ?? CONSENT_VERSION;
  const grantedAt = opts.grantedAt ?? new Date();

  await db.consent.createMany({
    data: types.map((type) => ({ userId, tenantId, type, version, grantedAt, source: opts.source })),
  });
}

/** Özne+type için aktif (revokedAt=null) en yeni rızayı döner; yoksa null. */
export async function getActiveConsent(
  subject: ConsentSubject,
  type: ConsentType,
  db: Db = prisma,
): Promise<Consent | null> {
  const { userId, tenantId } = normalizeSubject(subject);
  return db.consent.findFirst({
    where: { userId, tenantId, type, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  });
}

/** Öznenin TÜM rıza kayıtları (denetim izi) — en yeni önce. */
export async function getAllConsents(subject: ConsentSubject, db: Db = prisma): Promise<Consent[]> {
  const { userId, tenantId } = normalizeSubject(subject);
  return db.consent.findMany({
    where: { userId, tenantId },
    orderBy: { grantedAt: 'desc' },
  });
}

/**
 * Aktif rızayı geri çeker: aktif satıra revokedAt=now(); YENİ SATIR AÇILMAZ.
 * Sınır durumları (hata DEĞİL):
 *   - Aktif rıza yoksa → no-op + log, { revoked: false }
 *   - Zaten geri çekilmişse → aktif bulunmaz → no-op (idempotent)
 */
export async function revokeConsent(
  subject: ConsentSubject,
  type: ConsentType,
  db: Db = prisma,
): Promise<{ revoked: boolean }> {
  const { userId, tenantId } = normalizeSubject(subject);
  const active = await db.consent.findFirst({
    where: { userId, tenantId, type, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  });
  if (!active) {
    void logger.info('SYSTEM', 'Consent revoke: aktif rıza yok, no-op', { userId, tenantId, type });
    return { revoked: false };
  }
  await db.consent.update({ where: { id: active.id }, data: { revokedAt: new Date() } });
  return { revoked: true };
}

/**
 * Geçerli rıza var mı? Aktif rıza yoksa false. `requiredVersion` verilirse ve aktif rızanın
 * sürümü eskiyse (metin güncellenmiş) false → yeniden onay gerekir.
 */
export async function hasValidConsent(
  subject: ConsentSubject,
  type: ConsentType,
  requiredVersion?: string,
  db: Db = prisma,
): Promise<boolean> {
  const active = await getActiveConsent(subject, type, db);
  if (!active) return false;
  if (requiredVersion && active.version !== requiredVersion) return false;
  return true;
}
