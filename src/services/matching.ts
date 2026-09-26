import type { DiscType } from '@prisma/client';
import { prisma } from '../db.js';
import { computeTotalScore, isAntiMatch, computeMentorQualityMultiplier, type DiscVector } from './scoring.js';
import { getAlgorithmWeights } from './algorithmTuner.js';
import { areTimeCommitmentsCompatible } from './temperamentAnalysis.js';
import { computeProfileCompleteness } from './profile-completeness.service.js';
import { buildBlockedCounterpartSet } from './blockList.js';
import { isTenantSuspended, type TenantStatusFields } from '../middleware/tenantSuspension.js';

/** Paylaşımlı havuz kurumu — aday kurum listesi için gereken alanlar (askı durumu dahil). */
type SharedPoolTenant = { id: string } & TenantStatusFields;

/** Paylaşımlı havuz kurum sorgusunun select'i — iki yön de AYNI alanları okur. */
const SHARED_POOL_TENANT_SELECT = { id: true, isActive: true, verificationStatus: true } as const;

/**
 * Aday kurum listesi (iki yön ortak): istek kurumu + istek kurumu paylaşımlı havuzdaysa
 * havuzdaki DİĞER kurumlar.
 *
 * Y1-B9b: askıdaki (dondurulmuş / reddedilmiş) kurum havuzdan düşer — kullanıcıları başka
 * kurumların önerilerinde görünmez. Askı kuralı tek yerde: `isTenantSuspended`.
 * İstek kurumunun kendisi listede kalır (askıdaysa isteği zaten requireTenant 4b keser);
 * yalnız askıdaysa başka kurumların adaylarına da açılmaz.
 */
export function buildEligibleTenantIds(
  requestTenantId: string,
  sharedPoolTenants: ReadonlyArray<SharedPoolTenant>,
): string[] {
  const sharedIds = new Set(
    sharedPoolTenants.filter((t) => !isTenantSuspended(t)).map((t) => t.id),
  );
  return [
    requestTenantId,
    ...Array.from(sharedIds).filter((id) => id !== requestTenantId && sharedIds.has(requestTenantId)),
  ];
}

export type RankedMenti = {
  mentiId: string;
  mentiName: string;
  mentiTenantId: string;
  mentiAvatarUrl: string | null; // Kart gösterimi için public profil görseli (yoksa null → baş-harf fallback)
  totalScore: number;
  sectorScore: number;
  discScore: number;
  confidence: number;      // 0-1 profil bütünlüğü; UI'da gösterilebilir
  qualityMultiplier: number; // Mentorun geri bildirim katsayısı (1.0 = nötr)
  skills: string[];
  fallbackLevel: 0 | 1 | 2 | 3;
  warnings: string[];
};

// Fallback kademeleri (tasarım belgesi Karar 2):
// 0: Tüm filtreler aktif
// 1: Zaman filtresi gevşetildi
// 2: Anti-match filtresi kaldırıldı
// 3: Sadece sektör uyumu (uyarı rozeti)

// Tenant'a kayıtlı algoritma skor ağırlığını güvenli oku. algorithmTuner.getAlgorithmWeights
// zaten kayıt yoksa DEFAULT (0.6/0.4) döner; buradaki try/catch DB hatasında da varsayılana
// düşürerek canlı eşleştirmenin ASLA patlamamasını garanti eder (madde 87 fix).
async function getScoringWeightsSafe(
  tenantId: string,
): Promise<{ sectorWeight: number; discWeight: number }> {
  try {
    const w = await getAlgorithmWeights(tenantId);
    return { sectorWeight: w.sectorWeight, discWeight: w.discWeight };
  } catch {
    return { sectorWeight: 0.6, discWeight: 0.4 };
  }
}

