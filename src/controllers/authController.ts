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
import { recordSignupConsent, hasCurrentSignupConsent } from '../services/consentService.js';
import { recordUserActivity } from '../services/activityService.js';
import { discLettersFromVector } from '../services/discLetters.js';
import { hashRefreshToken, refreshTokenLookupKeys, refreshTokenWhere } from '../services/refreshToken.js';
import { verifyInvitationToken } from '../services/invitationToken.js';
import { config } from '../config.js';
import { validateRequest } from '../middleware/validate.js';
import { isTenantSuspended, TENANT_CLOSED_FOR_SIGNUP_BODY } from '../middleware/tenantSuspension.js';
import { passwordSchema } from '../services/passwordPolicy.js';


// ─── Validation şemaları ──────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin'),
  password: passwordSchema,
  fullName: z.string().min(2, 'Ad soyad zorunlu').max(120),
  role: z.enum(['MENTOR', 'MENTI'], { error: 'Rol mentör ya da menti olmalı.' }),
  tenantSlug: z.string().min(1, 'Kuruluş kodu zorunlu'),
  // KVKK Md.5 — bireysel kullanıcı açık rızası; frontend checkbox zorunlu,
  // backend de enforce eder (API doğrudan çağrılırsa da consent şart).
  // K4 (18+ beyanı) bu onayın METNİNE gömülüdür (PO kararı: tek onay kutusu) —
  // ayrı ageConsent alanı YOK. Kullanıcı bu rızayı verirken 18+ olduğunu da beyan eder.
  kvkkConsent: z.literal(true, { message: 'KVKK onayı zorunludur.' }),
  // Davet token'ı (opsiyonel) — FE davet linkindeki token'ı iletir. Geçerliyse davetli
  // APPROVED olur (davet = onay; PO kararı 2026-09-01, Seçenek A). Yoksa PENDING kalır.
  inviteToken: z.string().optional(),
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
  password: passwordSchema,
});

// GV-19: oturum içi şifre değiştirme. Mevcut şifre yalnız "boş değil" kontrolünden geçer —
// eski kurala göre belirlenmiş şifreler de doğrulanabilmeli (LoginSchema ile aynı).
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut şifre zorunlu').max(1024),
  newPassword: passwordSchema,
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

