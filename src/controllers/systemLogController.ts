import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import type { LogLevel } from '@prisma/client';

// Query parametre şeması
const ListSystemLogsQuerySchema = z.object({
  level: z.enum(['INFO', 'WARN', 'ERROR']).optional(),
  category: z
    .enum(['EMAIL', 'ML', 'AUTH', 'DB', 'HTTP', 'SYSTEM'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /api/system-logs
 * Admin için sistem log kayıtlarını listeler.
 * Query: level (INFO|WARN|ERROR), category, limit (max 100, varsayılan 50)
 */
export async function listSystemLogs(req: RequestWithTenant, res: Response) {
  const parsed = ListSystemLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { level, category, limit } = parsed.data;

  const logs = await prisma.systemLog.findMany({
    where: {
      ...(level    && { level: level as LogLevel }),
      ...(category && { category }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return res.json({ items: logs, total: logs.length });
}