// Kararlı sıralama (PS-01): eşit skorda id artan ayırıcı. Skor/sıralama mantığı değişmez;
// yalnız eşitlikte sıra her çağrıda aynı olur (ES2019 sort kararlı ama girdi sırası —
// ORDER BY'sız Postgres sonucu — garanti değildi). id karşılaştırması kod-birimi sırasıdır.
function byScoreDescThenId<T extends { totalScore: number }>(idOf: (item: T) => string) {
  return (a: T, b: T): number => {
    const diff = b.totalScore - a.totalScore;
    if (diff !== 0) return diff;
    const ia = idOf(a);
    const ib = idOf(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };
}

export async function rankMentisForMentor(args: {
  mentorId: string;
  mentorTenantId: string;
  limit?: number;
  /** Çağıran tarafından açıkça verilmezse tenant'ın minMatchScoreThreshold değeri taban olur. */
  minMatchScore?: number;
  excludeDiscTypes?: Array<'D' | 'I' | 'S' | 'C'>;
}): Promise<{ items: RankedMenti[]; fallbackLevel: 0 | 1 | 2 | 3 }> {
  // Mentor profili, tenant yapılandırması ve mentor'un kişisel filtresi paralel çek
  const [mentor, tenantConfig, mentorFilter] = await Promise.all([
    // Mentor sorgusu: User.role (global) yerine TenantMembership.role (tenant-başına) kontrol eder.
    // User.tenantId filtresi korunur — Prisma RLS extension override'ı için gerekli.
    prisma.user.findFirst({
      where: {
        id: args.mentorId,
        tenantId: args.mentorTenantId,
        isActive: true,
        memberships: {
          some: { tenantId: args.mentorTenantId, role: 'MENTOR', isActive: true },
        },
      },
      select: {
        id: true,
        tenantId: true,
        sectorTags: true,
        discType: true,
        timeCommitment: true,
        interactionStyle: true,
        expectationCategories: true,
      },
    }),
    prisma.tenant.findUnique({
      where:  { id: args.mentorTenantId },
      select: { minMatchScoreThreshold: true, blockedPairs: true },
    }),
    prisma.mentorFilter.findUnique({
      where:  { mentorId: args.mentorId },
      select: { minCompatibilityScore: true, blockedDiscTypes: true, filterEnabled: true },
    }),
  ]);
  if (!mentor) return { items: [], fallbackLevel: 0 };

  // Mentorun geçmiş geri bildirim kalite katsayısı (< 3 görüşme → 1.0 nötr)
  const qualityMultiplier = await computeMentorQualityMultiplier(args.mentorId);

  // Tenant'a kayıtlı skor ağırlığını sıralama başında BİR KEZ oku (N+1 yasak — döngü içinde çekilmez).
  // Okuma/hesap hata verirse eski varsayılan 0.6/0.4'e düş → sıralama asla patlamaz.
  const { sectorWeight, discWeight } = await getScoringWeightsSafe(args.mentorTenantId);

  // Öncelik sırası: çağıranın arg'ı > mentor'un kaydedilmiş filtresi > tenant barajı
  const savedFilter = mentorFilter?.filterEnabled ? mentorFilter : null;

  // explicitMinScore: Kullanıcının/mentorun doğrudan belirlediği eşik (API param + kaydedilmiş filtre).
  // Level 3 fallback'te de uygulanır — mentorun bilinçli seçimidir.
  const explicitMinScore =
    args.minMatchScore ??
    (savedFilter?.minCompatibilityScore ? savedFilter.minCompatibilityScore : undefined);

  // effectiveMinScore: Tam eşik (0-2 arası fallback'lerde kullanılır).
  // Tenant barajı deadlock önlemek için level 3'te atlanır.
  const effectiveMinScore = explicitMinScore ?? tenantConfig?.minMatchScoreThreshold;

  // excludeDiscTypes: arg > kaydedilmiş filtre (filterEnabled aktifse)
  const effectiveExcludeDiscTypes: Array<'D' | 'I' | 'S' | 'C'> =
    args.excludeDiscTypes ??
    (savedFilter?.blockedDiscTypes as Array<'D' | 'I' | 'S' | 'C'> | undefined) ??
    [];

  // BUG FIX: Admin'in idari blok listesini motora uygula (önceden hiç okunmuyordu).
  const blockedMentiIds = buildBlockedCounterpartSet(mentor.id, tenantConfig?.blockedPairs);

  // Güvenlik düzeltmesi: Cross-tenant adayları önceden filtrele.
  // Tüm shared-pool tenant ID'lerini tek sorguda çek; döngü içi N+1 sorgusunu önle.
  const sharedTenants = await prisma.tenant.findMany({
    where: { isSharedPoolActive: true },
    select: SHARED_POOL_TENANT_SELECT,
  });

  // Eligibil tenant ID listesi: istek tenant'ı + her ikisi de shared pool'da olan (askıda
  // olmayan, Y1-B9b) tenant'lar. mentor.tenantId (home tenant) değil args.mentorTenantId
  // (istek tenant'ı) temel alınır — cross-tenant membership'e sahip mentor senaryosunda ikisi farklı olabilir.
  const eligibleTenantIds = buildEligibleTenantIds(args.mentorTenantId, sharedTenants);

  // Aday sorgusu: User.role (global) yerine TenantMembership.role (tenant-başına) kontrol eder.
  // tenantId: { in: eligibleTenantIds } korunur — hem Prisma RLS override hem shared-pool genişlemesi için.
  // Filtreleme SIKILAŞTIRILDI: User.tenantId eligibility + per-tenant MENTI membership aktifliği.
  const candidates = await prisma.user.findMany({
    where: {
      // Kendi kendine eşleşme yok (PS-07 bulgusu): paylaşımlı havuzda aynı kişi başka kurumda
      // menti olabilir; aday listesinde kendini görmemeli (opt-in ucundaki SELF_MATCH_YASAK ile aynı kural).
      id: { not: args.mentorId },
      isActive: true,
      approvalStatus: 'APPROVED',
      tenantId: { in: eligibleTenantIds },
      memberships: {
        some: { tenantId: { in: eligibleTenantIds }, role: 'MENTI', isActive: true },
      },
    },
    select: {
      id: true,
      fullName: true,
      tenantId: true,
      sectorTags: true,
      discType: true,
      discVector: true,   // progressive profiling vektörü
      skills: true,
      avatarUrl: true,    // kart gösterimi — public profil görseli
      timeCommitment: true,
      interactionStyle: true,
      expectationCategories: true,
    },
    // Kararlı sıra (PS-01): take:500 kesmesi artık hep aynı 500 adayı seçer (id artan).
    // ⚠️ 500'den kalabalık havuzda kesme SKORDAN ÖNCE yapılır → id'si büyük adaylar hiç
    // skorlanmaz (kararlı ama kapsayıcı değil). Kapsayıcılık AN-07 (take:500 + cache) işidir.
    orderBy: { id: 'asc' },
    take: 500,
  });

  const opts = {
    mentorTimeCommitment:   mentor.timeCommitment as string | null | undefined,
    mentorInteractionStyle: mentor.interactionStyle as string | null | undefined,
    mentorExpectations:     mentor.expectationCategories as string[],
    mentorTenantId:         args.mentorTenantId,
    excludeDiscTypes:       effectiveExcludeDiscTypes,
    blockedMentiIds,        // idari blok listesi — her fallback kademe için uygulanır
    sectorWeight,           // tenant-özel skor ağırlığı — bir kez okundu, döngüye taşınır
    discWeight,
  };

  // strictFilter: 0-2 kademelerde tam eşiği uygular (tenant barajı dahil).
  // looseFilter:  Level 3 acil çıkışında yalnızca kullanıcı/mentor kaynaklı eşiği uygular.
  //               Tenant konfigürasyon barajı burada kasıtlı olarak atlanır.
  const strictFilter = (items: RankedMenti[]) =>
    effectiveMinScore !== undefined
      ? items.filter((m) => m.totalScore >= effectiveMinScore!)
      : items;

  const looseFilter = (items: RankedMenti[]) =>
    explicitMinScore !== undefined
      ? items.filter((m) => m.totalScore >= explicitMinScore!)
      : items;

  const limit = args.limit ?? 50;

  const scored = scoreAndFilter(candidates, mentor, { ...opts, qualityMultiplier, applyTimeFilter: true, applyAntiMatch: true, sectorOnly: false });
  const filtered0 = strictFilter(scored);
  if (filtered0.length > 0) return { items: filtered0.slice(0, limit), fallbackLevel: 0 };

  const fallback1 = scoreAndFilter(candidates, mentor, { ...opts, qualityMultiplier, applyTimeFilter: false, applyAntiMatch: true, sectorOnly: false });
  const filtered1 = strictFilter(fallback1);
  if (filtered1.length > 0) {
    return { items: filtered1.slice(0, limit).map((m) => ({ ...m, fallbackLevel: 1 as const })), fallbackLevel: 1 };
  }

  const fallback2 = scoreAndFilter(candidates, mentor, { ...opts, qualityMultiplier, applyTimeFilter: false, applyAntiMatch: false, sectorOnly: false });
  const filtered2 = strictFilter(fallback2);
  if (filtered2.length > 0) {
    return { items: filtered2.slice(0, limit).map((m) => ({ ...m, fallbackLevel: 2 as const })), fallbackLevel: 2 };
  }

  const fallback3 = scoreAndFilter(candidates, mentor, { ...opts, qualityMultiplier, applyTimeFilter: false, applyAntiMatch: false, sectorOnly: true });
  // Level 3 acil çıkış kapısıdır: yalnızca kullanıcı/mentor kaynaklı eşik (explicitMinScore)
  // uygulanır. Tenant konfigürasyon barajı (tenantConfig.minMatchScoreThreshold) atlanır —
  // aksi hâlde yüksek eşikli tenant'larda ilk eşleşme hiç oluşmaz (aktivasyon deadlock).
  return {
    items: looseFilter(fallback3).slice(0, limit).map((m) => ({
      ...m,
      fallbackLevel: 3 as const,
      warnings: ['Mizaç uyumu düşük — ilerlemeden önce beklentileri konuşmanız önerilir.'],
    })),
    fallbackLevel: 3,
  };
}

type Candidate = {
  id: string;
  fullName: string;
  tenantId: string;
  sectorTags: string[];
  discType: string | null;
  discVector: unknown;          // DB'den gelen JSON — DiscVector olarak cast edilir
  skills: string[];
  avatarUrl: string | null;
  timeCommitment: string | null;
  interactionStyle: string | null;
  expectationCategories: string[];
};

// Senkron filtre — DB çağrısı yok (N+1 sorunu giderildi)
function scoreAndFilter(
  candidates: Candidate[],
  mentor: { id: string; tenantId: string; sectorTags: string[]; discType: string | null },
  opts: {
    mentorTenantId: string;
    mentorTimeCommitment: string | null | undefined;
    mentorInteractionStyle: string | null | undefined;
    mentorExpectations: string[];
    applyTimeFilter: boolean;
    applyAntiMatch: boolean;
    sectorOnly: boolean;
    qualityMultiplier?: number;
    excludeDiscTypes?: Array<'D' | 'I' | 'S' | 'C'>;
    blockedMentiIds?: Set<string>; // admin tarafından idari olarak bloklanmış menti IDs
    sectorWeight?: number;         // tenant-özel skor ağırlığı (verilmezse computeTotalScore varsayılanı 0.6)
    discWeight?: number;           // tenant-özel DISC ağırlığı (verilmezse 0.4)
  },
): RankedMenti[] {
  const filtered: RankedMenti[] = [];

  for (const c of candidates) {
    // İdari blok kontrolü — her fallback kademesinde uygulanır, atlanamaz
    if (opts.blockedMentiIds?.has(c.id)) continue;

    // Mentor'ın DISC dışlama listesi — mentor panelinden gelen özel filtre
    if (opts.excludeDiscTypes && opts.excludeDiscTypes.length > 0 && c.discType) {
      if (opts.excludeDiscTypes.includes(c.discType as 'D' | 'I' | 'S' | 'C')) continue;
    }

    if (opts.applyTimeFilter && opts.mentorTimeCommitment && c.timeCommitment) {
      if (!areTimeCommitmentsCompatible(opts.mentorTimeCommitment, c.timeCommitment)) continue;
    }

    if (opts.mentorExpectations.length > 0 && c.expectationCategories.length > 0) {
      const hasCommon = c.expectationCategories.some((e) => opts.mentorExpectations.includes(e));
      if (!hasCommon) continue;
    }

    if (opts.applyAntiMatch && isAntiMatch(mentor.discType as any, c.discType as any)) continue;

    // Kesirli vektörü güvenli şekilde cast et
    const mentiVector = opts.sectorOnly ? null : (c.discVector as DiscVector | null);

    const interactionBonus =
      !opts.sectorOnly &&
      c.interactionStyle &&
      opts.mentorInteractionStyle &&
      c.interactionStyle === opts.mentorInteractionStyle
        ? 10
        : 0;

    const breakdown = computeTotalScore({
      mentiTags: c.sectorTags,
      mentorTags: mentor.sectorTags,
      mentiDisc: opts.sectorOnly ? null : (c.discType as any),
      mentorDisc: opts.sectorOnly ? null : (mentor.discType as any),
      mentiVector,
      qualityMultiplier: opts.qualityMultiplier ?? 1.0,
      sectorWeight: opts.sectorWeight,
      discWeight: opts.discWeight,
    });

    const totalScore = Math.min(100, Math.round((breakdown.totalScore + interactionBonus * (opts.qualityMultiplier ?? 1.0)) * 10) / 10);

    filtered.push({
      mentiId: c.id,
      mentiName: c.fullName,
      mentiTenantId: c.tenantId,
      mentiAvatarUrl: c.avatarUrl,
      totalScore,
      sectorScore: breakdown.sectorScore,
      discScore: breakdown.discScore,
      confidence: breakdown.confidence,
      qualityMultiplier: opts.qualityMultiplier ?? 1.0,
      skills: c.skills,
      fallbackLevel: 0,
      warnings: [],
    });
  }

  filtered.sort(byScoreDescThenId((m) => m.mentiId));
  return filtered;
}

// ─── Menti → Mentör sıralama (SALT-OKUMA — canlı eşleştirmeye dokunmaz) ────────
//
// GÜVENLİ YOL: mevcut skorlama motorunu (computeTotalScore) TERS yönde yeniden kullanır —
// yeni algoritma YOK. rankMentisForMentor (mentör→menti, canlı eşleştirme) DEĞİŞMEZ; bu
// yalnızca menti'nin "bana uygun mentörler" kartını beslemek için ayrı bir okuma yoludur.
// Menti kendi profiliyle her mentöre karşı uyum skorunu görür (yüzde). KARAR 5 gereği
// çıktı mentörün discType'ını İÇERMEZ; DTO (controller) yalnızca skor + jenerik gerekçe döndürür.

export type RankedMentor = {
  mentorId: string;
  mentorName: string;
  mentorAvatarUrl: string | null;
  sectorTags: string[];
  skills: string[];
  totalScore: number;
  sectorScore: number;
  // discScore İÇ hesaptır — menti response'una (controller DTO'su) KOYULMAZ. Yalnızca
  // "İletişim tarzları uyumlu" gibi jenerik (harfsiz) gerekçe üretmek için kullanılır.
  discScore: number;
  confidence: number;
  // AN-28 · KARAR-80/M7 + KARAR-32 revizyonu: mentör GERÇEKTEN randevu alınabilir mi?
  // isVisibilityFaded/isProfileFaded ara-sebeplerdir (testte ayrı doğrulanır); menti-facing
  // DTO'ya (matchingController.buildMentiFacingMentorItem) yalnızca isFaded + isBookable geçer.
  isVisibilityFaded: boolean; // mentör kendi görünürlüğünü kapatmış (User.mentorVisibilityEnabled=false)
  isProfileFaded: boolean;    // mentörün profili "çekirdek tamamlanma" eşiğini geçmemiş
  isBookable: boolean;        // en az bir aktif müsaitlik bloğu VAR ve görünürlük açık — randevu alınabilir
  isFaded: boolean;           // kart soluk mu? (KARAR-80/M7: kart HER ZAMAN kalır, yalnız soluklaşır)
};

export async function rankMentorsForMenti(args: {
  mentiId: string;
  mentiTenantId: string;
  limit?: number;
}): Promise<{ items: RankedMentor[] }> {
  // Menti'nin KENDİ profili — MENTI membership doğrulaması (tenant-başına rol kaynağı).
  const menti = await prisma.user.findFirst({
    where: {
      id: args.mentiId,
      tenantId: args.mentiTenantId,
      isActive: true,
      memberships: { some: { tenantId: args.mentiTenantId, role: 'MENTI', isActive: true } },
    },
    select: { id: true, tenantId: true, sectorTags: true, discType: true, discVector: true },
  });
  if (!menti) return { items: [] };

  // Eligible tenant listesi: kendi tenant'ı + her iki taraf da shared-pool ise diğerleri
  // (rankMentisForMentor ile AYNI cross-tenant güvenlik deseni).
  // tenantConfig aynı Promise.all'da okunur (N+1 yasak) — KR-19: idari blok listesi
  // (blockedPairs) daha önce bu yönde HİÇ okunmuyordu, yalnız rankMentisForMentor
  // (mentör→menti) tarafında uygulanıyordu. Hangi tenant'ın blockedPairs'ı okunacağı
  // rankMentisForMentor ile SİMETRİK: çağıranın KENDİ tenant'ı (args.mentiTenantId) —
  // mentörün home tenant'ı değil. Cross-tenant'ta karşı tarafın admin'inin koyduğu blok
  // bu yönden görünmez; bu rankMentisForMentor'un da mevcut davranışıdır (tutarlılık).
  const [sharedTenants, tenantConfig] = await Promise.all([
    prisma.tenant.findMany({
      where: { isSharedPoolActive: true },
      select: SHARED_POOL_TENANT_SELECT,
    }),
    prisma.tenant.findUnique({
      where:  { id: args.mentiTenantId },
      select: { blockedPairs: true },
    }),
  ]);
  // Y1-B9b: askıdaki kurumlar havuzdan düşer (buildEligibleTenantIds).
  const eligibleTenantIds = buildEligibleTenantIds(args.mentiTenantId, sharedTenants);

  // BUG FIX (KR-19): Admin'in idari blok listesi bu yönde de uygulanır — önceden hiç
  // okunmuyordu, engellenen mentör menti'nin listesinde görünmeye devam ediyordu.
  const blockedMentorIds = buildBlockedCounterpartSet(menti.id, tenantConfig?.blockedPairs);

  const rawMentors = await prisma.user.findMany({
    where: {
      id: { not: args.mentiId }, // kendi kendine eşleşme yok (bkz. rankMentisForMentor)
      isActive: true,
      approvalStatus: 'APPROVED',
      tenantId: { in: eligibleTenantIds },
      memberships: { some: { tenantId: { in: eligibleTenantIds }, role: 'MENTOR', isActive: true } },
    },
    select: {
      id: true,
      tenantId: true,
      fullName: true,
      avatarUrl: true,
      sectorTags: true,
      discType: true,
      skills: true,
      mentorVisibilityEnabled: true,
    },
    // Kararlı sıra (PS-01): take:500 kesmesi artık hep aynı 500 adayı seçer (id artan).
    // ⚠️ 500'den kalabalık havuzda kesme SKORDAN ÖNCE yapılır → id'si büyük adaylar hiç
    // skorlanmaz (kararlı ama kapsayıcı değil). Kapsayıcılık AN-07 (take:500 + cache) işidir.
    orderBy: { id: 'asc' },
    take: 500,
  });

  // İdari blok kontrolü — sonraki müsaitlik/tamamlanma sorgularından ÖNCE filtrelenir
  // (blocklu mentör için gereksiz sorgu yapılmaz).
  const mentors = blockedMentorIds.size > 0
    ? rawMentors.filter((m) => !blockedMentorIds.has(m.id))
    : rawMentors;

  const mentiVector = menti.discVector as DiscVector | null;

  // Tenant-özel skor ağırlığını .map() döngüsünden ÖNCE bir kez oku (N+1 yasak).
  // Hata → varsayılan 0.6/0.4 (patlama yok).
  const { sectorWeight, discWeight } = await getScoringWeightsSafe(args.mentiTenantId);

  // AN-28: "randevu alınabilir mi" — en az bir aktif müsaitlik bloğu var mı, TEK toplu sorguyla
  // (N+1 yasak, CLAUDE.md "Koşullu Paralellik"). groupBy, mentör başına ayrı sorgu yerine tüm
  // adayları tek seferde döner.
  const mentorIds = mentors.map((m) => m.id);
  const activeBlockGroups = mentorIds.length
    ? await prisma.availabilityBlock.groupBy({
        by: ['userId'],
        where: { userId: { in: mentorIds }, tenantId: { in: eligibleTenantIds }, isActive: true },
        _count: true,
      })
    : [];
  const bookableUserIds = new Set(activeBlockGroups.map((g) => g.userId));

  // AN-28/U-19: profil "çekirdek tamamlanma" — computeProfileCompleteness UserProfile yoksa
  // THROW eder (nadir ama olası: mentör onboarding'i bitirmemiş). Tek mentörün profili eksik
  // diye TÜM liste çökmesin → try/catch, güvenli varsayılan = soluk göster (coreComplete:false).
  const coreCompleteFlags = await Promise.all(
    mentors.map(async (m) => {
      try {
        const result = await computeProfileCompleteness(m.id, m.tenantId);
        return result.coreComplete;
      } catch {
        return false;
      }
    }),
  );

  const items: RankedMentor[] = mentors.map((m, idx) => {
    const breakdown = computeTotalScore({
      mentiTags:   menti.sectorTags,
      mentorTags:  m.sectorTags,
      mentiDisc:   menti.discType as DiscType | null,
      mentorDisc:  m.discType as DiscType | null,
      mentiVector,
      sectorWeight,
      discWeight,
    });

    const isVisibilityFaded = !m.mentorVisibilityEnabled;
    const hasActiveBlock    = bookableUserIds.has(m.id);
    const isBookable         = hasActiveBlock && m.mentorVisibilityEnabled;
    const isProfileFaded    = !coreCompleteFlags[idx];
    const isFaded           = isVisibilityFaded || isProfileFaded || !isBookable;

    return {
      mentorId:        m.id,
      mentorName:      m.fullName,
      mentorAvatarUrl: m.avatarUrl,
      sectorTags:      m.sectorTags,
      skills:          m.skills,
      totalScore:      breakdown.totalScore,
      sectorScore:     breakdown.sectorScore,
      discScore:       breakdown.discScore,
      confidence:      breakdown.confidence,
      isVisibilityFaded,
      isProfileFaded,
      isBookable,
      isFaded,
    };
  });

  items.sort(byScoreDescThenId((m) => m.mentorId));
  return { items: args.limit ? items.slice(0, args.limit) : items };
}
