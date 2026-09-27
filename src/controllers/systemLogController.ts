import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import type { LogLevel } from '@prisma/client';
import { validateRequest } from '../middleware/validate.js';
import { auditPlatformAction } from '../services/platformAudit.js';

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
 *
 * Komşu uç /api/platform/logs (getPlatformLogs) ile aynı koruma (AJ-02):
 * - KVKK: SystemLog.meta (Json) hata stack + userId/tenantId vb. içerebilir → PII sızma riski.
 *   Explicit select ile `meta` KASITLI dışarıda bırakılır.
 * - Y-02 (KVKK Md.12): platform okuma uçları da iz bırakır — kim, ne zaman, hangi filtreyle (PII yok).
 */
export async function listSystemLogs(req: Request, res: Response) {
  const parsed = validateRequest(ListSystemLogsQuerySchema, req.query, res);
  if (!parsed.success) return parsed.response;

  const { level, category, limit } = parsed.data;

  const where = {
    ...(level    && { level: level as LogLevel }),
    ...(category && { category }),
  };

  const [logs, total] = await Promise.all([
    prisma.systemLog.findMany({
      where,
      select: { id: true, level: true, category: true, message: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.systemLog.count({ where }),
  ]);

  await auditPlatformAction('VIEW_SYSTEM_LOGS', req, { count: logs.length, level, category });
  return res.json({ items: logs, total });
}
