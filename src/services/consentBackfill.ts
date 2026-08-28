/**
 * G1-07 Backfill — SAF mantık (DB'siz, yan-etkisiz, test edilebilir).
 *
 * Eski `kvkkConsentAt` dolu User/Tenant kayıtları için yazılacak Consent satırlarını hesaplar.
 * ⭐ PO KARARI (2026-08-28): YALNIZ `ACIK_RIZA` — `AYDINLATMA` YAZILMAZ (eski kullanıcılar ayrı
 * aydınlatma onayı görmedi; olmamış onayı kayda geçirmek eksik kayıttan kötü).
 * Idempotent: özne zaten ACIK_RIZA taşıyorsa atlanır.
 *
 * DB I/O yapan çalıştırıcı: scripts/backfill-consent.ts (tsx). Bu modül yalnız hesaplar.
 */
import type { ConsentSource, ConsentType } from '@prisma/client';

export const LEGACY_VERSION = 'v1.0-legacy';

export type SubjectWithConsent = { id: string; kvkkConsentAt: Date | null };
export type ExistingConsent = { userId: string | null; tenantId: string | null };
export type BackfillRow = {
  userId: string | null;
  tenantId: string | null;
  type: ConsentType;
  version: string;
  grantedAt: Date;
  source: ConsentSource;
};

export function planBackfill(input: {
  users: SubjectWithConsent[];
  tenants: SubjectWithConsent[];
  existing: ExistingConsent[];
}): { rows: BackfillRow[]; missingUsers: SubjectWithConsent[]; missingTenants: SubjectWithConsent[] } {
  const { users, tenants, existing } = input;
  const haveUser = new Set(existing.map((c) => c.userId).filter((x): x is string => Boolean(x)));
  const haveTenant = new Set(existing.map((c) => c.tenantId).filter((x): x is string => Boolean(x)));

  // kvkkConsentAt dolu + henüz ACIK_RIZA'sı olmayan özneler.
  const missingUsers = users.filter((u) => u.kvkkConsentAt && !haveUser.has(u.id));
  const missingTenants = tenants.filter((t) => t.kvkkConsentAt && !haveTenant.has(t.id));

  const rows: BackfillRow[] = [
    ...missingUsers.map((u) => ({
      userId: u.id, tenantId: null, type: 'ACIK_RIZA' as ConsentType,
      version: LEGACY_VERSION, grantedAt: u.kvkkConsentAt as Date, source: 'BACKFILL' as ConsentSource,
    })),
    ...missingTenants.map((t) => ({
      userId: null, tenantId: t.id, type: 'ACIK_RIZA' as ConsentType,
      version: LEGACY_VERSION, grantedAt: t.kvkkConsentAt as Date, source: 'BACKFILL' as ConsentSource,
    })),
  ];
  return { rows, missingUsers, missingTenants };
}
