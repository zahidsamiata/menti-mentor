/**
 * AJ-88 — Platform panelindeki "KVKK rızası Var/Yok" göstergesinin TEK kaynağı (saf, DB'siz).
 *
 * Neden: gösterge eskiden `User.kvkkConsentAt` alanından okunuyordu. Rıza geri çekilince
 * `consentService.revokeConsent` yalnız `Consent.revokedAt` yazar; eski alan değişmez →
 * geri çekilmiş rıza panelde "Var" görünürdü. Asıl kayıt `Consent` tablosudur.
 *
 * Neden `ACIK_RIZA`: kayıt akışı AYDINLATMA + ACIK_RIZA yazar (`SIGNUP_CONSENT_TYPES`), ama
 *  - AYDINLATMA bir onay değil bilgilendirme beyanıdır, geri çekilmez;
 *  - 2026-08-28 backfill'i eski kullanıcılar için YALNIZ ACIK_RIZA yazdı (`consentBackfill.ts`);
 *  - geri çekme (`gdprService` → `revokeConsent(..., 'ACIK_RIZA')`) yalnız ACIK_RIZA'yı kapatır;
 *  - `hasCurrentSignupConsent` da yalnız ACIK_RIZA'ya bakar.
 * Yani "KVKK rızası var mı" sorusunun cevabı = aktif (revokedAt=null) ACIK_RIZA satırı var mı.
 *
 * Kullanım: Prisma `select` içinde `consents: ACTIVE_KVKK_CONSENT_SELECT` → dönen dizi
 * `hasActiveKvkkConsent(...)`'e verilir. Eski `kvkkConsentAt` alanı BİLEREK okunmaz
 * (kaldırılması ayrı iş — silme protokolü).
 */
import type { ConsentType } from '@prisma/client';

export const KVKK_INDICATOR_CONSENT_TYPE: ConsentType = 'ACIK_RIZA';

/** Aktif rıza satırı sorgusu: yalnız id, en fazla 1 satır (varlık kontrolü — veri minimizasyonu). */
export const ACTIVE_KVKK_CONSENT_SELECT = {
  where: { type: KVKK_INDICATOR_CONSENT_TYPE, revokedAt: null },
  select: { id: true },
  take: 1,
} as const;

/** Gösterge değeri: aktif ACIK_RIZA satırı döndüyse true. */
export function hasActiveKvkkConsent(activeConsents: ReadonlyArray<{ id: string }>): boolean {
  return activeConsents.length > 0;
}
