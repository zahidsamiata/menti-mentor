import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { signToken } from '../middleware/jwtAuth.js';
import type { RequestWithTenant } from '../types.js';
import { sendAdminNewUserNotification, sendPasswordResetEmail, sendAlreadyRegisteredEmail } from '../services/emailService.js';
import { notifyAdminsPendingUser } from '../services/notificationService.js';
import { GoogleOAuthProvider, OAuthProviderError } from '../services/oauth/googleProvider.js';
import { LinkedInOAuthProvider } from '../services/oauth/linkedinProvider.js';
import { createOAuthState, verifyOAuthState } from '../services/oauth/oauthStateService.js';
import { handleOAuthCallback, OAuthConflictError } from '../services/oauth/oauthService.js';
import { ensureUserProfile } from '../services/userProfile.service.js';
import { ensureMembershipSafe } from '../services/membership.js';
import { recordUserActivity } from '../services/activityService.js';
import { config } from '../config.js';


// ─── Validation şemaları ──────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
  fullName: z.string().min(2, 'Ad soyad zorunlu').max(120),
  role: z.enum(['MENTOR', 'MENTI'], { error: 'Rol MENTOR veya MENTI olmalı' }),
  tenantSlug: z.string().min(1, 'Kuruluş kodu zorunlu'),
  // KVKK Md.5 — bireysel kullanıcı açık rızası; frontend checkbox zorunlu,
  // backend de enforce eder (API doğrudan çağrılırsa da consent şart).
  // K4 (18+ beyanı) bu onayın METNİNE gömülüdür (PO kararı: tek onay kutusu) —
  // ayrı ageConsent alanı YOK. Kullanıcı bu rızayı verirken 18+ olduğunu da beyan eder.
  kvkkConsent: z.literal(true, { message: 'KVKK onayı zorunludur.' }),
});

const LoginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin'),
  password: z.string().min(1, 'Şifre zorunlu'),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin'),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token zorunlu'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
});

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const RESET_TOKEN_EXPIRY_MINUTES = 60;
const BCRYPT_ROUNDS = 12;
const REFRESH_COOKIE_NAME = 'mm_refresh';

const isProd = process.env.NODE_ENV === 'production';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: 'strict' });
}

function getRefreshTokenFromCookie(req: Request): string | undefined {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === REFRESH_COOKIE_NAME) return decodeURIComponent(val);
  }
  return undefined;
}

/**
 * Token güvenlik modeli:
 *  - refreshToken  : 512-bit entropi (64 byte → 128 hex char) — DB'de plaintext
 *  - resetToken    : 256-bit entropi (32 byte → 64 hex char) — DB'de SHA-256 hash
 *
 * resetToken neden hash'leniyor?
 *  DB sızıntısında saldırgan hash'ten raw token'ı üretemez.
 *  refreshToken hash'lenmiyor çünkü ömrü 7 gün ve rotasyon var;
 *  resetToken ise e-posta ile iletilir, daha uzun süre oturabilir.
 */
function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function refreshTokenExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return d;
}

function resetTokenExpiresAt(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + RESET_TOKEN_EXPIRY_MINUTES);
  return d;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── Kayıt akışı kullanıcı mesajları ─────────────────────────────────────────
// Tek yerde tutulur (dedupe + tutarlılık + çeviri kolaylığı). Enumeration-safe:
// e-posta zaten kayıtlıysa da "başarılı" yanıtı döner (aşağıda); mesaj hiçbir
// yerde hesabın var olup olmadığını sızdırmaz. İki success dönüşü de AYNI mesajı
// kullanmalı (kayıtlı/kayıtsız ayırt edilemesin).
const REGISTER_MESSAGES = {
  TENANT_NOT_FOUND: 'Kuruluş bulunamadı. Davet bağlantınızı kontrol edin.',
  TENANT_PENDING:
    'Bu kurum henüz platform tarafından onaylanmamıştır. Onaylandığında kayıt olabilirsiniz.',
  SUCCESS_PENDING_APPROVAL:
    'Kaydınız alındı. Kurum yöneticiniz onayladıktan sonra giriş yapabilirsiniz.',
} as const;

