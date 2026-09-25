import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { validateRequest } from '../middleware/validate.js';

const CreateJobListingSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(5),
  location: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function createJobListing(req: RequestWithTenant, res: Response) {
  const parsed = validateRequest(CreateJobListingSchema, req.body, res);
  if (!parsed.success) return parsed.response;

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

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

const ListJobListingsQuerySchema = z.object({
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v !== 'false')),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).optional().default(PAGE_SIZE_DEFAULT),
});

export async function listJobListings(req: RequestWithTenant, res: Response) {
  const parsed = validateRequest(ListJobListingsQuerySchema, req.query, res);
  if (!parsed.success) return parsed.response;

  const { isActive, tag, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const where = {
    tenantId: req.tenant.tenantId,
    ...(isActive !== undefined && { isActive }),
    ...(tag !== undefined && { tags: { has: tag } }),
  };

  const [items, total] = await Promise.all([
    prisma.jobListing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.jobListing.count({ where }),
  ]);

  return res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
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
  const parsed = validateRequest(UpdateJobListingSchema, req.body, res);
  if (!parsed.success) return parsed.response;

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