// Oturum çerezini temizleyen tek yol: seçenekler set ile birebir aynı olmalı, yoksa tarayıcı
// çerezi silmeyebilir (GV-23 — hesap kapatma da bunu kullanır).
export function clearRefreshCookie(res: Response): void {
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
 *  - refreshToken  : 512-bit entropi (64 byte → 128 hex char) — DB'de SHA-256 hash (GV-13)
 *  - resetToken    : 256-bit entropi (32 byte → 64 hex char) — DB'de SHA-256 hash
 *
 * Neden hash? DB sızıntısında hash'ten raw token üretilemez. refreshToken için saklama/arama
 * kuralı ve eski açık-metin kayıtlarla geçiş uyumluluğu: services/refreshToken.ts.
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
  const parsed = validateRequest(RegisterSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const { email, password, fullName, role, tenantSlug, inviteToken } = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, displayName: true, verificationStatus: true, isActive: true },
  });
  if (!tenant) {
    return res.status(400).json({ error: 'TENANT_BULUNAMADI', message: REGISTER_MESSAGES.TENANT_NOT_FOUND });
  }

  // Y1-B9: dondurulmuş / reddedilmiş kuruma yeni üye alınmaz (komşu kapı TENANT_ONAY_BEKLENIYOR ile
  // aynı düzey: e-posta kontrolünden ÖNCE → e-posta numaralandırması açılmaz).
  if (isTenantSuspended(tenant)) {
    return res.status(403).json(TENANT_CLOSED_FOR_SIGNUP_BODY);
  }

  if (tenant.verificationStatus === 'PENDING_REVIEW') {
    return res.status(403).json({
      error: 'TENANT_ONAY_BEKLENIYOR',
      message: REGISTER_MESSAGES.TENANT_PENDING,
    });
  }

  // ─── Onay durumu: davet = onay (PO kararı 2026-09-01, Seçenek A; GÜVENLİK İYİLEŞTİRMESİ) ───
  // Geçerli davet token'ı (doğru tenant + doğru rol) → davetli APPROVED: kurum yöneticisi token'ı
  // üretip kime verdiğini bildiği için ikinci onay mükerrer (bedeli gönüllü kaybı).
  // Token YOK / geçersiz / uyuşmuyor → PENDING (admin onayı) korunur. Eskiden backend token'ı HİÇ
  // görmüyordu (yalnız tenantSlug) → API'ye davetsiz doğrudan POST atan otomatik onaylanabilirdi;
  // bu doğrulama o yolu da kapatır. Sahte token onay KAZANDIRMAZ; kaydı da reddetmeyiz (admin onaylar).
  // ⚠️ GÜNCELLEME (2026-09-25, U-06): OAuth kaydı da artık davet token'ını state içinde taşır ve
  // aynı kuralı uygular (`oauthService.handleNewUser`).
  let approvalStatus: 'PENDING' | 'APPROVED' = 'PENDING';
  if (inviteToken) {
    const claims = verifyInvitationToken(inviteToken);
    if (claims && claims.tenantId === tenant.id && claims.role === role) {
      approvalStatus = 'APPROVED';
    }
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

  // KVKK: rızasız kayıt olmamalı → user.create + tipli rıza (AYDINLATMA + ACIK_RIZA) AYNI
  // transaction'da atomik. kvkkConsentAt legacy ispat olarak dual-write edilir (G1-07).
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId:     tenant.id,
        email,
        password:     hashedPassword,
        authProvider: 'LOCAL',
        fullName,
        role,
        approvalStatus, // davet geçerliyse APPROVED, aksi halde PENDING (yukarıda hesaplandı)
        kvkkConsentAt:  new Date(), // KVKK Md.5: onay anını kaydet (legacy, dual-write)
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
    await recordSignupConsent({ userId: created.id }, 'FORM', { db: tx });
    return created;
  });

  // Her kullanıcı için UserProfile yaşam döngüsünü başlat (idempotent).
  // Skorlama alanları onboarding'de doldurulur; burada yalnızca satırın varlığı garanti edilir.
  await ensureUserProfile(user.id);

  // b3: Kurum üyeliğini garanti et (kurum-içi rol/sayım kaynağı TenantMembership.role).
  // GÜVENLİK: non-fatal — membership yazımı kaydı ASLA bozmamalı (kullanıcı zaten oluştu).
  await ensureMembershipSafe(prisma, user.id, user.tenantId, user.role);

  // Admin onay bildirimleri YALNIZ onay bekleyen (PENDING) kayıtta gönderilir. Davetli APPROVED
  // ise onaylanacak bir şey yoktur → admin'e "onaya bak" bildirimi gönderilmez (yanıltıcı olurdu).
  if (approvalStatus === 'PENDING') {
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
  }

  return res.status(201).json({
    message: REGISTER_MESSAGES.SUCCESS_PENDING_APPROVAL,
    user,
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// ─── Oturum yükü (login + refresh ortak) ──────────────────────────────────────
// KR-02/KR-03: sayfa yenilemede (sessiz refresh) istemci kullanıcıyı ve KENDİ kurumunun
// markasını login'dekiyle aynı biçimde alır; aksi hâlde F5 sonrası kullanıcı bilgisi boş kalıyordu.
// Kurum HER ZAMAN oturumdaki kullanıcının tenantId'sinden okunur (istekten değil) · açık select.
interface SessionUserSource {
  id: string;
  tenantId: string;
  role: string;
  fullName: string;
  email: string;
  approvalStatus: string;
  discType: string | null;
  discVector: unknown;
  needsOrientation: boolean;
  needsReconsent: boolean;
}

function toSessionUser(user: SessionUserSource) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    approvalStatus: user.approvalStatus,
    discType: user.discType,
    discLetters: discLettersFromVector(user.discVector), // #12: türetilmiş 1–3 harf (ör. "DI")
    needsOrientation: user.needsOrientation,
    // GV-18: rıza metni sürümü güncellenip kullanıcının aktif rızası eskide kalırsa true.
    // Bugün CONSENT_VERSION yer tutucu olduğundan hiçbir aktif kullanıcı için tetiklenmez.
    needsReconsent: user.needsReconsent,
  };
}