// ─── POST /api/auth/register ──────────────────────────────────────────────────
export async function register(req: Request, res: Response) {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { email, password, fullName, role, tenantSlug } = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, displayName: true, verificationStatus: true },
  });
  if (!tenant) {
    return res.status(400).json({ error: 'TENANT_BULUNAMADI', message: REGISTER_MESSAGES.TENANT_NOT_FOUND });
  }

  if (tenant.verificationStatus === 'PENDING_REVIEW') {
    return res.status(403).json({
      error: 'TENANT_ONAY_BEKLENIYOR',
      message: REGISTER_MESSAGES.TENANT_PENDING,
    });
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, fullName: true },
  });
  if (existing) {
    // E-posta numaralandırmasını önle: kayıtlı ve kayıtsız e-posta için aynı yanıt
    void sendAlreadyRegisteredEmail({ toEmail: email, userName: existing.fullName });
    return res.status(201).json({
      message: REGISTER_MESSAGES.SUCCESS_PENDING_APPROVAL,
      user: null,
    });
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      tenantId:     tenant.id,
      email,
      password:     hashedPassword,
      authProvider: 'LOCAL',
      fullName,
      role,
      approvalStatus: 'PENDING',
      kvkkConsentAt:  new Date(), // KVKK Md.5: onay anını kaydet
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      tenantId: true,
      approvalStatus: true,
    },
  });

  // Her kullanıcı için UserProfile yaşam döngüsünü başlat (idempotent).
  // Skorlama alanları onboarding'de doldurulur; burada yalnızca satırın varlığı garanti edilir.
  await ensureUserProfile(user.id);

  // b3: Kurum üyeliğini garanti et (kurum-içi rol/sayım kaynağı TenantMembership.role).
  // GÜVENLİK: non-fatal — membership yazımı kaydı ASLA bozmamalı (kullanıcı zaten oluştu).
  await ensureMembershipSafe(prisma, user.id, user.tenantId, user.role);

  // Sprint 8 admin bildirim servisi — tenant adminlerine e-posta + push
  const tenantAdmins = await prisma.user.findMany({
    where: { tenantId: tenant.id, role: 'ADMIN', isActive: true },
    select: { email: true, fullName: true },
  });

  for (const admin of tenantAdmins) {
    void sendAdminNewUserNotification({
      toEmail: admin.email,
      adminName: admin.fullName,
      newUserFullName: fullName,
      newUserRole: role,
      tenantName: tenant.displayName ?? tenant.name,
    });
  }

  void notifyAdminsPendingUser({
    tenantId: tenant.id,
    newUserFullName: fullName,
    newUserRole: role,
  });

  return res.status(201).json({
    message: REGISTER_MESSAGES.SUCCESS_PENDING_APPROVAL,
    user,
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
export async function login(req: Request, res: Response) {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      fullName: true,
      tenantId: true,
      email: true,
      password: true,
      authProvider: true,
      approvalStatus: true,
      isActive: true,
      discType: true,
      needsOrientation: true,
      rejectionReason: true,
    },
  });

  // Hesap bulunamadı veya pasif — generic hata (zamanlama/enumeration koruması).
  // İSTİSNA: REDDEDİLEN kullanıcı (isActive=false) buradan GEÇER — gerekçesini görüp tekrar
  // başvurabilmesi için. Red bilgisi yine de ŞİFRE DOĞRULAMASINDAN SONRA açılır (aşağıda).
  if (!user || (!user.isActive && user.approvalStatus !== 'REJECTED')) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }

  if (user.approvalStatus === 'PENDING') {
    return res.status(403).json({
      error: 'HESAP_ONAY_BEKLENIYOR',
      message: 'Hesabınız henüz yönetici tarafından onaylanmamıştır. Onay sonrası giriş yapabilirsiniz.',
    });
  }

  // NOT: REJECTED durumu ARTIK BURADA (şifre öncesi) ele ALINMAZ — enumeration'ı önlemek için
  // şifre doğrulamasından SONRAya taşındı (İş 3 P2). Böylece reddedilme bilgisi doğru şifre olmadan sızmaz.

  if (user.authProvider !== 'LOCAL' || !user.password) {
    return res.status(401).json({
      error: 'OAUTH_HESAP',
      message: 'Bu hesap sosyal giriş ile oluşturulmuştur. Lütfen ilgili sağlayıcıyı kullanın.',
    });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }

  // İş 3 P2: reddedilen kullanıcı — ŞİFRE DOĞRULANDIKTAN SONRA gerekçesini görür (enumeration-safe:
  // yanlış şifrede yukarıda generic 401 döndü). Token VERİLMEZ (Yol 1); FE red ekranını bu yanıttan besler.
  // Tekrar başvuru: POST /api/auth/reapply (aynı kimlik doğrulamasıyla).
  if (user.approvalStatus === 'REJECTED') {
    return res.status(403).json({
      error: 'HESAP_REDDEDILDI',
      message: 'Başvurunuzu tamamlamak için birkaç güncelleme gerekiyor. Aşağıdaki gerekçeyi inceleyip tekrar başvurabilirsiniz.',
      rejectionReason: user.rejectionReason ?? null,
      canReapply: true,
    });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { id: true, name: true, slug: true, displayName: true, logoUrl: true, primaryColor: true },
  });

  const accessToken = signToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    fullName: user.fullName,
  });

  const refreshTokenValue = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  setRefreshCookie(res, refreshTokenValue);

  // Retention: son aktivite anını kaydet (fire-and-forget, giriş akışını bloklamaz).
  void recordUserActivity(user.id);

  return res.json({
    accessToken,
    expiresIn: 3600,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      fullName: user.fullName,
      email: user.email,
      approvalStatus: user.approvalStatus,
      discType: user.discType,
      needsOrientation: user.needsOrientation,
    },
    tenant: tenant
      ? {
          id: tenant.id,
          name: tenant.displayName ?? tenant.name,
          slug: tenant.slug,
          logoUrl: tenant.logoUrl,
          primaryColor: tenant.primaryColor,
        }
      : null,
  });
}

