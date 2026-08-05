import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { sendAdminNewUserNotification } from '../services/emailService.js';
import { notifyAdminsPendingUser } from '../services/notificationService.js';
import { ensureMembershipSafe } from '../services/membership.js';

// ─── Security: Tag Poisoning Prevention ───────────────────────────────────────
// Etiketlerdeki XSS, injection ve kimlik gizleme girişimlerini önler.
// CLAUDE.md'de belgelenen "sectorTags poison prevention" invariantını uygular.
const SECTOR_TAG_SCHEMA = z
  .string()
  .min(1)
  .max(50)
  .regex(
    /^[a-zA-Z0-9ğüşıöçĞÜŞİÖÇ\s\-&\/\.]+$/,
    'Etiket yalnızca harf, rakam, boşluk ve - & / . karakterlerini içerebilir.',
  )
  .transform((t) => t.trim().toLowerCase());

const SECTOR_TAGS_SCHEMA = z
  .array(SECTOR_TAG_SCHEMA)
  .max(20, 'Maksimum 20 sektör etiketi seçilebilir.')
  .optional()
  .transform((tags) => (tags ? [...new Set(tags)] : undefined)); // deduplicate

const ListUsersQuerySchema = z.object({
  role: z.enum(['ADMIN', 'MENTOR', 'MENTI']).optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v !== 'false')),
  // Sayfalama (adminListUsers deseniyle aynı): sınırsız findMany ölçekte OOM/timeout riski.
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function listUsers(req: RequestWithTenant, res: Response) {
  // KVKK: ADMIN olmayan çağıranın onay durumunu kontrol et.
  // PENDING kullanıcı bu endpoint'e doğrudan istek atarsa PII sızdırılmamalı.
  // countApprovedMentors zaten PII-free alternatifi sunuyor.
  if (req.auth && req.auth.role !== 'ADMIN') {
    const caller = await prisma.user.findFirst({
      where: { id: req.auth.userId, tenantId: req.tenant.tenantId },
      select: { approvalStatus: true },
    });
    if (caller?.approvalStatus !== 'APPROVED') {
      return res.status(403).json({
        error: 'ONAY_BEKLENIYOR',
        message: 'Kullanıcı listesine erişmek için yönetici onayı gerekli.',
      });
    }
  }

  const parsed = ListUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { role, isActive, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId: req.tenant.tenantId,
    ...(role !== undefined && { role }),
    ...(isActive !== undefined && { isActive }),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        role: true,
        email: true,
        fullName: true,
        isActive: true,
        sectorTags: true,
        discType: true,
        skills: true,
        bioSummary: true,
        expertiseDetails: true,
        targetAudience: true,
        needsOrientation: true,
        avatarUrl: true, // Kart/havuz gösterimi — public profil görseli (PII değil)
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip,
    }),
    prisma.user.count({ where }),
  ]);

  return res.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

/**
 * GET /api/users/mentor-count — PENDING dahil tüm kimliği doğrulanmış kullanıcılara açık.
 * Yalnızca toplam onaylı mentor sayısını döner — PII yok.
 * Menti bekleme odası "N mentor profili tespit edildi" için kullanılır.
 * KVKK: mentor isimleri/e-postaları hiç gönderilmez.
 */
export async function countApprovedMentors(req: RequestWithTenant, res: Response) {
  const count = await prisma.user.count({
    where: {
      tenantId:       req.tenant.tenantId,
      role:           'MENTOR',
      isActive:       true,
      approvalStatus: 'APPROVED',
    },
  });
  return res.json({ count });
}