async function loadSessionTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, displayName: true, logoUrl: true, primaryColor: true },
  });
  return tenant
    ? {
        id: tenant.id,
        name: tenant.displayName ?? tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
      }
    : null;
}

export async function login(req: Request, res: Response) {
  const parsed = validateRequest(LoginSchema, req.body, res);
  if (!parsed.success) return parsed.response;

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
      discVector: true, // #12: DISC çoklu-harf türetimi için (ham vektör response'a KONMAZ — aşağıda yalnız discLetters).
      needsOrientation: true,
      rejectionReason: true,
    },
  });

  // ─── #37 Enumeration sertleştirme: ÖNCE kimlik doğrula, SONRA duruma göre yönlendir ───────
  // Güvenlik ilkesi: kimlik doğrulaması (doğru şifre) BAŞARISIZ olduğunda kullanıcıya HİÇBİR
  // durum bilgisi sızmaz — herkese AYNI generic 401. Saldırgan şifre denemeden bir e-postanın
  // DURUMUNU (kayıtlı mı / onay bekliyor / reddedildi / pasif / sosyal hesap) çıkaramaz.
  //
  // Doğrulanamayan hesap (yok / OAuth / şifresiz) → yanlış-şifreyle AYNI generic 401 döner: aynı
  // error kodu + aynı mesaj, ayırt edilemez. Sosyal-hesap ipucu da artık sızmaz; meşru OAuth
  // kullanıcı sosyal giriş düğmesini kullanır. NOT: zamanlama (timing) yan-kanalı kapsam dışı
  // (üretim-öncesi, düşük risk — mesaj/response içeriği sızıntısına odaklanıldı).
  if (!user || user.authProvider !== 'LOCAL' || !user.password) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }

  // ─── Kimlik doğrulandı → durum bazlı yönlendirme (yalnız doğru şifreden SONRA — sızmaz) ────
  // Sıra önemli: REJECTED hesapların isActive=false olabilir → pasif kontrolünden ÖNCE gelmeli.

  // İş 3 P2: reddedilen kullanıcı gerekçesini görür + tekrar başvurabilir (POST /api/auth/reapply).
  // Token VERİLMEZ (Yol 1); FE red ekranını bu yanıttan besler.
  if (user.approvalStatus === 'REJECTED') {
    return res.status(403).json({
      error: 'HESAP_REDDEDILDI',
      message: 'Başvurunuz şu an onaylanmadı. Aşağıdaki notu inceleyip dilerseniz tekrar başvurabilirsiniz.',
      rejectionReason: user.rejectionReason ?? null,
      canReapply: true,
    });
  }

  // Pasif / sistemden çıkarılmış (reddedilmiş değil) hesap — durum yalnız şifre sonrası bildirilir.
  if (!user.isActive) {
    return res.status(403).json({
      error: 'HESAP_PASIF',
      message: 'Hesabınız aktif değil. Lütfen kurum yöneticinizle iletişime geçin.',
    });
  }

  // Onay bekleyen hesap — bekleme ekranına yönlendirilir (FE: /pending-approval).
  if (user.approvalStatus === 'PENDING') {
    return res.status(403).json({
      error: 'HESAP_ONAY_BEKLENIYOR',
      message: 'Hesabınız henüz yönetici tarafından onaylanmamıştır. Onay sonrası giriş yapabilirsiniz.',
    });
  }

  const tenant = await loadSessionTenant(user.tenantId);

  const accessToken = signToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    fullName: user.fullName,
  });

  const refreshTokenValue = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      token: hashRefreshToken(refreshTokenValue),
      userId: user.id,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  setRefreshCookie(res, refreshTokenValue);

  // Retention: son aktivite anını kaydet (fire-and-forget, giriş akışını bloklamaz).
  void recordUserActivity(user.id);

  const needsReconsent = !(await hasCurrentSignupConsent({ userId: user.id }));

  return res.json({
    accessToken,
    expiresIn: 3600,
    user: toSessionUser({ ...user, needsReconsent }),
    tenant,
  });
}

