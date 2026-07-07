/**
 * Polimorfik Eşleşme Arayüzü
 *
 * Mevcut akış: USER (mentor ↔ menti)
 * Planlı akış:  JOB_LISTING (aday ↔ ilan)
 *
 * Yeni bir MatchTargetType eklemek için:
 *   1. Prisma enum'a yeni değer ekle (ör. CLUB_MENTOR)
 *   2. Bu dosyada MatchStrategy implementasyonu yaz
 *   3. matchingRouter'a ilgili handler'ı kaydet
 *   4. MatchRequest tablosu değişmez — sadece targetType değişir
 */

import type { DiscVector } from './scoring.js';

// ─── Soyut arayüzler ──────────────────────────────────────────────────────────

export type MatchCandidate = {
  id: string;
  label: string;           // Kullanıcı adı veya ilan başlığı
  tenantId: string;
  sectorTags: string[];
  score: number;           // 0-100
  metadata?: Record<string, unknown>;
};

export type MatchContext = {
  requesterId: string;
  requesterTenantId: string;
  requesterSectorTags: string[];
  requesterDiscType?: string | null;
  requesterDiscVector?: DiscVector | null;
};

export interface MatchStrategy {
  targetType: string;
  /**
   * Adayları skor sırasına göre döndürür.
   * Her implementasyon kendi tenant izolasyonundan sorumludur.
   */
  rank(context: MatchContext, limit: number): Promise<MatchCandidate[]>;
}

// ─── Strategy kayıt defteri ───────────────────────────────────────────────────

const registry = new Map<string, MatchStrategy>();

export function registerMatchStrategy(strategy: MatchStrategy): void {
  registry.set(strategy.targetType, strategy);
}

export function getMatchStrategy(targetType: string): MatchStrategy | undefined {
  return registry.get(targetType);
}

// ─── USER strategy stub (mevcut matching.ts sarmalanmış hali) ────────────────
// Gerçek implementasyon matching.ts'te; bu dosya sadece arayüzü tanımlar.
// Yeni bir implementasyon için aşağıdaki yapıyı kullanın:
//
// class JobListingMatchStrategy implements MatchStrategy {
//   targetType = 'JOB_LISTING';
//
//   async rank(context: MatchContext, limit: number): Promise<MatchCandidate[]> {
//     // 1. context.requesterSectorTags ile ilanları eşleştir
//     // 2. computeSectorScore kullan
//     // 3. Tenant izolasyonunu uygula
//     const listings = await prisma.jobListing.findMany({
//       where: {
//         tenantId: context.requesterTenantId,
//         isActive: true,
//       },
//       take: limit,
//     });
//     return listings.map(l => ({
//       id: l.id,
//       label: l.title,
//       tenantId: l.tenantId,
//       sectorTags: l.tags,
//       score: computeSectorScore(context.requesterSectorTags, l.tags),
//     }));
//   }
// }

/**
 * Job Board Özelliği — Ekleme Rehberi
 *
 * MatchTargetType=JOB_LISTING akışı şu anda desteklenmektedir (Prisma modeli mevcut).
 * Aktive etmek için:
 *
 * 1. `src/services/jobMatchingStrategy.ts` oluştur (yukarıdaki stub'ı kullan)
 * 2. `src/controllers/matchingController.ts`'e yeni endpoint ekle:
 *      GET /api/mentis/:mentiId/matching-jobs
 * 3. `src/routes/` içine route ekle
 * 4. `registerMatchStrategy(new JobListingMatchStrategy())` çağır
 *
 * Mevcut MatchRequest tablosu BİLDİRİMSİZ DEĞİŞTİRİLMEZ — polimorfik yapı
 * targetType ve targetId (string UUID) ile her tür hedefi destekler.
 *
 * DISC skoru iş ilanları için anlamlı değil → skor sadece sector overlap (100%).
 */
