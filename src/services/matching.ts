import { prisma } from '../db.js';
import { computeTotalScore, isAntiMatch, type DiscVector } from './scoring.js';
import { areTimeCommitmentsCompatible } from './temperamentAnalysis.js';

export type RankedMenti = {
  mentiId: string;
  mentiName: string;
  mentiTenantId: string;
  totalScore: number;
  sectorScore: number;
  discScore: number;
  confidence: number;   // 0-1 profil bütünlüğü; UI'da gösterilebilir
  skills: string[];
  fallbackLevel: 0 | 1 | 2 | 3;
  warnings: string[];
};

// Fallback kademeleri (tasarım belgesi Karar 2):
// 0: Tüm filtreler aktif
// 1: Zaman filtresi gevşetildi
// 2: Anti-match filtresi kaldırıldı
// 3: Sadece sektör uyumu (uyarı rozeti)

// Mentor için bu tenant'ta idari olarak bloklanmış menti ID kümesini oluşturur.
// JSON blob bozuk veya array değilse boş küme döner (defensive).
function buildBlockedMentiSet(mentorId: string, blockedPairs: unknown): Set<string> {
  if (!Array.isArray(blockedPairs)) return new Set();
  const blocked = new Set<string>();
  for (const pair of blockedPairs as Array<Record<string, unknown>>) {
    if (typeof pair !== 'object' || pair === null) continue;
    const from = pair['fromUserId'];
    const to   = pair['toUserId'];
    if (from === mentorId && typeof to   === 'string') blocked.add(to);
    if (to   === mentorId && typeof from === 'string') blocked.add(from);
  }
  return blocked;
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
    prisma.user.findFirst({
      where: { id: args.mentorId, tenantId: args.mentorTenantId, role: 'MENTOR', isActive: true },
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

  // Öncelik sırası: çağıranın arg'ı > mentor'un kaydedilmiş filtresi > tenant barajı
  const savedFilter = mentorFilter?.filterEnabled ? mentorFilter : null;
  const effectiveMinScore =
    args.minMatchScore ??
    (savedFilter?.minCompatibilityScore ? savedFilter.minCompatibilityScore : undefined) ??
    tenantConfig?.minMatchScoreThreshold;

  // excludeDiscTypes: arg > kaydedilmiş filtre (filterEnabled aktifse)
  const effectiveExcludeDiscTypes: Array<'D' | 'I' | 'S' | 'C'> =
    args.excludeDiscTypes ??
    (savedFilter?.blockedDiscTypes as Array<'D' | 'I' | 'S' | 'C'> | undefined) ??
    [];

  // BUG FIX: Admin'in idari blok listesini motora uygula (önceden hiç okunmuyordu).
  const blockedMentiIds = buildBlockedMentiSet(mentor.id, tenantConfig?.blockedPairs);

  // Güvenlik düzeltmesi: Cross-tenant adayları önceden filtrele.
  // Tüm shared-pool tenant ID'lerini tek sorguda çek; döngü içi N+1 sorgusunu önle.
  const sharedTenants = await prisma.tenant.findMany({
    where: { isSharedPoolActive: true },
    select: { id: true },
  });
  const sharedIds = new Set(sharedTenants.map((t) => t.id));

  // Eligibil tenant ID listesi: kendi tenant + her ikisi de shared pool'da olan tenant'lar
  const eligibleTenantIds = [
    mentor.tenantId,
    ...Array.from(sharedIds).filter(
      (id) => id !== mentor.tenantId && sharedIds.has(mentor.tenantId),
    ),
  ];

  // Tek sorguda yalnızca eligibil tenant'lardan aday çek (cross-tenant veri izolasyonu)
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      approvalStatus: 'APPROVED',
      role: 'MENTI',
      tenantId: { in: eligibleTenantIds },
    },
    select: {
      id: true,
      fullName: true,
      tenantId: true,
      sectorTags: true,
      discType: true,
      discVector: true,   // progressive profiling vektörü
      skills: true,
      timeCommitment: true,
      interactionStyle: true,
      expectationCategories: true,
    },
    take: 500,
  });

  const opts = {
    mentorTimeCommitment:   mentor.timeCommitment as string | null | undefined,
    mentorInteractionStyle: mentor.interactionStyle as string | null | undefined,
    mentorExpectations:     mentor.expectationCategories as string[],
    mentorTenantId:         mentor.tenantId,
    excludeDiscTypes:       effectiveExcludeDiscTypes,
    blockedMentiIds,        // idari blok listesi — her fallback kademe için uygulanır
  };

  const applyScoreFilter = (items: RankedMenti[]) =>
    effectiveMinScore !== undefined
      ? items.filter((m) => m.totalScore >= effectiveMinScore!)
      : items;

  const limit = args.limit ?? 50;

  const scored = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: true, applyAntiMatch: true, sectorOnly: false });
  const filtered0 = applyScoreFilter(scored);
  if (filtered0.length > 0) return { items: filtered0.slice(0, limit), fallbackLevel: 0 };

  const fallback1 = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: false, applyAntiMatch: true, sectorOnly: false });
  const filtered1 = applyScoreFilter(fallback1);
  if (filtered1.length > 0) {
    return { items: filtered1.slice(0, limit).map((m) => ({ ...m, fallbackLevel: 1 as const })), fallbackLevel: 1 };
  }

  const fallback2 = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: false, applyAntiMatch: false, sectorOnly: false });
  const filtered2 = applyScoreFilter(fallback2);
  if (filtered2.length > 0) {
    return { items: filtered2.slice(0, limit).map((m) => ({ ...m, fallbackLevel: 2 as const })), fallbackLevel: 2 };
  }

  const fallback3 = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: false, applyAntiMatch: false, sectorOnly: true });
  const filtered3 = applyScoreFilter(fallback3);
  return {
    items: filtered3.slice(0, limit).map((m) => ({
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
    excludeDiscTypes?: Array<'D' | 'I' | 'S' | 'C'>;
    blockedMentiIds?: Set<string>; // admin tarafından idari olarak bloklanmış menti IDs
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

    const breakdown = computeTotalScore({
      mentiTags: c.sectorTags,
      mentorTags: mentor.sectorTags,
      mentiDisc: opts.sectorOnly ? null : (c.discType as any),
      mentorDisc: opts.sectorOnly ? null : (mentor.discType as any),
      mentiVector,
    });

    const interactionBonus =
      !opts.sectorOnly &&
      c.interactionStyle &&
      opts.mentorInteractionStyle &&
      c.interactionStyle === opts.mentorInteractionStyle
        ? 10
        : 0;

    const totalScore = Math.min(100, Math.round((breakdown.totalScore + interactionBonus) * 10) / 10);

    filtered.push({
      mentiId: c.id,
      mentiName: c.fullName,
      mentiTenantId: c.tenantId,
      totalScore,
      sectorScore: breakdown.sectorScore,
      discScore: breakdown.discScore,
      confidence: breakdown.confidence,
      skills: c.skills,
      fallbackLevel: 0,
      warnings: [],
    });
  }

  filtered.sort((a, b) => b.totalScore - a.totalScore);
  return filtered;
}
