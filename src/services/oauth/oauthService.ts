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
import { config } from '../../config.js';
import { verifyInvitationToken } from '../invitationToken.js';
import { signToken } from '../../middleware/jwtAuth.js';
import { sendAdminNewUserNotification } from '../emailService.js';
import { notifyAdminsPendingUser } from '../notificationService.js';
import { ensureMembershipSafe } from '../membership.js';
import { recordUserActivity } from '../activityService.js';
import { recordSignupConsent, recordGranularSignupConsent } from '../consentService.js';
import { hashRefreshToken } from '../refreshToken.js';
import { signPendingOAuthRegistration, verifyPendingOAuthRegistration } from './oauthPendingRegistration.js';
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

/** Yeni kullanıcı oluştururken gereken profil alanları — providerUserId burada GEREKMEZ (persist edilmiyor). */
type OAuthUserCreateProfile = Pick<OAuthUserProfile, 'email' | 'fullName' | 'provider' | 'avatarUrl'>;

type OAuthSignupConsentOpts =
  | { kind: 'implicit' }
  | { kind: 'granular'; granted: { mandatory: true; crossTenantSharing?: boolean; oceanProfiling?: boolean } };

async function handleNewUser(
  profile: OAuthUserProfile,
  state: OAuthStatePayload,
): Promise<OAuthCallbackResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: state.tenantSlug },
    select: { id: true, name: true, displayName: true, verificationStatus: true },
  });

  if (!tenant) {
    throw new OAuthConflictError('TENANT_BULUNAMADI', 'Kuruluş bulunamadı. Lütfen geçerli bir bağlantı kullanın.');
  }

  // Form kaydıyla (authController.register) aynı kapı: incelemedeki kuruma yeni üye kaydı yok.
  if (tenant.verificationStatus === 'PENDING_REVIEW') {
    throw new OAuthConflictError(
      'TENANT_ONAY_BEKLENIYOR',
      'Kurumunuz henüz inceleme aşamasında. Onaylandıktan sonra kayıt olabilirsiniz.',
    );
  }

  // U-06: geçerli davet token'ı (doğru kurum + doğru rol) → davetli APPROVED; form kaydıyla
  // (authController.register) BİREBİR aynı kural. Token yok / geçersiz / uyuşmuyor → PENDING.
  const claims = state.inviteToken ? verifyInvitationToken(state.inviteToken) : null;
  const approvalStatus: 'PENDING' | 'APPROVED' =
    claims && claims.tenantId === tenant.id && claims.role === state.role ? 'APPROVED' : 'PENDING';

  // AN-30 / KARAR-34 (OAuth ayağı, 2026-09-26) — flag AÇIKKEN kullanıcı ANINDA oluşturulmaz:
  // kısa ömürlü "bekleyen kayıt" token'ı üretilip granüler rıza ekranına yönlendirilir; kayıt
  // yalnız `finalizeOAuthRegistration` (complete-registration ucu) çağrılınca tamamlanır.
  // Flag KAPALIYKEN (varsayılan) bu blok hiç çalışmaz — davranış aşağıdaki implicit rıza
  // yoluyla BİREBİR eskisi gibi kalır (tek satır bile değişmez).
  if (config.oauth.granularConsentEnabled) {
    const pendingToken = signPendingOAuthRegistration({
      email: profile.email,
      fullName: profile.fullName,
      provider: profile.provider,
      avatarUrl: profile.avatarUrl,
      tenantId: tenant.id,
      role: state.role,
      approvalStatus,
    });
    return { pendingConsent: true, pendingToken };
  }

  return createOAuthUserAndIssueTokens(tenant, profile, approvalStatus, state.role, { kind: 'implicit' });
}

/**
 * Ortak yardımcı: kullanıcı oluşturma + rıza + membership + admin bildirimi + token üretimi.
 * `handleNewUser` (implicit rıza, flag kapalı) VE `finalizeOAuthRegistration` (granüler rıza,
 * flag açık — complete-registration ucu) tarafından paylaşılır; davranış farkı yalnız `consentOpts`'tadır.
 */
