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

export async function rankMentisForMentor(args: {
  mentorId: string;
  mentorTenantId: string;
  limit?: number;
}): Promise<{ items: RankedMenti[]; fallbackLevel: 0 | 1 | 2 | 3 }> {
  const mentor = await prisma.user.findFirst({
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
  });
  if (!mentor) return { items: [], fallbackLevel: 0 };

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
    mentorTimeCommitment: mentor.timeCommitment as string | null | undefined,
    mentorInteractionStyle: mentor.interactionStyle as string | null | undefined,
    mentorExpectations: mentor.expectationCategories as string[],
    mentorTenantId: mentor.tenantId,
  };

  const scored = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: true, applyAntiMatch: true, sectorOnly: false });
  if (scored.length > 0) return { items: scored.slice(0, args.limit ?? 50), fallbackLevel: 0 };

  const fallback1 = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: false, applyAntiMatch: true, sectorOnly: false });
  if (fallback1.length > 0) {
    return { items: fallback1.slice(0, args.limit ?? 50).map((m) => ({ ...m, fallbackLevel: 1 as const })), fallbackLevel: 1 };
  }

  const fallback2 = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: false, applyAntiMatch: false, sectorOnly: false });
  if (fallback2.length > 0) {
    return { items: fallback2.slice(0, args.limit ?? 50).map((m) => ({ ...m, fallbackLevel: 2 as const })), fallbackLevel: 2 };
  }

  const fallback3 = scoreAndFilter(candidates, mentor, { ...opts, applyTimeFilter: false, applyAntiMatch: false, sectorOnly: true });
  return {
    items: fallback3.slice(0, args.limit ?? 50).map((m) => ({
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
  },
): RankedMenti[] {
  const filtered: RankedMenti[] = [];

  for (const c of candidates) {
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
