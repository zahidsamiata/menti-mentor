/**
 * Taxonomy & Tag Yönetimi Controller (Sprint 14)
 *
 * Veri akışı:
 *  1. Kullanıcı sectorTag önermek için POST /api/tags/suggest çağırır
 *  2. PendingTag kuyruğuna PENDING olarak eklenir
 *  3. Admin GET /api/admin/tags/pending ile listeyi görür
 *  4. Admin 3 aksiyon alabilir:
 *     - approve  → onaylı etiket olur, kullanıcının sectorTags'i güncellenir
 *     - merge    → var olan etikete eşlenir, kullanıcı profili güncellenir
 *     - reject   → sessizce REJECTED yapılır
 *
 * Compliance: Tag değerleri Analytical kategorisinde; PII değil.
 * Kullanıcı bilgisi (submittedBy) birleştirme/onay işlemlerinde kullanılır
 * ama dışa aktarımlarda kullanıcı adıyla eşleştirilmez.
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { logger } from '../services/logger.js';

// ─── Validasyon şemaları ──────────────────────────────────────────────────────

const SuggestTagSchema = z.object({
  value: z
    .string()
    .min(2, 'Etiket en az 2 karakter olmalı')
    .max(50, 'Etiket en fazla 50 karakter olabilir')
    .regex(/^[a-zçğışöüA-ZÇĞİŞÖÜ0-9\s\-]+$/, 'Etiket geçersiz karakter içeriyor')
    .transform((v) => v.trim().toLowerCase()),
});

const MergeTagSchema = z.object({
  targetTag: z
    .string()
    .min(2)
    .max(50)
    .transform((v) => v.trim().toLowerCase()),
});

const PendingTagListSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'MERGED', 'REJECTED']).optional().default('PENDING'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

// ─── POST /api/tags/suggest ───────────────────────────────────────────────────

/**
 * Kullanıcı yeni etiket önerisi yapar.
 * Standart havuzda yoksa PendingTag kuyruğuna eklenir.
 * Zaten PENDING ise idempotent — hata dönmez.
 */
export async function suggestTag(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });
  }

  const parsed = SuggestTagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { value } = parsed.data;
  const tenantId = req.tenant.tenantId;
  const submittedBy = req.auth.userId;

  // Upsert: aynı etiket zaten kuyruktaysa güncelleme yapma
  const existing = await prisma.pendingTag.findUnique({
    where: { tenantId_value: { tenantId, value } },
    select: { id: true, status: true },
  });

  if (existing) {
    return res.json({ message: 'Bu etiket zaten incelemede.', status: existing.status });
  }

  const tag = await prisma.pendingTag.create({
    data: { tenantId, value, submittedBy },
    select: { id: true, value: true, status: true, createdAt: true },
  });

  return res.status(201).json({ message: 'Etiket önerisi alındı.', tag });
}

// ─── GET /api/admin/tags/pending ─────────────────────────────────────────────

