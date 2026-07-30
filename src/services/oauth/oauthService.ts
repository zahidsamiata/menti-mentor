/**
 * Provider-agnostik OAuth iş mantığı.
 *
 * Bu servis, hangi OAuth provider'ı kullanıldığından bağımsız olarak
 * kullanıcı upsert ve token issuance işlemlerini yönetir.
 *
 * Upsert stratejisi:
 *  1. E-posta + aynı provider → mevcut kullanıcıya giriş yap (profil güncellemesi yok)
 *  2. E-posta + farklı provider → 409 çakışma hatası (hesapları otomatik birleştirme güvenlik riski)
 *  3. E-posta yok (yeni kullanıcı) → PENDING onay durumuyla kayıt yap
 *
 * Neden 2. senaryoda otomatik merge yok? Kullanıcı A, B'nin e-postasını bilerek
 * farklı bir provider üzerinden hesap devralabilir. Güvenli birleştirme ayrı
 * bir "hesap bağlama" akışı gerektirir.
 */

import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import { signToken } from '../../middleware/jwtAuth.js';
import { sendAdminNewUserNotification } from '../emailService.js';
import { notifyAdminsPendingUser } from '../notificationService.js';
import { ensureMembershipSafe } from '../membership.js';
import type { OAuthCallbackResult, OAuthStatePayload, OAuthUserProfile } from './oauthTypes.js';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/** Ana giriş noktası: profil + state → access/refresh token çifti */
export async function handleOAuthCallback(
  profile: OAuthUserProfile,
  state: OAuthStatePayload,
): Promise<OAuthCallbackResult> {
  const existingUser = await prisma.user.findUnique({
    where: { email: profile.email },
    select: { id: true, tenantId: true, role: true, fullName: true, authProvider: true, isActive: true },
  });

  if (existingUser) {
    return handleExistingUser(existingUser, profile);
  }

  return handleNewUser(profile, state);
}

// ─── Mevcut kullanıcı ────────────────────────────────────────────────────────

async function handleExistingUser(
  user: {
    id: string;
    tenantId: string;
    role: 'ADMIN' | 'MENTOR' | 'MENTI';
    fullName: string;
    authProvider: string;
    isActive: boolean;
  },
  profile: OAuthUserProfile,
): Promise<OAuthCallbackResult> {
  // Hesap aktif değilse erken çık
  if (!user.isActive) {
    throw new OAuthConflictError('HESAP_PASIF', 'Bu hesap devre dışı bırakılmıştır.');
  }

  // LOCAL şifreli hesaba OAuth ile giriş: güvenlik riski — engelle
  if (user.authProvider === 'LOCAL') {
    throw new OAuthConflictError(
      'PROVIDER_CATISMASI',
      'Bu e-posta adresi şifre ile kayıtlıdır. Lütfen e-posta/şifre ile giriş yapın.',
    );
  }

  // Farklı OAuth provider (ör. Google hesabına LinkedIn ile erişmeye çalışma)
  if (user.authProvider !== profile.provider) {
    throw new OAuthConflictError(
      'PROVIDER_CATISMASI',
      `Bu e-posta adresi ${user.authProvider} ile kayıtlıdır. Lütfen aynı sağlayıcıyı kullanın.`,
    );
  }

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.tenantId, user.role, user.fullName);
  return { accessToken, refreshToken, isNewUser: false };
}

// ─── Yeni kullanıcı ─────────────────────────────────────────────────────────

async function handleNewUser(
  profile: OAuthUserProfile,
  state: OAuthStatePayload,
): Promise<OAuthCallbackResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: state.tenantSlug },
    select: { id: true, name: true, displayName: true },
  });

  if (!tenant) {
    throw new OAuthConflictError('TENANT_BULUNAMADI', 'Kuruluş bulunamadı. Lütfen geçerli bir bağlantı kullanın.');
  }

  const newUser = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: profile.email,
      fullName: profile.fullName,
      role: state.role,
      authProvider: profile.provider,
      approvalStatus: 'PENDING',
      avatarUrl: profile.avatarUrl ?? null,
      // password null — OAuth kullanıcıları şifre kullanmaz
    },
    select: { id: true, tenantId: true, role: true, fullName: true },
  });

  // b3: Kurum üyeliğini garanti et. GÜVENLİK: non-fatal — OAuth girişini ASLA bozmaz.
  await ensureMembershipSafe(prisma, newUser.id, newUser.tenantId, newUser.role);

  // Admin bildirimlerini arka planda gönder — giriş akışını yavaşlatmamalı
  void notifyAdmins(tenant, newUser.fullName, state.role);

  const { accessToken, refreshToken } = await issueTokenPair(
    newUser.id,
    newUser.tenantId,
    newUser.role,
    newUser.fullName,
  );
  return { accessToken, refreshToken, isNewUser: true };
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

/** Access token + refresh token çifti üretir ve refresh token'ı DB'ye kaydeder. */
async function issueTokenPair(
  userId: string,
  tenantId: string,
  role: 'ADMIN' | 'MENTOR' | 'MENTI',
  fullName: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signToken({ sub: userId, tenantId, role, fullName });

  const refreshTokenValue = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: { token: refreshTokenValue, userId, expiresAt },
  });

  return { accessToken, refreshToken: refreshTokenValue };
}

/** Admin bildirimlerini gönderir (e-posta + push). Fire-and-forget. */
async function notifyAdmins(
  tenant: { id: string; name: string; displayName: string | null },
  newUserFullName: string,
  role: string,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { tenantId: tenant.id, role: 'ADMIN', isActive: true },
    select: { email: true, fullName: true },
  });

  for (const admin of admins) {
    void sendAdminNewUserNotification({
      toEmail: admin.email,
      adminName: admin.fullName,
      newUserFullName,
      newUserRole: role,
      tenantName: tenant.displayName ?? tenant.name,
    });
  }

  void notifyAdminsPendingUser({ tenantId: tenant.id, newUserFullName, newUserRole: role });
}

// ─── Özel hata sınıfı ────────────────────────────────────────────────────────

/**
 * Çakışma veya tenant hataları için özel hata.
 * Controller katmanı bu hatayı yakalayıp uygun HTTP response'a dönüştürür.
 */
export class OAuthConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthConflictError';
  }
}