async function createOAuthUserAndIssueTokens(
  tenant: { id: string; name: string; displayName: string | null },
  profile: OAuthUserCreateProfile,
  approvalStatus: 'PENDING' | 'APPROVED',
  role: 'MENTOR' | 'MENTI',
  consentOpts: OAuthSignupConsentOpts,
): Promise<{ accessToken: string; refreshToken: string; isNewUser: true }> {
  // KVKK: rızasız kayıt olmamalı → user.create + tipli rıza AYNI transaction'da atomik.
  const newUser = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: profile.email,
        fullName: profile.fullName,
        role,
        authProvider: profile.provider,
        approvalStatus,
        avatarUrl: profile.avatarUrl ?? null,
        // password null — OAuth kullanıcıları şifre kullanmaz
        // KVKK Md.5 (ispat yükü): OAuth ile katılım da açık rıza anlamına gelir —
        // kullanıcı OAuth başlatırken davet/kayıt bağlamında KVKK'yı kabul eder.
        // Local register (authController) new Date() deseniyle aynı; legacy dual-write.
        kvkkConsentAt: new Date(),
      },
      select: { id: true, tenantId: true, role: true, fullName: true },
    });
    if (consentOpts.kind === 'granular') {
      // AN-30 / KARAR-34: FE'nin granüler rıza ekranından topladığı ayrı onaylar.
      await recordGranularSignupConsent({ userId: created.id }, consentOpts.granted, { source: 'OAUTH', db: tx });
    } else {
      // Tipli rıza (G1-07): AYDINLATMA + ACIK_RIZA, source=OAUTH.
      await recordSignupConsent({ userId: created.id }, 'OAUTH', { db: tx });
    }
    return created;
  });

  // b3: Kurum üyeliğini garanti et. GÜVENLİK: non-fatal — OAuth girişini ASLA bozmaz.
  await ensureMembershipSafe(prisma, newUser.id, newUser.tenantId, newUser.role);

  // Admin "onaya bak" bildirimi yalnız onay bekleyen kayıtta (form kaydıyla aynı).
  // Arka planda — giriş akışını yavaşlatmamalı.
  if (approvalStatus === 'PENDING') {
    void notifyAdmins(tenant, newUser.fullName, role);
  }

  const { accessToken, refreshToken } = await issueTokenPair(
    newUser.id,
    newUser.tenantId,
    newUser.role,
    newUser.fullName,
  );
  return { accessToken, refreshToken, isNewUser: true };
}

/**
 * POST /api/auth/oauth/complete-registration — AN-30 OAuth ayağı: granüler rıza ekranından
 * sonra kaydı tamamlar. `pendingToken`, OAuth callback'te (`handleNewUser`, flag açıkken)
 * üretilmiş imzalı "bekleyen kayıt" token'ıdır (bkz. oauthPendingRegistration.ts).
 */
export async function finalizeOAuthRegistration(
  pendingToken: string,
  granted: { mandatory: true; crossTenantSharing?: boolean; oceanProfiling?: boolean },
): Promise<{ accessToken: string; refreshToken: string; isNewUser: true }> {
  const pending = verifyPendingOAuthRegistration(pendingToken);
  if (!pending) {
    throw new OAuthConflictError(
      'PENDING_TOKEN_GECERSIZ',
      'Kayıt bağlantısının süresi dolmuş veya geçersiz. Lütfen OAuth ile tekrar deneyin.',
    );
  }

  // Tenant durumu token üretildiğinden beri değişmiş olabilir (ör. sonradan incelemeye
  // alınmış) — handleNewUser'daki kontrolü TEKRARLA (aynı kural, aynı hata kodları).
  const tenant = await prisma.tenant.findUnique({
    where: { id: pending.tenantId },
    select: { id: true, name: true, displayName: true, verificationStatus: true },
  });
  if (!tenant) {
    throw new OAuthConflictError('TENANT_BULUNAMADI', 'Kuruluş bulunamadı. Lütfen geçerli bir bağlantı kullanın.');
  }
  if (tenant.verificationStatus === 'PENDING_REVIEW') {
    throw new OAuthConflictError(
      'TENANT_ONAY_BEKLENIYOR',
      'Kurumunuz henüz inceleme aşamasında. Onaylandıktan sonra kayıt olabilirsiniz.',
    );
  }

  // Race koruması: token üretildikten sonra aynı e-posta başka bir yoldan kayıt olmuş olabilir.
  const existingUser = await prisma.user.findUnique({ where: { email: pending.email }, select: { id: true } });
  if (existingUser) {
    throw new OAuthConflictError('KULLANICI_MEVCUT', 'Bu e-posta adresi ile zaten bir hesap var. Lütfen giriş yapın.');
  }

  return createOAuthUserAndIssueTokens(
    tenant,
    { email: pending.email, fullName: pending.fullName, provider: pending.provider, avatarUrl: pending.avatarUrl },
    pending.approvalStatus,
    pending.role,
    { kind: 'granular', granted },
  );
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
    data: { token: hashRefreshToken(refreshTokenValue), userId, expiresAt },
  });

  // Retention: OAuth girişi de bir kimlik-doğrulama aktivitesidir → son aktiviteyi kaydet.
  void recordUserActivity(userId);

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
