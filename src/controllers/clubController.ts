import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Zod şemaları
// ---------------------------------------------------------------------------

const ClubTypeValues = ['AKADEMIK', 'SOSYAL', 'SPOR', 'SANAT', 'TEKNOLOJI', 'DIGER'] as const;
const ClubMemberRoleValues = ['BASKAN', 'YONETIM', 'UYE', 'DANISMAN'] as const;

const CreateClubSchema = z.object({
  name: z.string().min(2, 'Kulüp adı en az 2 karakter olmalıdır.'),
  slug: z.string().min(2, 'Slug en az 2 karakter olmalıdır.'),
  type: z.enum(ClubTypeValues),
  description: z.string().optional(),
});

const UpdateClubSchema = z
  .object({
    name: z.string().min(2).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const ListClubsQuerySchema = z.object({
  type: z.enum(ClubTypeValues).optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v !== 'false')),
});

const AddMemberSchema = z.object({
  userId: z.string().min(5, 'Geçerli bir kullanıcı kimliği giriniz.'),
  role: z.enum(ClubMemberRoleValues).optional(),
});

// ---------------------------------------------------------------------------
// Yardımcı: Prisma P2002 unique kısıtlama ihlali mi?
// ---------------------------------------------------------------------------
function isPrismaUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// ---------------------------------------------------------------------------
// Kulüp CRUD
// ---------------------------------------------------------------------------

/** POST /api/clubs — Yeni kulüp oluştur (ADMIN) */
export async function createClub(req: RequestWithTenant, res: Response) {
  const parsed = CreateClubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  try {
    const club = await prisma.club.create({
      data: {
        tenantId: req.tenant.tenantId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        type: parsed.data.type,
        description: parsed.data.description,
      },
    });

    return res.status(201).json(club);
  } catch (err) {
    if (isPrismaUniqueError(err)) {
      return res.status(409).json({
        error: 'CAKISMA',
        message: 'Bu tenant içinde aynı slug ile bir kulüp zaten mevcut.',
      });
    }
    throw err;
  }
}

/** GET /api/clubs — Tenant'ın kulüplerini listele (?type, ?isActive filtresi) */
export async function listClubs(req: RequestWithTenant, res: Response) {
  const parsed = ListClubsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const clubs = await prisma.club.findMany({
    where: {
      tenantId: req.tenant.tenantId,
      ...(parsed.data.type !== undefined && { type: parsed.data.type }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
    include: {
      _count: { select: { memberships: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ items: clubs, total: clubs.length });
}

/** GET /api/clubs/:id — Tek kulüp detayı (üye sayısı dahil) */
export async function getClub(req: RequestWithTenant, res: Response) {
  const club = await prisma.club.findFirst({
    where: {
      id: req.params['id'] as string,
      tenantId: req.tenant.tenantId,
    },
    include: {
      _count: { select: { memberships: true } },
    },
  });

  if (!club) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kulüp bulunamadı.' });
  }

  return res.json(club);
}

/** PATCH /api/clubs/:id — Kulüp güncelle (ADMIN) */
export async function updateClub(req: RequestWithTenant, res: Response) {
  const parsed = UpdateClubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  // Kulübün bu tenant'a ait olduğunu doğrula
  const existing = await prisma.club.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
    select: { id: true },
  });

  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kulüp bulunamadı.' });
  }

  const updated = await prisma.club.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  return res.json(updated);
}

// ---------------------------------------------------------------------------
// Üyelik işlemleri
// ---------------------------------------------------------------------------

/** POST /api/clubs/:id/members — Kulübe üye ekle */
export async function addClubMember(req: RequestWithTenant, res: Response) {
  const parsed = AddMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const tenantId = req.tenant.tenantId;
  const clubId = req.params['id'] as string;

  // Kulübün bu tenant'a ait olduğunu doğrula
  const club = await prisma.club.findFirst({
    where: { id: clubId, tenantId },
    select: { id: true },
  });

  if (!club) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kulüp bulunamadı.' });
  }

  // Kullanıcının aynı tenant'ta var olduğunu doğrula
  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, tenantId },
    select: { id: true },
  });

  if (!user) {
    return res
      .status(404)
      .json({ error: 'NOT_FOUND', message: 'Kullanıcı bu tenant içinde bulunamadı.' });
  }

  try {
    const membership = await prisma.clubMembership.create({
      data: {
        tenantId,
        clubId: club.id,
        userId: user.id,
        role: parsed.data.role ?? 'UYE',
      },
    });

    return res.status(201).json(membership);
  } catch (err) {
    if (isPrismaUniqueError(err)) {
      return res
        .status(409)
        .json({ error: 'CAKISMA', message: 'Bu kullanıcı zaten bu kulübün üyesi.' });
    }
    throw err;
  }
}

/** DELETE /api/clubs/:id/members/:userId — Üyeyi kulüpten çıkar */
export async function removeClubMember(req: RequestWithTenant, res: Response) {
  const tenantId = req.tenant.tenantId;
  const clubId = req.params['id'] as string;
  const userId = req.params['userId'] as string;

  // Üyelik kaydını bul (tenantId kontrolü de yapılıyor)
  const membership = await prisma.clubMembership.findFirst({
    where: { clubId, userId, tenantId },
    select: { id: true },
  });

  if (!membership) {
    return res
      .status(404)
      .json({ error: 'NOT_FOUND', message: 'Üyelik kaydı bulunamadı.' });
  }

  await prisma.clubMembership.delete({ where: { id: membership.id } });

  return res.status(204).send();
}

/** GET /api/clubs/:id/members — Kulüp üyelerini listele */
export async function listClubMembers(req: RequestWithTenant, res: Response) {
  const tenantId = req.tenant.tenantId;
  const clubId = req.params['id'] as string;

  // Kulübün bu tenant'a ait olduğunu doğrula
  const club = await prisma.club.findFirst({
    where: { id: clubId, tenantId },
    select: { id: true },
  });

  if (!club) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kulüp bulunamadı.' });
  }

  const memberships = await prisma.clubMembership.findMany({
    where: { clubId: club.id, tenantId },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          role: true,
          discType: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return res.json({ items: memberships, total: memberships.length });
}

/** GET /api/users/:userId/clubs — Kullanıcının üye olduğu kulüpler */
export async function getUserClubs(req: RequestWithTenant, res: Response) {
  const tenantId = req.tenant.tenantId;
  const userId = req.params['userId'] as string;

  // Kullanıcının bu tenant'ta var olduğunu doğrula
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true },
  });

  if (!user) {
    return res
      .status(404)
      .json({ error: 'NOT_FOUND', message: 'Kullanıcı bu tenant içinde bulunamadı.' });
  }

  const memberships = await prisma.clubMembership.findMany({
    where: { userId: user.id, tenantId },
    include: {
      club: true,
    },
    orderBy: { joinedAt: 'desc' },
  });

  return res.json({ items: memberships, total: memberships.length });
}
