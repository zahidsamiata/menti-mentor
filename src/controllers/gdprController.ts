import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import {
  anonymizeUser,
  hardDeleteUser,
  exportUserData,
  isSoleActiveTenantAdmin,
  ACCOUNT_CLOSED_MESSAGE,
} from '../services/gdprService.js';

const UserIdSchema = z.object({ id: z.string().min(5) });

// Self-servis hesap kapatmada yanlışlıkla tetiklemeyi önleyen teyit: kullanıcı KENDİ
// e-postasını yazar. Büyük/küçük harf ve boşluk normalize edilerek karşılaştırılır.
const DeleteAccountSchema = z.object({
  confirmEmail: z.string().trim().email('Geçerli bir e-posta adresi girin'),
});

const REFRESH_COOKIE_NAME = 'mm_refresh';

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

// ─── Self-servis KVKK hakları (G1-05) — userId TOKEN'dan, gövdeden DEĞİL ───────

// GET /api/me/data-export — kullanıcı KENDİ verisini indirir.
// userId TOKEN'dan (req.auth) alınır → başka kullanıcının verisine erişim yapısal olarak imkânsız (IDOR yok).
export async function exportMyDataHandler(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Bu işlem için giriş yapmalısınız.' });
  }

  const result = await exportUserData(req.auth.userId, req.tenant.tenantId);
  return res.json(result);
}

// POST /api/me/delete-account — kullanıcı KENDİ hesabını kapatır (anonimleştirir, GERİ ALINAMAZ).
// userId TOKEN'dan; gövdede yalnız teyit e-postası. Silmez, anonimleştirir (madde 39) → ACIK_RIZA geri çekilir.
export async function deleteMyAccountHandler(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Bu işlem için giriş yapmalısınız.' });
  }

  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const userId = req.auth.userId;
  const tenantId = req.tenant.tenantId;

  // Teyit e-postasını gerçek e-posta ile karşılaştır (yanlışlıkla tetiklenmesin).
  // Not: prisma global `omit` password → hash dönmez; yalnız email seçilir.
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { email: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'KULLANICI_BULUNAMADI', message: 'Hesabınız bulunamadı.' });
  }
  if (user.email.trim().toLowerCase() !== parsed.data.confirmEmail.toLowerCase()) {
    return res.status(400).json({
      error: 'EPOSTA_ESLESMEDI',
      message: 'Girdiğiniz e-posta hesabınızın e-postasıyla eşleşmiyor. Hesabınız kapatılmadı.',
    });
  }

  // Son admin guard: kurumun tek yöneticisi kendini kapatamaz (kurum sahipsiz kalmasın).
  if (await isSoleActiveTenantAdmin(userId, tenantId)) {
    return res.status(409).json({
      error: 'SON_ADMIN',
      message:
        'Kurumunuzun tek yöneticisi olduğunuz için hesabınızı kapatamazsınız. ' +
        'Önce başka bir yönetici atayın veya platform ekibiyle iletişime geçin.',
    });
  }

  const result = await hardDeleteUser(userId, tenantId);

  // Oturum sonlandır: anonymizeUser üyeliği pasife alıp refresh token'ları sildi; refresh cookie'sini de temizle.
  res.clearCookie(REFRESH_COOKIE_NAME);

  return res.json({ message: ACCOUNT_CLOSED_MESSAGE, ...result });
}
