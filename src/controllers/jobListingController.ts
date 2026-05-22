import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';

const CreateJobListingSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(5),
  location: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function createJobListing(req: RequestWithTenant, res: Response) {
  const parsed = CreateJobListingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const listing = await prisma.jobListing.create({
    data: {
      tenantId: req.tenant.tenantId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      tags: parsed.data.tags ?? [],
    },
  });

  return res.status(201).json(listing);
}

const ListJobListingsQuerySchema = z.object({
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v !== 'false')),
  tag: z.string().optional(),
});

export async function listJobListings(req: RequestWithTenant, res: Response) {
  const parsed = ListJobListingsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const items = await prisma.jobListing.findMany({
    where: {
      tenantId: req.tenant.tenantId,
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      ...(parsed.data.tag !== undefined && { tags: { has: parsed.data.tag } }),
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ items, total: items.length });
}

export async function getJobListing(req: RequestWithTenant, res: Response) {
  const listing = await prisma.jobListing.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
  });

  if (!listing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'İş ilanı bulunamadı.' });
  }

  return res.json(listing);
}

const UpdateJobListingSchema = z
  .object({
    title: z.string().min(2).optional(),
    description: z.string().min(5).optional(),
    location: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function updateJobListing(req: RequestWithTenant, res: Response) {
  const parsed = UpdateJobListingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const existing = await prisma.jobListing.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'İş ilanı bulunamadı.' });
  }

  const updated = await prisma.jobListing.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  return res.json(updated);
}
