/**
 * Provider-agnostik OAuth iş mantığı.
 *
 * Bu servis, hangi OAuth provider'ı kullanıldığından bağımsız olarak
 * kullanıcı upsert ve token issuance işlemlerini yönetir.
 *
 * Upsert stratejisi:
 *  1. E-posta + aynı provider → mevcut kullanıcıya giriş yap (profil güncellemesi yok)
 *  2. E-posta + farklı provider / LOCAL / pasif hesap → tek tip OAUTH_GIRIS_YAPILAMADI (AJ-30;
 *     hesapları otomatik birleştirme güvenlik riski, durum ayırt ettirilmez)
 *  3. E-posta yok (yeni kullanıcı) → PENDING onay durumuyla kayıt yap
 *
 * Neden 2. senaryoda otomatik merge yok? Kullanıcı A, B'nin e-postasını bilerek
 * farklı bir provider üzerinden hesap devralabilir. Güvenli birleştirme ayrı
 * bir "hesap bağlama" akışı gerektirir.
 */

import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import { verifyInvitationToken } from '../invitationToken.js';
import { signToken } from '../../middleware/jwtAuth.js';
import { isTenantSuspended, TENANT_CLOSED_FOR_SIGNUP_BODY } from '../../middleware/tenantSuspension.js';
import { sendAdminNewUserNotification } from '../emailService.js';
import { notifyAdminsPendingUser } from '../notificationService.js';
import { ensureMembershipSafe } from '../membership.js';
import { recordUserActivity } from '../activityService.js';
import { recordSignupConsent } from '../consentService.js';
import { hashRefreshToken } from '../refreshToken.js';
import type { OAuthCallbackResult, OAuthStatePayload, OAuthUserProfile } from './oauthTypes.js';
import { USER_CONTACT_SELECT } from '../../utils/userSelect.js';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * AJ-30: mevcut hesapla eşleşmeyen sosyal giriş için tek tip hata kodu + mesaj.
 * Eski ayrı kodlar (HESAP_PASIF / PROVIDER_CATISMASI) hesabın varlığını ve durumunu
 * ayırt ettiriyordu; sağlayıcı adı da mesajda yer almaz.
 */
export const OAUTH_ACCOUNT_MISMATCH_CODE = 'OAUTH_GIRIS_YAPILAMADI';
const OAUTH_ACCOUNT_MISMATCH_MESSAGE = 'Bu yöntemle giriş yapılamadı.';

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
  // AJ-30 (IC-06 kalanı): pasif/reddedilmiş hesap, şifreli (LOCAL) hesap ve farklı sağlayıcıyla
  // açılmış hesap → TEK TİP kod. Dönüş adresindeki ?error= kodu hesabın durumunu/açılış yöntemini
  // ayırt ettirmez (şifre girişindeki tek tip 401 ile aynı ilke — authController.login).
  if (!user.isActive || user.authProvider === 'LOCAL' || user.authProvider !== profile.provider) {
    throw new OAuthConflictError(OAUTH_ACCOUNT_MISMATCH_CODE, OAUTH_ACCOUNT_MISMATCH_MESSAGE);
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
    select: { id: true, name: true, displayName: true, verificationStatus: true, isActive: true },
  });

  if (!tenant) {
    throw new OAuthConflictError('TENANT_BULUNAMADI', 'Kuruluş bulunamadı. Lütfen geçerli bir bağlantı kullanın.');
  }

  // Y1-B9: form kaydıyla (authController.register) aynı kapı — dondurulmuş / reddedilmiş kuruma
  // yeni üye alınmaz.
  if (isTenantSuspended(tenant)) {
    throw new OAuthConflictError(TENANT_CLOSED_FOR_SIGNUP_BODY.error, TENANT_CLOSED_FOR_SIGNUP_BODY.message);
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

  // KVKK: rızasız kayıt olmamalı → user.create + tipli rıza AYNI transaction'da atomik.
  // YALNIZ yeni kullanıcıda (bu fonksiyon mevcut kullanıcıda çağrılmaz) → tekrar rıza yazılmaz.
  const newUser = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: profile.email,
        fullName: profile.fullName,
        role: state.role,
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
    // Tipli rıza (G1-07): AYDINLATMA + ACIK_RIZA, source=OAUTH.
    await recordSignupConsent({ userId: created.id }, 'OAUTH', { db: tx });
    return created;
  });

  // b3: Kurum üyeliğini garanti et. GÜVENLİK: non-fatal — OAuth girişini ASLA bozmaz.
  await ensureMembershipSafe(prisma, newUser.id, newUser.tenantId, newUser.role);

  // Admin "onaya bak" bildirimi yalnız onay bekleyen kayıtta (form kaydıyla aynı).
  // Arka planda — giriş akışını yavaşlatmamalı.
  if (approvalStatus === 'PENDING') {
    void notifyAdmins(tenant, newUser.fullName, state.role);
  }

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
  const refreshTokenValue = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  // AJ-31: önce oturum kaydı, sonra id'sini `sid` olarak taşıyan anahtar (bkz. jwtAuth.ts).
  const session = await prisma.refreshToken.create({
    data: { token: hashRefreshToken(refreshTokenValue), userId, expiresAt },
    select: { id: true },
  });

  const accessToken = signToken({ sub: userId, tenantId, role, fullName, sid: session.id });

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
    select: USER_CONTACT_SELECT,
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
