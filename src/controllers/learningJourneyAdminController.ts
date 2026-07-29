/**
 * Öğrenme Yolculuğu — Yönetici (STK) CRUD Controller.
 *
 * Kopya-üzerine-düzenle: global (tenantId=null) aşamalar KİLİTLİ; STK yalnızca
 * gizler veya klonlayarak özelleştirir. Global mutasyonu reddedilir.
 * Tenant izolasyonu: tüm işlemler req.tenant.tenantId ile sınırlıdır (RLS + açık kontrol).
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import {
  listStagesForAdmin,
  createTenantStage,
  updateTenantStage,
  deleteTenantStage,
  customizeGlobalStage,
  hideGlobalStage,
  unhideGlobalStage,
  reorderTenantStages,
  type StageWriteInput,
} from '../services/learningJourney.service.js';

// ─── Şemalar ─────────────────────────────────────────────────────────────────

const ChoiceSchema = z.object({
  key: z.string().min(1).max(8),
  label: z.string().min(1).max(600),
  outcome: z.enum(['correct', 'warn', 'wrong']),
  feedback: z.string().min(1).max(1200),
});

const ChoicesSchema = z
  .array(ChoiceSchema)
  .min(2)
  .max(6)
  .refine((cs) => new Set(cs.map((c) => c.key)).size === cs.length, {
    message: 'Seçenek anahtarları (key) benzersiz olmalı.',
  });

const CreateStageSchema = z.object({
  audience: z.enum(['MENTOR', 'MENTI']),
  title: z.string().min(2).max(160),
  situationText: z.string().min(10).max(2000),
  learningGoal: z.string().min(3).max(500),
  authoringGuide: z.string().max(1000).nullish(),
  isStkSpecific: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  choices: ChoicesSchema,
});

const UpdateStageSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  situationText: z.string().min(10).max(2000).optional(),
  learningGoal: z.string().min(3).max(500).optional(),
  authoringGuide: z.string().max(1000).nullish(),
  isStkSpecific: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  choices: ChoicesSchema.optional(),
});

const ReorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1).max(100),
});

const AudienceQuerySchema = z.enum(['MENTOR', 'MENTI']).optional();

// ─── GET /api/admin/learning-journey/stages ──────────────────────────────────

export async function adminListStages(req: RequestWithTenant, res: Response) {
  const audienceParsed = AudienceQuerySchema.safeParse(req.query['audience']);
  const audience = audienceParsed.success ? audienceParsed.data : undefined;

  const items = await listStagesForAdmin(req.tenant.tenantId, audience);
  return res.json({ items, total: items.length });
}

// ─── POST /api/admin/learning-journey/stages ─────────────────────────────────

export async function adminCreateStage(req: RequestWithTenant, res: Response) {
  const parsed = CreateStageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const created = await createTenantStage(req.tenant.tenantId, parsed.data as StageWriteInput);
  return res.status(201).json(created);
}

// ─── PATCH /api/admin/learning-journey/stages/:stageId ───────────────────────

export async function adminUpdateStage(req: RequestWithTenant, res: Response) {
  const stageId = req.params['stageId'] as string;
  const parsed = UpdateStageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const result = await updateTenantStage(req.tenant.tenantId, stageId, parsed.data);
  if (!result.ok) return sendWriteError(res, result.code);
  return res.json(result.stage);
}

// ─── DELETE /api/admin/learning-journey/stages/:stageId ──────────────────────

export async function adminDeleteStage(req: RequestWithTenant, res: Response) {
  const stageId = req.params['stageId'] as string;
  const result = await deleteTenantStage(req.tenant.tenantId, stageId);
  if (!result.ok) return sendWriteError(res, result.code);
  return res.status(204).send();
}

// ─── POST /api/admin/learning-journey/stages/:stageId/customize ──────────────

export async function adminCustomizeStage(req: RequestWithTenant, res: Response) {
  const stageId = req.params['stageId'] as string;
  const result = await customizeGlobalStage(req.tenant.tenantId, stageId);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
    if (result.code === 'NOT_GLOBAL') {
      return res.status(400).json({
        error: 'SADECE_GLOBAL',
        message: 'Yalnızca global aşamalar özelleştirilebilir. Kendi aşamalarınızı doğrudan düzenleyin.',
      });
    }
    return res.status(409).json({
      error: 'ZATEN_OZELLESTIRILDI',
      message: 'Bu aşama zaten özelleştirilmiş. Kendi kopyanızı düzenleyin.',
    });
  }
  return res.status(201).json(result.stage);
}

// ─── POST/DELETE /api/admin/learning-journey/stages/:stageId/hide ────────────

export async function adminHideStage(req: RequestWithTenant, res: Response) {
  const stageId = req.params['stageId'] as string;
  const result = await hideGlobalStage(req.tenant.tenantId, stageId);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
    return res.status(400).json({
      error: 'SADECE_GLOBAL',
      message: 'Yalnızca global aşamalar gizlenir. Kendi aşamalarınızı silebilirsiniz.',
    });
  }
  return res.status(201).json({ hidden: true });
}

export async function adminUnhideStage(req: RequestWithTenant, res: Response) {
  const stageId = req.params['stageId'] as string;
  await unhideGlobalStage(req.tenant.tenantId, stageId);
  return res.status(204).send();
}

// ─── POST /api/admin/learning-journey/stages/reorder ─────────────────────────

export async function adminReorderStages(req: RequestWithTenant, res: Response) {
  const parsed = ReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const result = await reorderTenantStages(req.tenant.tenantId, parsed.data.order);
  if (!result.ok) {
    return res.status(403).json({
      error: 'SADECE_KENDI_ASAMALARI',
      message: 'Yalnızca kendi aşamalarınızı sıralayabilirsiniz. Global aşamalar için önce özelleştirin.',
    });
  }
  return res.json({ reordered: true });
}

// ─── Ortak yazma hatası eşlemesi ─────────────────────────────────────────────

function sendWriteError(res: Response, code: 'NOT_FOUND' | 'GLOBAL_LOCKED' | 'FORBIDDEN') {
  if (code === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
  if (code === 'GLOBAL_LOCKED') {
    return res.status(403).json({
      error: 'GLOBAL_ASAMA_KILITLI',
      message: 'Global çekirdek aşamalar değiştirilemez/silinemez. Gizleyin ya da özelleştirin.',
    });
  }
  return res.status(403).json({ error: 'YETKI_YETERSIZ' });
}