export async function getUser(req: RequestWithTenant, res: Response) {
  const user = await prisma.user.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
    select: {
      id: true,
      tenantId: true,
      role: true,
      email: true,
      fullName: true,
      isActive: true,
      sectorTags: true,
      discType: true,
      discVector: true,
      discResultCard: true,
      skills: true,
      bioSummary: true,
      expertiseDetails: true,
      targetAudience: true,
      needsOrientation: true,
      timeCommitment: true,
      expectationCategories: true,
      interactionStyle: true,
      approvalStatus: true,
      mentorVisibilityEnabled: true,
      temperamentJson: true,
      volunteerHistory: true,
      pastProjects: true,
      education: true,
      selfProfile: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  return res.json(user);
}

const TIME_COMMITMENT_VALUES = ['AYDA_1', 'AYDA_2_3', 'HAFTADA_1', 'HAFTADA_2_PLUS'] as const;
const INTERACTION_STYLE_VALUES = ['GOREV_BAZLI', 'SOHBET_BAZLI'] as const;
const EXPECTATION_CATEGORY_VALUES = [
  'KARIYER_YONLENDIRME',
  'TEKNIK_BECERI',
  'IS_STAJ_BAGLANTISI',
  'GIRISIMCILIK',
  'KISISEL_GELISIM',
  'SEKTOR_TANIMA',
] as const;

const UpdateUserSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  sectorTags: SECTOR_TAGS_SCHEMA,
  discType: z.enum(['D', 'I', 'S', 'C']).nullable().optional(),
  temperamentJson: z.any().optional(),
  volunteerHistory: z.any().optional(),
  pastProjects: z.any().optional(),
  education: z.any().optional(),
  skills: z.array(z.string().max(100)).max(30).optional(),
  isActive: z.boolean().optional(),
  timeCommitment: z.enum(TIME_COMMITMENT_VALUES).nullable().optional(),
  interactionStyle: z.enum(INTERACTION_STYLE_VALUES).nullable().optional(),
  expectationCategories: z
    .array(z.enum(EXPECTATION_CATEGORY_VALUES))
    .max(2, 'Maksimum 2 beklenti kategorisi seçilebilir.')
    .optional(),
  // Zengin profil alanları
  bioSummary: z.string().max(2000).nullable().optional(),
  expertiseDetails: z.string().max(2000).nullable().optional(),
  targetAudience: z.string().max(1000).nullable().optional(),
}).strict();

export async function updateUser(req: RequestWithTenant, res: Response) {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const existing = await prisma.user.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  return res.json(updated);
}

const CreateUserSchema = z.object({
  role: z.enum(['ADMIN', 'MENTOR', 'MENTI']),
  email: z.string().email().max(254),
  fullName: z.string().min(2).max(200),
  sectorTags: SECTOR_TAGS_SCHEMA,
  discType: z.enum(['D', 'I', 'S', 'C']).optional(),
  temperamentJson: z.any().optional(),
  timeCommitment: z.enum(TIME_COMMITMENT_VALUES).optional(),
  interactionStyle: z.enum(INTERACTION_STYLE_VALUES).optional(),
  expectationCategories: z
    .array(z.enum(EXPECTATION_CATEGORY_VALUES))
    .max(2, 'Maksimum 2 beklenti kategorisi seçilebilir.')
    .optional(),
  // Menti CV
  volunteerHistory: z.any().optional(),
  pastProjects: z.any().optional(),
  education: z.any().optional(),
  skills: z.array(z.string().max(100)).max(30).optional(),
  // Zengin profil alanları
  bioSummary: z.string().max(2000).optional(),
  expertiseDetails: z.string().max(2000).optional(),
  targetAudience: z.string().max(1000).optional(),
});

// ─── PATCH /users/me/profile ──────────────────────────────────────────────────
// Kullanıcı KENDİ profilini düzenler. Roller, onay durumu, DISC tipi bu
// endpoint'ten değiştirilemez — .strict() ile whitelist korunur.
//
// Prisma Json? alanlar (education, pastProjects, volunteerHistory):
//   string → doğrudan kaydedilir, boş string → undefined (güncelleme atlanır).
// Prisma String? alanlar: null doğrudan kabul edilir.

const NULLABLE_STR = (max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().max(max).nullable().optional());

const OPTIONAL_JSON_STR = (max: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().max(max).optional());

const NULLABLE_URL = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().url('Geçerli bir URL giriniz (https://... ile başlamalı)').max(300).nullable().optional(),
);

const UpdateMyProfileSchema = z.object({
  // String? alanlar — null doğrudan Prisma'ya geçebilir
  bioSummary:       NULLABLE_STR(1000),
  expertiseDetails: NULLABLE_STR(1000),
  targetAudience:   NULLABLE_STR(500),
  linkedinUrl:      NULLABLE_URL,
  instagramUrl:     NULLABLE_URL,
  // Json? alanlar — null için Prisma.DbNull dönüşümü controller'da yapılır
  education:        OPTIONAL_JSON_STR(2000),
  pastProjects:     OPTIONAL_JSON_STR(2000),
  volunteerHistory: OPTIONAL_JSON_STR(2000),
  // Array alanlar
  skills:    z.array(z.string().min(1).max(100)).max(30).optional(),
  sectorTags: SECTOR_TAGS_SCHEMA,
}).strict();

