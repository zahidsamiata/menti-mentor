import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { invalidateTenant } from '../services/tenantCache.js';

const CreateTenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir'),
  isSharedPoolActive: z.boolean().optional(),
  displayName: z.string().max(120).optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir hex renk kodu girin').optional(),
  tenantVocabulary: z
    .object({ greeting: z.string().max(50).optional(), signOff: z.string().max(50).optional(), formalStyle: z.boolean().optional() })
    .optional(),
});

export async function createTenant(req: Request, res: Response) {
  const parsed = CreateTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      isSharedPoolActive: parsed.data.isSharedPoolActive ?? false,
      displayName: parsed.data.displayName,
      logoUrl: parsed.data.logoUrl,
      primaryColor: parsed.data.primaryColor ?? '#6366f1',
      tenantVocabulary: parsed.data.tenantVocabulary,
    },
  });

  return res.status(201).json(tenant);
}

export async function listTenants(_req: Request, res: Response) {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      isSharedPoolActive: true,
      logoUrl: true,
      primaryColor: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ items: tenants, total: tenants.length });
}

export async function getTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params['id'] as string },
  });

  if (!tenant) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Tenant bulunamadı.' });
  }

  return res.json(tenant);
}

// tenantVocabulary şeması: { greeting?, signOff?, formalStyle? }
const TenantVocabularySchema = z
  .object({
    greeting: z.string().max(50).optional(),
    signOff: z.string().max(50).optional(),
    formalStyle: z.boolean().optional(),
  })
  .optional();

const UpdateTenantSchema = z
  .object({
    name: z.string().min(2).optional(),
    displayName: z.string().max(120).nullable().optional(),
    logoUrl: z.string().url().nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    isSharedPoolActive: z.boolean().optional(),
    tenantVocabulary: TenantVocabularySchema,
  })
  .strict();

export async function updateTenant(req: Request, res: Response) {
  const parsed = UpdateTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const existing = await prisma.tenant.findUnique({
    where: { id: req.params['id'] as string },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Tenant bulunamadı.' });
  }

  const updated = await prisma.tenant.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  invalidateTenant(existing.id);

  return res.json(updated);
}

