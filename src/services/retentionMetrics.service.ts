/**
 * Retention / "kimse kaynıyor mu" metrikleri — STK yönetici paneli (S2 sorusu).
 *
 * Üç risk grubu + arz-talep dengesi hesaplar. Hepsi TEK tenant'a scoped (yönetici başka
 * kurumu görmez) ve admin-only endpoint'ten servis edilir. Ham DISC/discVector DÖNMEZ —
 * yalnızca yöneticinin kendi üyesini tanıması için gereken alanlar (ad, rol, zaman damgası).
 *
 * Drill-down (İŞ 4) için her metrik hem `count` (gerçek toplam) hem de sınırlı bir `items`
 * listesi döndürür. Liste CAP ile sınırlanır (büyük tenant'ta dev payload olmasın);
 * count > items.length ise UI "+N daha" gösterir.
 */

import { prisma } from '../db.js';

// Drill-down listesi başına azami öğe. Gerçek toplam `count`'ta; liste yalnızca gösterim.
const DRILLDOWN_CAP = 100;

export const DEFAULT_PASSIVE_DAYS = 30;
export const DEFAULT_STALE_MATCH_DAYS = 14;

type MemberItem = { id: string; fullName: string; avatarUrl: string | null; role: string; lastLoginAt: Date | null; createdAt: Date };
type DeadMatchItem = { optInId: string; mentorId: string; mentiId: string; mentorName: string; mentiName: string; since: Date };

export type HealthMetrics = {
  thresholds: { passiveDays: number; staleMatchDays: number };
  supplyDemand: { mentors: number; mentis: number; ratio: number | null };
  mentorlessMenti: { count: number; items: Array<Pick<MemberItem, 'id' | 'fullName' | 'avatarUrl' | 'createdAt'>> };
  deadMatches: { count: number; items: DeadMatchItem[] };
  passiveMembers: { count: number; items: Array<Pick<MemberItem, 'id' | 'fullName' | 'role' | 'lastLoginAt' | 'createdAt'>> };
};

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export async function computeHealthMetrics(
  tenantId: string,
  opts: { passiveDays?: number; staleMatchDays?: number } = {},
): Promise<HealthMetrics> {
  const passiveDays = opts.passiveDays ?? DEFAULT_PASSIVE_DAYS;
  const staleMatchDays = opts.staleMatchDays ?? DEFAULT_STALE_MATCH_DAYS;
  const passiveCutoff = daysAgo(passiveDays);
  const staleCutoff = daysAgo(staleMatchDays);

  // ── Arz-talep dengesi (rol dağılımı) ──────────────────────────────────────
  const roleCounts = await prisma.user.groupBy({
    by: ['role'],
    where: { tenantId, isActive: true, approvalStatus: 'APPROVED' },
    _count: { id: true },
  });
  const mentors = roleCounts.find((r) => r.role === 'MENTOR')?._count.id ?? 0;
  const mentis = roleCounts.find((r) => r.role === 'MENTI')?._count.id ?? 0;

  // ── Mentörsüz menti: onaylı aktif menti, APPROVED opt-in'i olmayan ─────────
  const mentorlessWhere = {
    tenantId,
    role: 'MENTI' as const,
    isActive: true,
    approvalStatus: 'APPROVED' as const,
    mentiOptIns: { none: { status: 'APPROVED' as const } },
  };

  // ── Pasif üye: onaylı aktif, X gündür giriş yok. Hiç giriş yapmamış (null) ise
  //    yalnızca kayıt tarihi de eşiği geçtiyse say (yeni üyeye ödemesiz süre tanı). ──
  const passiveWhere = {
    tenantId,
    isActive: true,
    approvalStatus: 'APPROVED' as const,
    OR: [
      { lastLoginAt: { lt: passiveCutoff } },
      { lastLoginAt: null, createdAt: { lt: passiveCutoff } },
    ],
  };

  const [
    mentorlessCount,
    mentorlessItems,
    passiveCount,
    passiveItems,
    approvedOptIns,
    meetingPairs,
  ] = await Promise.all([
    prisma.user.count({ where: mentorlessWhere }),
    prisma.user.findMany({
      where: mentorlessWhere,
      select: { id: true, fullName: true, avatarUrl: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, // en uzun bekleyen üstte
      take: DRILLDOWN_CAP,
    }),
    prisma.user.count({ where: passiveWhere }),
    prisma.user.findMany({
      where: passiveWhere,
      select: { id: true, fullName: true, role: true, lastLoginAt: true, createdAt: true },
      orderBy: { lastLoginAt: { sort: 'asc', nulls: 'first' } }, // en pasif üstte
      take: DRILLDOWN_CAP,
    }),
    // Ölü eşleşme adayları: X gün+ önce onaylanmış opt-in'ler
    prisma.visibilityOptIn.findMany({
      where: { tenantId, status: 'APPROVED', createdAt: { lt: staleCutoff } },
      select: {
        id: true, mentorId: true, mentiId: true, createdAt: true,
        mentor: { select: { fullName: true } },
        menti: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Bu tenant'ta görüşmesi olan (mentor,menti) çiftleri — "hiç görüşmemiş" farkı için
    prisma.meeting.findMany({
      where: { tenantId },
      select: { mentorUserId: true, mentiUserId: true },
      distinct: ['mentorUserId', 'mentiUserId'],
    }),
  ]);

  // Ölü eşleşme = onaylı opt-in (X gün+) AMA çift arasında HİÇ görüşme kaydı yok.
  const metPairs = new Set(meetingPairs.map((m) => `${m.mentorUserId}:${m.mentiUserId}`));
  const deadAll = approvedOptIns.filter((o) => !metPairs.has(`${o.mentorId}:${o.mentiId}`));
  const deadItems: DeadMatchItem[] = deadAll.slice(0, DRILLDOWN_CAP).map((o) => ({
    optInId: o.id,
    mentorId: o.mentorId,
    mentiId: o.mentiId,
    mentorName: o.mentor.fullName,
    mentiName: o.menti.fullName,
    since: o.createdAt,
  }));

  return {
    thresholds: { passiveDays, staleMatchDays },
    supplyDemand: {
      mentors,
      mentis,
      ratio: mentis > 0 ? Math.round((mentors / mentis) * 100) / 100 : null,
    },
    mentorlessMenti: { count: mentorlessCount, items: mentorlessItems },
    deadMatches: { count: deadAll.length, items: deadItems },
    passiveMembers: { count: passiveCount, items: passiveItems },
  };
}