export async function updateMyProfile(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const parsed = UpdateMyProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId },
    select: { id: true },
  });
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });

  const { education, pastProjects, volunteerHistory, ...rest } = parsed.data;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...rest,
      // Json? alanlar: undefined → atla, string → kaydet
      ...(education        !== undefined && { education }),
      ...(pastProjects     !== undefined && { pastProjects }),
      ...(volunteerHistory !== undefined && { volunteerHistory }),
    },
    select: {
      id:               true,
      fullName:         true,
      bioSummary:       true,
      expertiseDetails: true,
      targetAudience:   true,
      education:        true,
      pastProjects:     true,
      volunteerHistory: true,
      skills:           true,
      sectorTags:       true,
      linkedinUrl:      true,
      instagramUrl:     true,
      updatedAt:        true,
    },
  });

  return res.json(updated);
}

export async function patchSelfProfile(req: RequestWithTenant, res: Response) {
  const userId  = req.params['id'] as string;
  const isAdmin = req.auth?.role === 'ADMIN';
  const isSelf  = req.auth?.userId === userId;

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca kendi profilinizi düzenleyebilirsiniz.' });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true, selfProfile: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'VALIDATION', message: 'Body bir JSON objesi olmalıdır.' });
  }

  // Security: selfProfile bomba koruması — maksimum 50 anahtar, 100 char key
  const bodyKeys = Object.keys(req.body as object);
  if (bodyKeys.length > 50) {
    return res.status(400).json({ error: 'VALIDATION', message: 'selfProfile en fazla 50 anahtar içerebilir.' });
  }
  if (bodyKeys.some((k) => k.length > 100)) {
    return res.status(400).json({ error: 'VALIDATION', message: 'selfProfile anahtarları en fazla 100 karakter olabilir.' });
  }

  const existing = (user.selfProfile as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...req.body };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { selfProfile: merged },
    select: { id: true, selfProfile: true, updatedAt: true },
  });

  return res.json(updated);
}

export async function createUser(req: RequestWithTenant, res: Response) {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const user = await prisma.user.create({
    data: {
      tenantId: req.tenant.tenantId,
      role: parsed.data.role,
      email: parsed.data.email.toLowerCase(),
      fullName: parsed.data.fullName,
      sectorTags: parsed.data.sectorTags ?? [],
      discType: parsed.data.discType,
      temperamentJson: parsed.data.temperamentJson,
      timeCommitment: parsed.data.timeCommitment,
      interactionStyle: parsed.data.interactionStyle,
      expectationCategories: parsed.data.expectationCategories ?? [],
      volunteerHistory: parsed.data.volunteerHistory,
      pastProjects: parsed.data.pastProjects,
      education: parsed.data.education,
      skills: parsed.data.skills ?? [],
      bioSummary: parsed.data.bioSummary,
      expertiseDetails: parsed.data.expertiseDetails,
      targetAudience: parsed.data.targetAudience,
    },
  });

  // b3: Kurum üyeliğini garanti et. GÜVENLİK: non-fatal — kullanıcı oluşturmayı bozmaz.
  await ensureMembershipSafe(prisma, user.id, user.tenantId, user.role);

  // MENTOR/MENTI kayıtları PENDING başlar — tenant adminlerine bildirim gönder
  if (user.role === 'MENTOR' || user.role === 'MENTI') {
    const [admins, tenantRecord] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId: req.tenant.tenantId, role: 'ADMIN', isActive: true },
        select: { email: true, fullName: true },
      }),
      prisma.tenant.findUnique({
        where: { id: req.tenant.tenantId },
        select: { name: true },
      }),
    ]);
    const tenantName = tenantRecord?.name ?? req.tenant.tenantId;
    for (const admin of admins) {
      void sendAdminNewUserNotification({
        toEmail: admin.email,
        adminName: admin.fullName,
        newUserFullName: user.fullName,
        newUserRole: user.role,
        tenantName,
      });
    }
    void notifyAdminsPendingUser({
      tenantId: req.tenant.tenantId,
      newUserFullName: user.fullName,
      newUserRole: user.role,
    });
  }

  return res.status(201).json(user);
}

// ─── POST /users/me/orientation-completed ────────────────────────────────────

// Menti, görüşme rehberini tamamladıktan sonra bu endpoint'i çağırır.
// needsOrientation=false → kilit kalkar, yeni görüşme alabilir.
export async function completedOrientation(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId },
    select: { id: true, needsOrientation: true },
  });
  if (!user) return res.status(404).json({ error: 'NOT_FOUND' });

  if (!user.needsOrientation) {
    return res.json({ message: 'Oryantasyon kilidi zaten açık.', needsOrientation: false });
  }

  await prisma.user.update({
    where: { id: user.id },
    data:  { needsOrientation: false },
  });

  return res.json({ message: 'Görüşme rehberi tamamlandı, kilid kaldırıldı.', needsOrientation: false });
}
