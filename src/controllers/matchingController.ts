import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { rankMentisForMentor, rankMentorsForMenti, type RankedMenti, type RankedMentor } from '../services/matching.js';
import { canCrossTenantMatch } from '../services/tenantSharing.js';

// KARAR 3: qualityMultiplier kullanıcıya gösterilmez (gizli yorumları dolaylı sızdırır).
// DISC tipi açıklanmaz; bunun yerine nitel uyum gerekçesi üretilir.
function buildPublicItem(item: RankedMenti) {
  const { qualityMultiplier: _hidden, ...rest } = item;
  const reasons: string[] = [];
  if (item.sectorScore > 0) reasons.push('Ortak sektör ve ilgi alanları');
  if (item.discScore > 0)   reasons.push('İletişim tarzları uyumlu');
  return { ...rest, compatibilityReason: reasons.join(' · ') || 'Genel profil uyumu' };
}

const DISC_VALUES = ['D', 'I', 'S', 'C'] as const;

const RankQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // Mentor özel filtresi: minimum uyum puanı (0-100)
  minMatchScore: z.coerce.number().min(0).max(100).optional(),
  // Mentor özel filtresi: dışlanacak DISC tipleri, virgülle ayrılmış (örn: "D,S")
  excludeDiscTypes: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return v
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter((t): t is 'D' | 'I' | 'S' | 'C' => (DISC_VALUES as readonly string[]).includes(t));
    }),
});

// Mentor, sistemin ürettiği sıralı menti listesini görür.
// Opsiyonel filtreler: ?minMatchScore=70&excludeDiscTypes=D,S
export async function getRankedMentisForMentor(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;

  // IDOR koruması: route ADMIN|MENTOR'a açık ama bir MENTOR yalnızca KENDİ aday
  // listesini görebilmeli; başka bir mentörün mentorId'sini geçerek onun aday
  // havuzunu (PII/skor) görmesi engellenir. ADMIN kendi tenant'ındaki her mentörü görür.
  const isAdmin = req.auth?.role === 'ADMIN';
  const isOwner = req.auth?.userId === mentorId;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      error: 'YETKISIZ',
      message: 'Yalnızca kendi aday listenizi görüntüleyebilirsiniz.',
    });
  }

  const parsed = RankQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const result = await rankMentisForMentor({
    mentorId,
    mentorTenantId: req.tenant.tenantId,
    limit: parsed.data.limit,
    minMatchScore: parsed.data.minMatchScore,
    excludeDiscTypes: parsed.data.excludeDiscTypes,
  });

  return res.json({
    items: result.items.map(buildPublicItem),
    fallbackLevel: result.fallbackLevel,
  });
}

// ─── Menti → Mentör uyum kartı (menti-facing, KARAR 5 güvenli) ────────────────
// KARAR 5: menti mentörün DISC tipini GÖRMEZ — yalnız uyum skorunu (yüzde) + jenerik
// gerekçe görür. buildMentiFacingMentorItem çıktısında discType YOK, discScore YOK ve
// compatibilityReason harf içermez ("İletişim tarzları uyumlu" — hangi DISC olduğu belli değil).
function buildMentiFacingMentorItem(m: RankedMentor) {
  const reasons: string[] = [];
  if (m.sectorScore > 0) reasons.push('Ortak sektör ve ilgi alanları');
  if (m.discScore > 0)   reasons.push('İletişim tarzları uyumlu'); // jenerik — DISC harfi/tipi sızmaz
  return {
    mentorId:        m.mentorId,
    mentorName:      m.mentorName,
    mentorAvatarUrl: m.mentorAvatarUrl,
    sectorTags:      m.sectorTags,
    skills:          m.skills,
    matchScore:      Math.round(m.totalScore), // menti'ye yüzde olarak gösterilir
    compatibilityReason: reasons.join(' · ') || 'Genel profil uyumu',
  };
}

const MentorMatchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// GET /mentis/:mentiId/mentor-matches — menti, kendisine uygun mentörleri uyum skoruyla görür.
// Route: requireRole('ADMIN','MENTI') + requireSelfOrAdmin('mentiId') (IDOR: başka menti'nin
// listesi görülemez). SALT-OKUMA; canlı eşleştirme yolunu (rankMentisForMentor) değiştirmez.
export async function getRankedMentorsForMenti(req: RequestWithTenant, res: Response) {
  const mentiId = req.params['mentiId'] as string;

  const parsed = MentorMatchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const result = await rankMentorsForMenti({
    mentiId,
    mentiTenantId: req.tenant.tenantId,
    limit: parsed.data.limit,
  });

  // GÜVENLİK: iç RankedMentor (discScore taşır) DOĞRUDAN dönmez — menti-safe DTO'ya map edilir.
  return res.json({ items: result.items.map(buildMentiFacingMentorItem) });
}

const OptInSchema = z.object({
  mentiId: z.string().min(5),
  status: z.enum(['APPROVED', 'REJECTED']).default('APPROVED'),
});

// Rule 2: Mentor, mentilere visibility opt-in verir (Akış A).
// Ice-breaker LLM çağrısı kaldırıldı — menti kendi requestMessage'ını MatchRequest aşamasında yazar.
export async function setVisibilityOptIn(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;
  const parsed = OptInSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const mentor = await prisma.user.findFirst({
    where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR', isActive: true },
    select: { id: true },
  });
  if (!mentor) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  }

  if (mentor.id === parsed.data.mentiId) {
    return res.status(400).json({
      error: 'SELF_MATCH_YASAK',
      message: 'Mentor kendi kendini eşleştirme listesine ekleyemez.',
    });
  }

  // cross-tenant kasıtlı: menti farklı tenant'tan olabilir (shared pool).
  // canCrossTenantMatch çağrısı hemen ardından izin kontrolünü yapar.
  const menti = await prisma.user.findUnique({
    where: { id: parsed.data.mentiId },
    select: { id: true, role: true, isActive: true, tenantId: true },
  });
  if (!menti) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Menti bulunamadı.' });
  }

  if (menti.role !== 'MENTI' || !menti.isActive) {
    return res.status(400).json({
      error: 'GECERSIZ_ROL',
      message: 'Hedef kullanıcı aktif bir menti değil.',
    });
  }

  const crossAllowed = await canCrossTenantMatch({
    requesterTenantId: req.tenant.tenantId,
    targetTenantId: menti.tenantId,
  });
  if (!crossAllowed) {
    return res.status(403).json({
      error: 'SHARED_POOL_KAPALI',
      message: 'Tenant havuzu paylaşımı kapalı olduğu için bu menti için visibility opt-in verilemez (cross-tenant).',
    });
  }

  const record = await prisma.visibilityOptIn.upsert({
    where: { mentorId_mentiId: { mentorId: mentor.id, mentiId: menti.id } },
    update: {
      status: parsed.data.status,
      initiatedBy: 'MENTOR',
      tenantId: req.tenant.tenantId,
    },
    create: {
      tenantId: req.tenant.tenantId,
      mentorId: mentor.id,
      mentiId: menti.id,
      status: parsed.data.status,
      initiatedBy: 'MENTOR',
    },
  });

  return res.json(record);
}
