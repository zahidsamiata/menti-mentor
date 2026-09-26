import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { validateRequest } from '../middleware/validate.js';
import { config } from '../config.js';
import { sendSuspicionReportAlert } from '../services/emailService.js';

const CreateReportSchema = z.object({
  tenantName:   z.string().min(2).max(200),
  reporterName: z.string().min(2).max(100),
  reporterRole: z.string().min(2).max(100),
  contact:      z.string().min(3).max(200),
  description:  z.string().min(10).max(2000),
});

// POST /api/suspicion-reports — public (auth gerektirmez)
export async function createSuspicionReport(req: Request, res: Response) {
  const parsed = validateRequest(CreateReportSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const report = await prisma.suspicionReport.create({ data: parsed.data });
  // AN-09: platform yöneticisine haber — yanıtı bekletmez, e-posta hatası kaydı bozmaz (send() fırlatmaz).
  void sendSuspicionReportAlert({ toEmail: config.platformAdminEmail, reportId: report.id });
  return res.status(201).json({ id: report.id, ok: true });
}