/**
 * POST /api/auth/reapply — İş 3 P3: reddedilen kullanıcı tekrar başvurur.
 *
 * Güvenlik:
 *  - Kimlik doğrulama e-posta+ŞİFRE ile (enumeration-safe: yanlış şifre → generic 401).
 *  - IDOR: yalnızca kimliği doğrulanan KENDİ hesabını etkiler (param yok, token yok).
 *  - Yalnızca REJECTED → PENDING geçişine izin verir; başka durum → 409.
 *  - Geçmiş KORUNUR: rejectionReason/rejectedBy/rejectedAt SİLİNMEZ (çok-yönetici: yeni bakan
 *    yönetici en son red gerekçesini görebilmeli). Test/DISC/profil verisine DOKUNULMAZ.
 */
export async function reapply(req: Request, res: Response) {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true, authProvider: true, approvalStatus: true, fullName: true },
  });

  // Enumeration koruması: kullanıcı yok / OAuth / şifre yanlış → hepsi aynı generic 401.
  if (!user || user.authProvider !== 'LOCAL' || !user.password) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }
  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }

  // Yalnızca reddedilmiş başvuru tekrar gönderilebilir (şifre doğrulandı → durum açıklanabilir).
  if (user.approvalStatus !== 'REJECTED') {
    return res.status(409).json({
      error: 'GECERSIZ_DURUM',
      message: 'Bu işlem yalnızca reddedilmiş başvurular için geçerlidir.',
    });
  }

  // REJECTED → PENDING. isActive tekrar true (normal bekleyen başvuru gibi). Red geçmişi KORUNUR.
  await prisma.user.update({
    where: { id: user.id },
    data: { approvalStatus: 'PENDING', isActive: true },
  });

  return res.json({
    message: 'Başvurunuz yeniden alındı ve değerlendirme için yöneticinize iletildi.',
    approvalStatus: 'PENDING',
  });
}

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
export async function refresh(req: Request, res: Response) {
  const refreshToken = getRefreshTokenFromCookie(req);
  if (!refreshToken) {
    return res.status(401).json({
      error: 'REFRESH_TOKEN_EKSIK',
      message: 'Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.',
    });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          fullName: true,
          tenantId: true,
          isActive: true,
        },
      },
    },
  });

  if (!stored || stored.expiresAt < new Date()) {
    if (stored) {
      await prisma.refreshToken.delete({ where: { token: refreshToken } });
    }
    return res.status(401).json({
      error: 'REFRESH_TOKEN_GECERSIZ',
      message: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.',
    });
  }

  if (!stored.user.isActive) {
    return res.status(401).json({ error: 'HESAP_PASIF', message: 'Hesabınız aktif değil.' });
  }

  // Token rotasyonu: eski token silinir, yeni token verilir (replay attack önlemi)
  await prisma.refreshToken.delete({ where: { token: refreshToken } });

  const newRefreshTokenValue = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      token: newRefreshTokenValue,
      userId: stored.user.id,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  const accessToken = signToken({
    sub: stored.user.id,
    tenantId: stored.user.tenantId,
    role: stored.user.role,
    fullName: stored.user.fullName,
  });

  // Retention: token yenileme de aktif oturum sinyalidir → son aktiviteyi tazele.
  void recordUserActivity(stored.user.id);

  setRefreshCookie(res, newRefreshTokenValue);

  return res.json({
    accessToken,
    expiresIn: 3600,
  });
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
export async function logout(req: Request, res: Response) {
  const refreshToken = getRefreshTokenFromCookie(req);

  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  clearRefreshCookie(res);
  return res.status(204).send();
}

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
export async function forgotPassword(req: Request, res: Response) {
  const parsed = ForgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const GENERIC_SUCCESS_MESSAGE = 'E-posta adresiniz kayıtlıysa şifre sıfırlama bağlantısı gönderildi.';

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, fullName: true, email: true, authProvider: true, isActive: true },
  });

  // Token DB'ye yazılmadan response gönderilmez — kullanıcı tespiti yine de engellenir
  // (aynı mesaj döner, ancak artık tüm DB işlemleri tamamlandıktan sonra).
  if (user && user.isActive && user.authProvider === 'LOCAL') {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(rawToken),
        userId: user.id,
        expiresAt: resetTokenExpiresAt(),
      },
    });

    void sendPasswordResetEmail({
      toEmail: user.email,
      userName: user.fullName,
      rawToken,
    });
  }

  return res.json({ message: GENERIC_SUCCESS_MESSAGE });
}

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
export async function resetPassword(req: Request, res: Response) {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, isActive: true } } },
  });

  if (!stored || stored.expiresAt < new Date() || !stored.user.isActive) {
    // Süresi dolmuş token'ı temizle
    if (stored) await prisma.passwordResetToken.delete({ where: { tokenHash } });
    return res.status(400).json({
      error: 'TOKEN_GECERSIZ',
      message: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.',
    });
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Şifreyi güncelle + token'ı sil + tüm refresh token'ları iptal et (tek transaction)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: stored.userId },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.delete({ where: { tokenHash } }),
    prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
  ]);

  return res.json({ message: 'Şifreniz başarıyla güncellendi. Lütfen tekrar giriş yapın.' });
}

