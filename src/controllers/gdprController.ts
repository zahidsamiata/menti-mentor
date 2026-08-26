import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { anonymizeUser, hardDeleteUser, exportUserData, ACCOUNT_CLOSED_MESSAGE } from '../services/gdprService.js';

const UserIdSchema = z.object({ id: z.string().min(5) });

// POST /api/users/:id/anonymize — KVKK anonimleştirme talebi
export async function anonymizeUserHandler(req: RequestWithTenant, res: Response) {
  const parsed = UserIdSchema.safeParse({ id: req.params['id'] });
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  if (!req.auth || req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca tenant admin erişebilir.' });
  }

  const result = await anonymizeUser(parsed.data.id, req.tenant.tenantId);
  return res.json({ message: 'Kullanıcı KVKK kapsamında anonimleştirildi.', ...result });
}

// DELETE /api/users/:id/hard-delete — "Silme" talebi ANONİMLEŞTİRMEYE yönlendirilir (madde 39, PO kararı).
// Endpoint adı korunur (geriye uyum) ama dönen mesaj gerçeği söyler: silinmez, anonimleştirilir.
export async function hardDeleteUserHandler(req: RequestWithTenant, res: Response) {
  const parsed = UserIdSchema.safeParse({ id: req.params['id'] });
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  if (!req.auth || req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca tenant admin erişebilir.' });
  }

  const result = await hardDeleteUser(parsed.data.id, req.tenant.tenantId);
  return res.json({ message: ACCOUNT_CLOSED_MESSAGE, ...result });
}

// GET /api/users/:id/export — Veri taşınabilirliği (KVKK Md.11 / GDPR Md.20)
export async function exportUserDataHandler(req: RequestWithTenant, res: Response) {
  const parsed = UserIdSchema.safeParse({ id: req.params['id'] });
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  // Kullanıcı kendi verisini veya admin export edebilir
  const isSelf = req.auth?.userId === parsed.data.id;
  const isAdmin = req.auth?.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca kullanıcı kendi verisini veya admin export edebilir.' });
  }

  const result = await exportUserData(parsed.data.id, req.tenant.tenantId);
  return res.json(result);
}
