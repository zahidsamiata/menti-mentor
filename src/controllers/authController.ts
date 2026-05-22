import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { signToken } from '../middleware/jwtAuth.js';
import type { RequestWithTenant } from '../types.js';

const LoginSchema = z.object({
  slug: z.string().min(1, 'Kuruluş kodu zorunlu'),
  userId: z.string().min(1, 'Kullanıcı ID zorunlu'),
});

// POST /api/auth/login
// Body: { slug, userId }
// Kriptografik JWT imzalı token döndürür.
export async function login(req: Request, res: Response) {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { slug, userId } = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, displayName: true, logoUrl: true, primaryColor: true },
  });
  if (!tenant) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Kuruluş bulunamadı.' });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: tenant.id, isActive: true },
    select: { id: true, role: true, fullName: true, tenantId: true, email: true },
  });
  if (!user) {
    return res.status(401).json({
      error: 'KIMLIK_DOGRULANMADI',
      message: 'Kullanıcı bulunamadı veya hesap aktif değil.',
    });
  }

  const accessToken = signToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    fullName: user.fullName,
  });

  return res.json({
    accessToken,
    expiresIn: '24h',
    user: {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      fullName: user.fullName,
      email: user.email,
    },
    tenant: {
      id: tenant.id,
      name: tenant.displayName ?? tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
    },
  });
}

// GET /api/auth/me — geçerli token sahibinin bilgilerini döndürür
export async function getMe(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Oturum açılmamış.' });
  }

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId, isActive: true },
    select: {
      id: true, role: true, fullName: true, email: true,
      discType: true, sectorTags: true, skills: true,
      bioSummary: true, needsOrientation: true, discVector: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  return res.json(user);
}
