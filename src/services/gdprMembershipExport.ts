/**
 * AJ-124 — KVKK "verilerimi indir" çıktısına kurum üyeliği (TenantMembership) verisi.
 *
 * NEDEN: KVKK Md.11 erişim hakkı — kişi hakkında tutulan veri eksiksiz verilmeli. Kurum-içi rol,
 * sertifika durumu/denemeleri/bekleme süresi ve öğrenme yolculuğu tamamlama User'da değil
 * TenantMembership'te tutulur; önceki dışa aktarma bunları hiç döndürmüyordu.
 *
 * Bu dosya DB'ye dokunmaz (saf sabitler) — şema-kapsam birim testi (tests/aj124-*.unit.test.ts)
 * schema.prisma'daki TenantMembership alanlarını buradaki İZİN + HARİÇ listeleriyle karşılaştırır.
 * ⭐ Şemaya yeni üyelik alanı eklenince test KIRMIZI olur: alan ya MEMBERSHIP_EXPORT_SELECT'e
 * (dışa aktarılır) ya da MEMBERSHIP_EXPORT_EXCLUDED'a (gerekçeyle hariç) eklenmelidir.
 * Şüphede DAHİL et; sır/token/hash ASLA dahil edilmez.
 */

import type { Prisma } from '@prisma/client';

/**
 * Dışa aktarılan üyelik alanları (explicit select). `tenant` ilişkisi yalnız bağlam içindir:
 * kurumun adı ve kısa adı — kurumun başka üyelerine ait HİÇBİR veri seçilmez.
 */
export const MEMBERSHIP_EXPORT_SELECT = {
  tenantId: true,
  tenant: { select: { name: true, slug: true } },
  role: true,
  isActive: true,
  isCertified: true,
  certificationStatus: true,
  certScore: true,
  certifiedAt: true,
  certAttempts: true,
  cooldownUntil: true,
  certWrongTopics: true,
  certAdminNotifiedAt: true,
  learningJourneyCompletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantMembershipSelect;

/**
 * Bilinçli olarak dışa aktarılMAYAN üyelik alanları — her biri gerekçeli.
 * İlişki alanları (`user`, `tenant`) burada değil: şema testi yalnız skaler alanları karşılaştırır,
 * `tenant` bağlamı yukarıdaki select'te daraltılmış hâliyle yer alır.
 */
export const MEMBERSHIP_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: 'Teknik satır anahtarı; kişi hakkında bilgi taşımaz (kurum tenantId + tenant adıyla tanımlanır).',
  userId: 'Kişinin kendi kimliği; dışa aktarmanın en üstünde `userId` olarak zaten var (tekrar).',
  qualityMultiplier:
    'Kişi hakkında türetilmiş kalite puanı — erişim hakkı kapsamı PO kararı bekliyor (03-PO-ELLE-ISLER A11 / KARAR-91). "Evet" gelirse izin listesine taşınır.',
};

export type MembershipExport = Prisma.TenantMembershipGetPayload<{ select: typeof MEMBERSHIP_EXPORT_SELECT }>;

/**
 * Dışa aktarmanın üyelik kapsamı:
 *  - 'all'           → kişinin KENDİ isteği (self-servis): tüm kurum üyelikleri.
 *  - 'requestTenant' → başkası (kurum yöneticisi) dışa aktarıyor: yalnız isteğin yapıldığı kurumdaki
 *                      üyelik. Yönetici, kişinin başka kurumlardaki rol/sertifika bilgisini göremez.
 */
export type MembershipExportScope = 'all' | 'requestTenant';
