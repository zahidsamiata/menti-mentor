/**
 * Basit otomatik kötüye-kullanım tespiti (v1).
 *
 * Ağır ML YOK — mevcut veriden türeyen iki basit kural (işaretleme):
 *  1. Çok şikayet alan kullanıcı (UserReport, DISMISSED hariç).
 *  2. Çok reddedilen menti talebi (VisibilityOptIn REJECTED).
 * Daha gelişmiş sinyaller (mesaj spam'i, no-show oranı) SONRAYA bırakıldı (kapsam şişmesin).
 *
 * `tenantId` verilmezse sistem-geneli çalışır (platform admin); verilirse tek kuruma scoped.
 */

import { prisma } from '../db.js';

export const REPORT_FLAG_THRESHOLD = 2; // N+ şikayet alan işaretlenir
export const REJECTION_FLAG_THRESHOLD = 3; // N+ reddedilmiş talep işaretlenir

export type AnomalyFlag = {
  userId: string;
  fullName: string;
  tenantId: string;
  reportCount: number;
  rejectionCount: number;
  reasons: string[];
};

export async function detectAnomalies(tenantId?: string): Promise<AnomalyFlag[]> {
  const tenantWhere = tenantId ? { tenantId } : {};

  const [reportGroups, rejectionGroups] = await Promise.all([
    prisma.userReport.groupBy({
      by: ['targetUserId'],
      where: { ...tenantWhere, status: { not: 'DISMISSED' } },
      _count: { id: true },
      having: { id: { _count: { gte: REPORT_FLAG_THRESHOLD } } },
    }),
    prisma.visibilityOptIn.groupBy({
      by: ['mentiId'],
      where: { ...tenantWhere, status: 'REJECTED' },
      _count: { id: true },
      having: { id: { _count: { gte: REJECTION_FLAG_THRESHOLD } } },
    }),
  ]);

  const map = new Map<string, { reportCount: number; rejectionCount: number }>();
  for (const g of reportGroups) map.set(g.targetUserId, { reportCount: g._count.id, rejectionCount: 0 });
  for (const g of rejectionGroups) {
    const e = map.get(g.mentiId) ?? { reportCount: 0, rejectionCount: 0 };
    e.rejectionCount = g._count.id;
    map.set(g.mentiId, e);
  }

  const ids = [...map.keys()];
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, ...tenantWhere },
    select: { id: true, fullName: true, tenantId: true },
  });

  return users.map((u) => {
    const c = map.get(u.id) ?? { reportCount: 0, rejectionCount: 0 };
    const reasons: string[] = [];
    if (c.reportCount >= REPORT_FLAG_THRESHOLD) reasons.push(`${c.reportCount} şikayet`);
    if (c.rejectionCount >= REJECTION_FLAG_THRESHOLD) reasons.push(`${c.rejectionCount} reddedilmiş talep`);
    return { userId: u.id, fullName: u.fullName, tenantId: u.tenantId, reportCount: c.reportCount, rejectionCount: c.rejectionCount, reasons };
  }).sort((a, b) => (b.reportCount + b.rejectionCount) - (a.reportCount + a.rejectionCount));
}