/**
 * POST /api/auth/reapply — İş 3 P3: reddedilen kullanıcı tekrar başvurur.
 *
 * Güvenlik:
 *  - Kimlik doğrulama e-posta+ŞİFRE ile (enumeration-safe: yanlış şifre → generic 401).
 *  - IDOR: yalnızca kimliği doğrulanan KENDİ hesabını etkiler (param yok, token yok).
 *  - Yalnızca REJECTED → PENDING geçişine izin verir; başka durum → 409.
 *  - Kurum askıdaysa (Y1-B9b) → 403 KURUM_KAYDA_KAPALI (kayıt kapısıyla aynı; şifre doğrulamasından sonra).
 *  - Geçmiş KORUNUR: rejectionReason/rejectedBy/rejectedAt SİLİNMEZ (çok-yönetici: yeni bakan
 *    yönetici en son red gerekçesini görebilmeli). Test/DISC/profil verisine DOKUNULMAZ.
 */
export async function reapply(req: Request, res: Response) {
  const parsed = validateRequest(LoginSchema, req.body, res);
  if (!parsed.success) return parsed.response;
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, password: true, authProvider: true, approvalStatus: true, fullName: true,
      tenant: { select: { isActive: true, verificationStatus: true } },
    },
  });

  // Enumeration koruması: kullanıcı yok / OAuth / şifre yanlış → hepsi aynı generic 401.
  if (!user || user.authProvider !== 'LOCAL' || !user.password) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }
  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'E-posta veya şifre hatalı.' });
  }

  // Y1-B9b: askıdaki (dondurulmuş / reddedilmiş) kuruma yeniden başvuru = yeni üye kaydı → kayıttaki
  // KURUM_KAYDA_KAPALI kapısıyla AYNI yanıt. Şifre doğrulandıktan SONRA → e-posta numaralandırması açılmaz.
  if (isTenantSuspended(user.tenant)) {
    return res.status(403).json(TENANT_CLOSED_FOR_SIGNUP_BODY);
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

  // Özetli kayıt ya da (geçiş dönemi) eski açık-metin kayıt — bkz. services/refreshToken.ts.
  const stored = await prisma.refreshToken.findFirst({
    where: refreshTokenWhere(refreshToken),
    include: {
      user: {
        select: {
          id: true,
          role: true,
          fullName: true,
          tenantId: true,
          isActive: true,
          email: true,
          approvalStatus: true,
          discType: true,
          discVector: true, // yalnız discLetters türetimi için; ham vektör yanıta KONMAZ
          needsOrientation: true,
        },
      },
    },
  });

  if (!stored || stored.expiresAt < new Date()) {
    if (stored) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
    }
    return res.status(401).json({
      error: 'REFRESH_TOKEN_GECERSIZ',
      message: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.',
    });
  }

  if (!stored.user.isActive) {
    return res.status(401).json({ error: 'HESAP_PASIF', message: 'Hesabınız aktif değil.' });
  }

  // Token rotasyonu: eski token silinir, yeni token verilir (replay attack önlemi).
  // Eski kayıt açık metinse bu adım onu özetli kayda dönüştürmüş olur (GV-13 geçişi).
  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const newRefreshTokenValue = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      token: hashRefreshToken(newRefreshTokenValue),
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

  const needsReconsent = !(await hasCurrentSignupConsent({ userId: stored.user.id }));

  return res.json({
    accessToken,
    expiresIn: 3600,
    user: toSessionUser({ ...stored.user, needsReconsent }),
    tenant: await loadSessionTenant(stored.user.tenantId),
  });
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
export async function logout(req: Request, res: Response) {
  const refreshToken = getRefreshTokenFromCookie(req);

  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: refreshTokenWhere(refreshToken) });
  }

  clearRefreshCookie(res);
  return res.status(204).send();
}

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
export async function forgotPassword(req: Request, res: Response) {
  const parsed = validateRequest(ForgotPasswordSchema, req.body, res);
  if (!parsed.success) return parsed.response;

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
  const parsed = validateRequest(ResetPasswordSchema, req.body, res);
  if (!parsed.success) return parsed.response;

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

// ─── POST /api/auth/change-password — GV-19: oturum içi şifre değiştirme ─────
/**
 * Kimlik OTURUMDAN (req.auth) alınır, gövdeden DEĞİL — komşu uçlar getMe/reconsent ile aynı desen.
 * Hash ve oturum düşürme resetPassword ile aynı: BCRYPT_ROUNDS + refresh token silme. Fark:
 * isteği yapan oturum (refresh çerezi) KORUNUR, kullanıcı bu cihazda çıkışa zorlanmaz; diğer tüm
 * cihazlardaki oturumlar düşer. Çerez yoksa hepsi silinir ve yanıtta belirtilir.
 */
export async function changePassword(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Oturum açılmamış.' });
  }

  const parsed = validateRequest(ChangePasswordSchema, req.body, res);
  if (!parsed.success) return parsed.response;
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true, password: true, authProvider: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  // OAuth (Google/LinkedIn) hesabının uygulamada şifresi yoktur; şifre o sağlayıcıda yönetilir.
  if (user.authProvider !== 'LOCAL' || !user.password) {
    return res.status(409).json({
      error: 'SIFRE_DEGISTIRILEMEZ',
      message: 'Hesabınız Google veya LinkedIn ile açıldığı için şifre bu sağlayıcı üzerinden yönetilir.',
    });
  }

  const currentMatches = await bcrypt.compare(currentPassword, user.password);
  if (!currentMatches) {
    return res.status(400).json({
      error: 'MEVCUT_SIFRE_HATALI',
      message: 'Mevcut şifre hatalı.',
    });
  }

  if (await bcrypt.compare(newPassword, user.password)) {
    return res.status(400).json({
      error: 'SIFRE_AYNI',
      message: 'Yeni şifre mevcut şifrenizden farklı olmalı.',
    });
  }

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Bu isteği yapan oturumun refresh kaydı korunur (yalnız bu kullanıcıya aitse eşleşir);
  // diğer tüm oturumlar düşer. Şifre güncelleme + oturum düşürme tek transaction.
  const currentRefreshToken = getRefreshTokenFromCookie(req);
  const keepKeys = currentRefreshToken ? refreshTokenLookupKeys(currentRefreshToken) : [];
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } }),
    prisma.refreshToken.deleteMany({
      where: keepKeys.length > 0
        ? { userId: user.id, token: { notIn: keepKeys } }
        : { userId: user.id },
    }),
  ]);

  const currentSessionKept = keepKeys.length > 0
    && (await prisma.refreshToken.count({ where: { userId: user.id, token: { in: keepKeys } } })) > 0;

  return res.json({
    message: currentSessionKept
      ? 'Şifreniz güncellendi. Diğer cihazlardaki oturumlarınız kapatıldı.'
      : 'Şifreniz güncellendi. Tüm oturumlarınız kapatıldı; bir sonraki yenilemede tekrar giriş yapmanız gerekebilir.',
    currentSessionKept,
    revokedSessions: revoked.count,
  });
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