// ─── OAuth: provider başlatma + callback ─────────────────────────────────────

/**
 * Provider instance'larını tek noktada tanımla.
 * Yeni bir provider eklemek için sadece bu kayıt defterine ekleme yapmak yeterli —
 * redirect ve callback handler'ları otomatik olarak devreye girer.
 */
const OAUTH_PROVIDERS = {
  google: new GoogleOAuthProvider(),
  linkedin: new LinkedInOAuthProvider(),
} as const;

type OAuthProviderKey = keyof typeof OAUTH_PROVIDERS;

const OAuthInitSchema = z.object({
  tenantSlug: z.string().min(1, 'tenantSlug zorunlu'),
  role: z.enum(['MENTOR', 'MENTI'], { error: 'Rol MENTOR veya MENTI olmalı' }),
});

/**
 * GET /api/auth/:provider — OAuth akışını başlatır.
 * Kullanıcıyı provider'ın yetkilendirme sayfasına yönlendirir.
 *
 * Query params: tenantSlug, role
 * Örnek: GET /api/auth/google?tenantSlug=tech-hub&role=MENTOR
 */
export async function oauthRedirect(req: Request, res: Response) {
  const providerKey = req.params['provider'] as OAuthProviderKey;
  const provider = OAUTH_PROVIDERS[providerKey];

  if (!provider) {
    return res.status(404).json({ error: 'PROVIDER_BULUNAMADI', message: 'Desteklenmeyen OAuth provider.' });
  }

  // Provider yapılandırılmamışsa (boş clientId) geliştirici hatası — erken çık
  const providerConfig = config.oauth[providerKey];
  if (!providerConfig.clientId) {
    return res.status(503).json({
      error: 'PROVIDER_YAPILANDIRILMAMIS',
      message: `${providerKey.toUpperCase()} OAuth henüz yapılandırılmamış.`,
    });
  }

  const parsed = OAuthInitSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const state = createOAuthState(parsed.data.tenantSlug, parsed.data.role);
  const authUrl = provider.buildAuthUrl(state);

  return res.redirect(authUrl);
}

