import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';

const CreateReportSchema = z.object({
  tenantName:   z.string().min(2).max(200),
  reporterName: z.string().min(2).max(100),
  reporterRole: z.string().min(2).max(100),
  contact:      z.string().min(3).max(200),
  description:  z.string().min(10).max(2000),
});

// POST /api/suspicion-reports — public (auth gerektirmez)
export async function createSuspicionReport(req: Request, res: Response) {
  const parsed = CreateReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const report = await prisma.suspicionReport.create({ data: parsed.data });
  return res.status(201).json({ id: report.id, ok: true });
}