// Yalnız kayıt defterindeki anahtarları kabul et (GV-21): `:provider` catch-all rotasıdır;
// düz nesne erişimi `constructor` gibi miras anahtarlarını da "var" sayardı.
function isOAuthProviderKey(key: unknown): key is OAuthProviderKey {
  return typeof key === 'string' && Object.hasOwn(OAUTH_PROVIDERS, key);
}

const OAuthInitSchema = z.object({
  tenantSlug: z.string().min(1, 'Kurum bilgisi eksik. Lütfen kurumunuzun giriş bağlantısını kullanın.'),
  role: z.enum(['MENTOR', 'MENTI'], { error: 'Rol mentör ya da menti olmalı.' }),
  // U-06: kayıt sayfasındaki davet token'ı — callback'te doğrulanır (burada yalnız biçim sınırı).
  inviteToken: z.string().min(1).max(2048).optional(),
});

/**
 * GET /api/auth/:provider — OAuth akışını başlatır.
 * Kullanıcıyı provider'ın yetkilendirme sayfasına yönlendirir.
 *
 * Query params: tenantSlug, role
 * Örnek: GET /api/auth/google?tenantSlug=tech-hub&role=MENTOR
 */
export async function oauthRedirect(req: Request, res: Response) {
  const providerKey = req.params['provider'];
  if (!isOAuthProviderKey(providerKey)) {
    return res.status(404).json({ error: 'PROVIDER_BULUNAMADI', message: 'Desteklenmeyen OAuth provider.' });
  }
  const provider = OAUTH_PROVIDERS[providerKey];

  // Provider yapılandırılmamışsa (boş clientId) geliştirici hatası — erken çık
  const providerConfig = config.oauth[providerKey];
  if (!providerConfig.clientId) {
    return res.status(503).json({
      error: 'PROVIDER_YAPILANDIRILMAMIS',
      message: `${providerKey.toUpperCase()} OAuth henüz yapılandırılmamış.`,
    });
  }

  const parsed = validateRequest(OAuthInitSchema, req.query, res);
  if (!parsed.success) return parsed.response;

  const state = createOAuthState(parsed.data.tenantSlug, parsed.data.role, parsed.data.inviteToken);
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
  const providerKey = req.params['provider'];
  if (!isOAuthProviderKey(providerKey)) {
    return redirectWithError(res, 'PROVIDER_BULUNAMADI');
  }
  const provider = OAUTH_PROVIDERS[providerKey];

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

  // #37: kurum başvuru durumu — kurum yöneticisi "düzeltme istendi" bilgisini burada görür.
  // Tenant-scoped (req.tenant.tenantId) → IDOR yok. correctionNote YALNIZ ADMIN'e (kurumun
  // başvurusunu düzeltecek kişi); MENTOR/MENTI için null (onları ilgilendirmez).
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenant.tenantId },
    select: {
      id: true, name: true, displayName: true, slug: true, logoUrl: true, primaryColor: true,
      verificationStatus: true, correctionNote: true, isActive: true,
    },
  });

  // GV-18: rıza sürümü güncel mi (bkz. toSessionUser'daki aynı alan).
  const needsReconsent = !(await hasCurrentSignupConsent({ userId: user.id }));

  // #12: kendi profili — DISC çoklu-harf türetilir (vektör kendi verisi, zaten dönüyor).
  return res.json({
    ...user,
    tenantId: req.tenant.tenantId, // KR-03: istemci kurum markasını bu kimlikle eşler (oturumdan)
    discLetters: discLettersFromVector(user.discVector),
    needsReconsent,
    tenant: tenant
      ? {
          id: tenant.id,
          name: tenant.displayName ?? tenant.name,
          slug: tenant.slug,
          logoUrl: tenant.logoUrl,
          primaryColor: tenant.primaryColor,
          verificationStatus: tenant.verificationStatus,
          // Y1-B9: kurum askıda mı (dondurma/ret) — istemci askı bilgisini gösterebilsin.
          isSuspended: isTenantSuspended(tenant),
          correctionNote: user.role === 'ADMIN' ? (tenant.correctionNote ?? null) : null,
        }
      : null,
  });
}

// ─── POST /api/auth/reconsent — GV-18: rıza metni sürümü güncellenince kullanıcı yeniden onaylar ──
export async function reconsent(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Oturum açılmamış.' });
  }

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  // Kayıttaki AYDINLATMA+ACIK_RIZA dual-write ile AYNI yardımcı — yeni satır açar, eskisi silinmez
  // (denetim izi korunur). Sürüm her zaman GÜNCEL CONSENT_VERSION ile yazılır.
  await recordSignupConsent({ userId: user.id }, 'FORM');

  return res.json({ needsReconsent: false });
}