/**
 * GET /api/auth/:provider/callback — Provider'dan dönen authorization code'u işler.
 *
 * Başarı: frontend'e accessToken + refreshToken + isNewUser query parametreleriyle yönlendir.
 * Hata: frontend'e error kodu ile yönlendir.
 *
 * Neden redirect? OAuth callback browser tablosunda gerçekleşir; SPA'ya mesaj
 * iletmenin standart yolu URL parametresidir. Frontend'in bu değerleri
 * LocalStorage'a taşıması ve URL'i temizlemesi gerekir.
 */
export async function oauthCallback(req: Request, res: Response) {
  const providerKey = req.params['provider'] as OAuthProviderKey;
  const provider = OAUTH_PROVIDERS[providerKey];

  if (!provider) {
    return redirectWithError(res, 'PROVIDER_BULUNAMADI');
  }

  const { code, state, error } = req.query as Record<string, string | undefined>;

  // Kullanıcı izin vermeden geri dönüşü (ör. "İzin verme" butonu)
  if (error) {
    return redirectWithError(res, 'KULLANICI_REDDETTI');
  }

  if (!code || !state) {
    return redirectWithError(res, 'GECERSIZ_CALLBACK');
  }

  // CSRF koruması: state JWT'yi doğrula
  const statePayload = verifyOAuthState(state);
  if (!statePayload) {
    return redirectWithError(res, 'GECERSIZ_STATE');
  }

  try {
    const profile = await provider.exchangeCodeForProfile(code);
    const result = await handleOAuthCallback(profile, statePayload);

    setRefreshCookie(res, result.refreshToken);
    const params = new URLSearchParams({
      accessToken: result.accessToken,
      isNewUser: String(result.isNewUser),
    });
    return res.redirect(`${config.oauth.frontendCallbackUrl}?${params.toString()}`);
  } catch (err) {
    if (err instanceof OAuthConflictError) {
      return redirectWithError(res, err.code);
    }
    if (err instanceof OAuthProviderError) {
      return redirectWithError(res, 'PROVIDER_HATASI');
    }
    // Beklenmeyen hata — genel hata kodu
    return redirectWithError(res, 'SUNUCU_HATASI');
  }
}

/** Hata durumunda frontend callback URL'ine error kodu ile yönlendir. */
function redirectWithError(res: Response, errorCode: string): void {
  const params = new URLSearchParams({ error: errorCode });
  res.redirect(`${config.oauth.frontendCallbackUrl}?${params.toString()}`);
}

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
export async function getMe(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Oturum açılmamış.' });
  }

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId, isActive: true },
    select: {
      id: true,
      role: true,
      fullName: true,
      email: true,
      discType: true,
      sectorTags: true,
      skills: true,
      bioSummary: true,
      needsOrientation: true,
      discVector: true,
      approvalStatus: true,
      authProvider: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  return res.json(user);
}