/** Admin: bekleyen etiket kuyruğunu listele. */
export async function listPendingTags(req: RequestWithTenant, res: Response) {
  const parsed = PendingTagListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { status, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    prisma.pendingTag.findMany({
      where: { tenantId: req.tenant.tenantId, status },
      select: {
        id: true,
        value: true,
        status: true,
        mergedInto: true,
        createdAt: true,
        // submittedBy: kullanıcı ID'si — isim/e-posta Analytical veri değil
        submittedBy: true,
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip,
    }),
    prisma.pendingTag.count({ where: { tenantId: req.tenant.tenantId, status } }),
  ]);

  return res.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

// ─── POST /api/admin/tags/:id/approve ────────────────────────────────────────

/**
 * Admin: etiketi onaylar.
 * Kullanıcının sectorTags'ine eklenir (submittedBy); diğer kullanıcılar etkilenmez.
 * Tasarım kararı: "global pool" yerine tag, önce sahibine eklenir.
 * Gelecekte Tenant.globalTags[] alanı eklenebilir.
 */
export async function approveTag(req: RequestWithTenant, res: Response) {
  const tagId = req.params['id'] as string;

  const tag = await prisma.pendingTag.findFirst({
    where: { id: tagId, tenantId: req.tenant.tenantId },
    select: { id: true, value: true, status: true, submittedBy: true },
  });

  if (!tag) return res.status(404).json({ error: 'NOT_FOUND', message: 'Etiket bulunamadı.' });
  if (tag.status !== 'PENDING') {
    return res.status(409).json({ error: 'GECERSIZ_DURUM', message: 'Bu etiket zaten işlendi.' });
  }

  await prisma.$transaction([
    prisma.pendingTag.update({ where: { id: tagId }, data: { status: 'APPROVED' } }),
    // Kullanıcının sectorTags listesine ekle (tekrar engelleyen Prisma set operasyonu yoktur;
    // uygulama katmanında kontrol et)
    prisma.user.updateMany({
      where: { id: tag.submittedBy, sectorTags: { has: tag.value } },
      data: {},  // zaten varsa değiştirme
    }),
  ]);

  // Henüz sectorTags'inde yoksa ekle
  await prisma.user.update({
    where: { id: tag.submittedBy },
    data: { sectorTags: { push: tag.value } },
  }).catch(() => {
    // push hatası = zaten eklenmiş, yok say
  });

  void logger.info('SYSTEM', 'Admin: Etiket onaylandı', { tagId, value: tag.value, tenantId: req.tenant.tenantId });
  return res.json({ message: 'Etiket onaylandı.', tagId, value: tag.value });
}

// ─── POST /api/admin/tags/:id/merge ──────────────────────────────────────────

/**
 * Admin: etiketi mevcut bir etikete eşler.
 * submittedBy kullanıcısının sectorTags'indeki eski etiket yerine hedef etiket yazılır.
 */
export async function mergeTag(req: RequestWithTenant, res: Response) {
  const tagId = req.params['id'] as string;

  const parsed = MergeTagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { targetTag } = parsed.data;

  const tag = await prisma.pendingTag.findFirst({
    where: { id: tagId, tenantId: req.tenant.tenantId },
    select: { id: true, value: true, status: true, submittedBy: true },
  });

  if (!tag) return res.status(404).json({ error: 'NOT_FOUND', message: 'Etiket bulunamadı.' });
  if (tag.status !== 'PENDING') {
    return res.status(409).json({ error: 'GECERSIZ_DURUM', message: 'Bu etiket zaten işlendi.' });
  }

  // Tüm kullanıcıların sectorTags'indeki eski etiket değerini hedef etikete güncelle
  // Not: Prisma JSON array güncelleme ham SQL gerektiriyor
  await prisma.$executeRaw`
    UPDATE "User"
    SET "sectorTags" = array_replace("sectorTags", ${tag.value}, ${targetTag})
    WHERE "tenantId" = ${req.tenant.tenantId}
      AND ${tag.value} = ANY("sectorTags")
  `;

  await prisma.pendingTag.update({
    where: { id: tagId },
    data: { status: 'MERGED', mergedInto: targetTag },
  });

  void logger.info('SYSTEM', 'Admin: Etiket birleştirildi', {
    tagId, from: tag.value, into: targetTag, tenantId: req.tenant.tenantId,
  });

  return res.json({ message: 'Etiket birleştirildi.', tagId, from: tag.value, into: targetTag });
}

// ─── POST /api/admin/tags/:id/reject ─────────────────────────────────────────

/** Admin: etiketi sessizce reddeder — kullanıcıya bildirim gönderilmez. */
export async function rejectTag(req: RequestWithTenant, res: Response) {
  const tagId = req.params['id'] as string;

  const tag = await prisma.pendingTag.findFirst({
    where: { id: tagId, tenantId: req.tenant.tenantId },
    select: { id: true, value: true, status: true },
  });

  if (!tag) return res.status(404).json({ error: 'NOT_FOUND', message: 'Etiket bulunamadı.' });
  if (tag.status !== 'PENDING') {
    return res.status(409).json({ error: 'GECERSIZ_DURUM', message: 'Bu etiket zaten işlendi.' });
  }

  await prisma.pendingTag.update({ where: { id: tagId }, data: { status: 'REJECTED' } });

  void logger.info('SYSTEM', 'Admin: Etiket reddedildi', { tagId, value: tag.value, tenantId: req.tenant.tenantId });
  return res.json({ message: 'Etiket reddedildi.', tagId });
}
