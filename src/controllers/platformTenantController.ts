/**
 * Platform Admin — Kurum Derin Görünüm (deep panel) endpoint'leri.
 *
 * GÜVENLİK (DevSecOps — her handler için geçerli):
 *  • YETKİ: Tüm route'lar requirePlatformAdmin arkasında (platformRoutes). Ek olarak
 *    her handler platform token'ının aud:'platform' + isPlatformAdmin taşıdığını guard'dan
 *    geçmiş kabul eder; guard tek savunma olmasın diye handler'lar da salt-okuma + maskeli.
 *  • TENANT İZOLASYONU: Her sorgu `where: { tenantId }` ile filtrelidir; başka kurumun
 *    verisi sızamaz.
 *  • KVKK MASKELEME: E-posta maskeli döner (maskEmail); ham DISC vektörü / selfProfile /
 *    temperamentJson ASLA seçilmez/döndürülmez. Yalnızca discType (kategorik) gösterilir.
 *  • AUDIT (KVKK Md.12): Her görüntüleme, veri gönderilmeden ÖNCE SystemLog'a AUDIT olarak
 *    yazılır (actor + action + targetTenantId). "Loglanmadan gösterme" ilkesi.
 *  • VERİ MİNİMİZASYONU: Response'lar yalnızca panelin ihtiyacı olan alanları taşır.
 *
 * VERİ KAYNAĞI KARARLARI (keşif + kullanıcı onayı):
 *  • Kurum-içi mentör/menti AYRIMI ve SAYIMI → TenantMembership.role (User.role değil):
 *    rol kurum-bazlıdır; sertifika/journey de bu tabloda tutulur → tek tutarlı kaynak.
 *  • Görüşmeler → Meeting modeli (taraflar User; durum/tarih burada).
 *  • DISC analizi → User.discType kategorik dağılımı (ham profil yok).
 */

import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { maskEmail } from '../services/mask.js';
import { auditPlatformAction } from '../services/platformAudit.js';

const ROLES = ['ADMIN', 'MENTOR', 'MENTI'] as const;
const MEETING_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'IN_PROGRESS',
  'APPROVED',
  'COMPLETED',
  'CANCELLED',
] as const;

type Role = (typeof ROLES)[number];
type MeetingStatusStr = (typeof MEETING_STATUSES)[number];

const PAGE_SIZE = 50;

/** Denetim kaydını veri gönderilmeden ÖNCE yaz (loglanmadan gösterme). Ortak yardımcıya delege eder. */
async function audit(
  action: string,
  targetTenantId: string,
  req: Request,
  extra?: Record<string, unknown>,
): Promise<void> {
  await auditPlatformAction(action, req, { targetType: 'TENANT', targetTenantId, ...extra });
}

function parsePage(raw: unknown): number {
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Kurum var mı? Yoksa 404 döndürüp null verir (çağıran erken çıkar). */
async function requireTenant(
  tenantId: string,
  res: Response,
): Promise<{ id: string } | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Kurum bulunamadı.' });
    return null;
  }
  return tenant;
}

// GET /api/platform/tenants/:id/overview
export async function getTenantOverview(req: Request, res: Response) {
  const tenantId = req.params['id'] as string;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      verificationStatus: true,
      plan: true,
      isActive: true,
      createdAt: true,
    },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kurum bulunamadı.' });
  }

  const [membersByRole, meetingsByStatusRaw, lastMeeting, lastMember] = await Promise.all([
    // Kurum-içi rol sayımı: TenantMembership.role (aktif üyelikler)
    prisma.tenantMembership.groupBy({
      by: ['role'],
      where: { tenantId, isActive: true },
      _count: { _all: true },
    }),
    prisma.meeting.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    }),
    prisma.meeting.findFirst({
      where: { tenantId },
      orderBy: { startsAt: 'desc' },
      select: { startsAt: true },
    }),
    prisma.tenantMembership.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const roleCount = (r: Role): number =>
    membersByRole.find((m) => m.role === r)?._count._all ?? 0;

  const meetingsByStatus: Record<string, number> = {};
  let meetingTotal = 0;
  for (const row of meetingsByStatusRaw) {
    meetingsByStatus[row.status] = row._count._all;
    meetingTotal += row._count._all;
  }

  const mentors = roleCount('MENTOR');
  const mentis = roleCount('MENTI');
  const admins = roleCount('ADMIN');

  await audit('VIEW_TENANT_OVERVIEW', tenantId, req);

  return res.json({
    tenant,
    counts: {
      mentors,
      mentis,
      admins,
      members: mentors + mentis + admins,
      meetings: meetingTotal,
      meetingsByStatus,
    },
    activity: {
      lastMeetingAt: lastMeeting?.startsAt ?? null,
      lastMemberJoinedAt: lastMember?.createdAt ?? null,
    },
  });
}

