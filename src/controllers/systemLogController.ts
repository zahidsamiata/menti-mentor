import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import type { LogLevel } from '@prisma/client';
import { validateRequest } from '../middleware/validate.js';

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
export async function listSystemLogs(req: Request, res: Response) {
  const parsed = validateRequest(ListSystemLogsQuerySchema, req.query, res);
  if (!parsed.success) return parsed.response;

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