// GET /api/platform/tenants/:id/members?role=&page=
export async function getTenantMembers(req: Request, res: Response) {
  const tenantId = req.params['id'] as string;
  if (!(await requireTenant(tenantId, res))) return;

  const roleParam = req.query['role'] as string | undefined;
  const role = roleParam && (ROLES as readonly string[]).includes(roleParam)
    ? (roleParam as Role)
    : undefined;
  const page = parsePage(req.query['page']);

  const where = { tenantId, isActive: true, ...(role ? { role } : {}) };

  const [total, memberships] = await Promise.all([
    prisma.tenantMembership.count({ where }),
    prisma.tenantMembership.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        isActive: true,
        createdAt: true,
        certificationStatus: true,
        isCertified: true,
        learningJourneyCompletedAt: true,
        // Yalnızca kimlik + kategorik DISC + KVKK rıza durumu. Ham profil alanları SEÇİLMEZ.
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            discType: true,
            kvkkConsentAt: true,
          },
        },
      },
    }),
  ]);

  const members = memberships.map((m) => ({
    id: m.user.id,
    fullName: m.user.fullName,
    role: m.role,
    isActive: m.isActive,
    joinedAt: m.createdAt,
    emailMasked: maskEmail(m.user.email), // KVKK: ham e-posta response'a girmez
    discType: m.user.discType,
    certificationStatus: m.certificationStatus,
    isCertified: m.isCertified,
    learningJourneyCompletedAt: m.learningJourneyCompletedAt,
    hasKvkkConsent: m.user.kvkkConsentAt != null,
  }));

  await audit('VIEW_TENANT_MEMBERS', tenantId, req, { role: role ?? 'ALL', page });

  return res.json({ total, page, members });
}

// GET /api/platform/tenants/:id/meetings?status=&page=
export async function getTenantMeetings(req: Request, res: Response) {
  const tenantId = req.params['id'] as string;
  if (!(await requireTenant(tenantId, res))) return;

  const statusParam = req.query['status'] as string | undefined;
  const status = statusParam && (MEETING_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as MeetingStatusStr)
    : undefined;
  const page = parsePage(req.query['page']);

  const where = { tenantId, ...(status ? { status } : {}) };

  const [total, meetings] = await Promise.all([
    prisma.meeting.count({ where }),
    prisma.meeting.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { startsAt: 'desc' },
      select: {
        id: true,
        startsAt: true,
        status: true,
        format: true,
        hasFeedback: true,
        mentor: { select: { id: true, fullName: true } },
        menti: { select: { id: true, fullName: true } },
      },
    }),
  ]);

  await audit('VIEW_TENANT_MEETINGS', tenantId, req, { status: status ?? 'ALL', page });

  return res.json({ total, page, meetings });
}

// GET /api/platform/tenants/:id/analytics
export async function getTenantAnalytics(req: Request, res: Response) {
  const tenantId = req.params['id'] as string;
  if (!(await requireTenant(tenantId, res))) return;

  // DISC dağılımı: kurumun aktif üyelerinin (TenantMembership) kategorik DISC tipi.
  // Ham DISC vektörü/profil ASLA okunmaz — yalnızca discType sayımı.
  const memberships = await prisma.tenantMembership.findMany({
    where: { tenantId, isActive: true },
    select: { user: { select: { discType: true } } },
  });

  const tally: Record<string, number> = {};
  let totalWithDisc = 0;
  for (const m of memberships) {
    const d = m.user.discType;
    if (d) {
      tally[d] = (tally[d] ?? 0) + 1;
      totalWithDisc += 1;
    }
  }
  const discDistribution = Object.entries(tally)
    .map(([discType, count]) => ({ discType, count }))
    .sort((a, b) => b.count - a.count);

  await audit('VIEW_TENANT_ANALYTICS', tenantId, req);

  return res.json({ totalWithDisc, discDistribution });
}
