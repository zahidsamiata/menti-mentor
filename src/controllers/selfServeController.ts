import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { signToken, verifyToken, extractBearerToken } from '../middleware/jwtAuth.js';
import { invalidateTenant } from '../services/tenantCache.js';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function refreshTokenExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return d;
}

// JWT'yi doğrula ve ADMIN olduğunu kontrol et.
// X-Tenant-Id header'ı gerektirmeyen self-serve akışı için kullanılır.
function extractAdminPayload(req: Request, res: Response) {
  const token = extractBearerToken(req.header('Authorization'));
  if (!token) {
    res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'JWT token gereklidir.' });
    return null;
  }
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'ADMIN') {
    res.status(403).json({ error: 'YETKI_YOK', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
    return null;
  }
  return payload;
}

// ─── DISC Önizleme Motoru (kural tabanlı, LLM yok) ───────────────────────────

const DISC_ARCHETYPES: Record<string, { name: string; emoji: string; power: string }> = {
  D: { name: 'Lider',          emoji: '⚡', power: 'Kararlılık ve Hız'    },
  I: { name: 'İlham Veren',    emoji: '🌟', power: 'İkna ve Enerji'       },
  S: { name: 'Denge Kurucusu', emoji: '🌿', power: 'Güven ve Sabır'       },
  C: { name: 'Analist',        emoji: '🔬', power: 'Doğruluk ve Derinlik' },
};

// Dominant DISC boyutuna göre uyumluluk katmanları
const DISC_COMPAT: Record<string, { green: string; yellow: string; red: string }> = {
  D: { green: 'S', yellow: 'I', red: 'D' },
  I: { green: 'C', yellow: 'D', red: 'I' },
  S: { green: 'D', yellow: 'C', red: 'S' },
  C: { green: 'I', yellow: 'S', red: 'C' },
};

// Toksik eşleşme nedenleri — eş boyut çakışması
const RED_NARRATIVES: Record<string, string> = {
  D: 'İki güçlü lider karakteri aynı ortamda çatışma üretir. Güç mücadelesi mentörlük ilişkisinin önüne geçer.',
  I: 'İki yüksek "I" profili dikkat için yarışır; asıl gelişim hedefi arka planda kalır.',
  S: 'İki yüksek "S" profili pasif bir ilişki dinamiği yaratır. Hiçbiri değişimi başlatmak istemez.',
  C: 'İki yüksek "C" profili analiz döngüsüne girer; kararlar ertelenir, ilerleme durur.',
};

// Güçlü sinerji açıklamaları (dominant boyut × tamamlayıcı boyut)
const GREEN_NARRATIVES: Record<string, Record<string, string>> = {
  D: {
    S: 'Sen hızlı karar alan bir lidersin; bu menti sakinliği ve güveniyle seni dengeler. Kararlılık + Sabır kombinasyonu uzun soluklu ilerleme üretir.',
    C: 'Vizyon ile hassasiyet buluşuyor. Senin hedef odaklı yapın, bu mentinin derin analizi ile tamamlanır; körü körüne hız yerine bilinçli atılım.',
  },
  I: {
    C: 'Senin ilham veren enerjin, bu mentinin titiz analitiğiyle buluştuğunda hem yaratıcı hem sağlam bir gelişim ortaya çıkar.',
    D: 'Coşku ve kararlılık güçlü bir ikili oluşturuyor. Senin fikir üretme hızın, bu mentinin uygulama gücüyle anlam kazanır.',
  },
  S: {
    D: 'Senin güçlü dinleme yeteneğin ve güvenilirliğin, bu mentinin kararlı enerjisini zemine oturtur. Sabır + Hız = Denge.',
    I: 'Sen güven zemini, onlar coşku rüzgârı. İkisi bir arada mentörlük ilişkisini canlı tutar.',
  },
  C: {
    I: 'Senin analitik derinliğin, bu mentinin yaratıcı enerjisiyle buluştuğunda projeler hem doğru hem ilham verici olur.',
    D: 'Veri ve karar birleşiyor. Senin doğruluk odaklı yapın, bu mentinin hız ve cesaretiyle güçlü sonuçlar üretir.',
  },
};

type CompatTier = 'green' | 'yellow' | 'red';

function buildNarrative(
  adminDim: string,
  personaDim: string,
  tier: CompatTier,
): { headline: string; body: string; blockedReason: string | null } {
  const aA = DISC_ARCHETYPES[adminDim];
  const pA = DISC_ARCHETYPES[personaDim];

  if (tier === 'red') {
    return {
      headline: '⚠️ Toksik Eşleşme Engellendi',
      body: RED_NARRATIVES[adminDim] ?? 'Bu DISC kombinasyonu sistematik olarak engellenir.',
      blockedReason: 'DISC_CONFLICT',
    };
  }

  if (tier === 'yellow') {
    return {
      headline: `${aA?.emoji} ${aA?.name} + ${pA?.emoji} ${pA?.name} → Orta Uyum`,
      body: 'Her iki profilin güçlü yanları farklı alanlarda kendini gösterir. Beklentiler net tanımlandığında başarılı bir ilişki mümkün; bilinçli çaba gerektirir.',
      blockedReason: null,
    };
  }

  const specificBody = GREEN_NARRATIVES[adminDim]?.[personaDim]
    ?? `${aA?.power} ve ${pA?.power} birbirini tamamlayan farklı güçler. Gelişim için ideal zemin.`;

  return {
    headline: `${aA?.emoji} ${aA?.name} + ${pA?.emoji} ${pA?.name} → Güçlü Sinerji`,
    body: specificBody,
    blockedReason: null,
  };
}

function getDominantDimension(discVector: Record<string, number>): string {
  const dims = ['D', 'I', 'S', 'C'] as const;
  return dims.reduce((best, dim) => (
    (discVector[dim] ?? 0) > (discVector[best] ?? 0) ? dim : best
  ), 'D' as string);
}

function buildMockPersonas(adminDim: string) {
  const compat = DISC_COMPAT[adminDim] ?? { green: 'S', yellow: 'I', red: adminDim };

  const PERSONA_NAMES   = ['Ayşe K.', 'Burak T.', 'Canan M.'];
  const PERSONA_GOALS   = [
    'Teknik liderliğe geçiş yaparak ekibini büyütmek',
    'Girişimcilik fikrini olgunlaştırıp ilk yatırımcıyla tanışmak',
    'Kariyerinde yurt dışı fırsatları araştırmak',
  ];
  // Sabit skorlar — önizleme tutarlı kalmalı, her yenilemede farklılaşmamalı
  const SCORES = { green: 88, yellow: 57, red: 18 };

  const tiers: CompatTier[] = ['green', 'yellow', 'red'];
  return tiers.map((tier, i) => {
    const personaDim = compat[tier];
    return {
      personaId:  `mock-${tier}-0${i + 1}`,
      name:       PERSONA_NAMES[i],
      discType:   personaDim,
      archetype:  DISC_ARCHETYPES[personaDim],
      goal:       PERSONA_GOALS[i],
      matchScore: SCORES[tier],
      tier,
      ...buildNarrative(adminDim, personaDim, tier),
    };
  });
}

// ─── GET /api/self-serve/check-slug?slug=xxx ─────────────────────────────────
// Herkese açık — kimlik doğrulama gerektirmez.
// Onboarding wizard'da anlık slug müsaitlik kontrolü için kullanılır.

const SlugQuerySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir'),
});

export async function checkSlugAvailability(req: Request, res: Response) {
  const parsed = SlugQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ available: false, error: 'GECERSIZ_SLUG', message: parsed.error.flatten().fieldErrors['slug']?.[0] ?? 'Geçersiz slug.' });
  }

  const exists = await prisma.tenant.findUnique({
    where:  { slug: parsed.data.slug },
    select: { id: true },
  });

  return res.json({ available: !exists, slug: parsed.data.slug });
}

// ─── POST /api/tenants/self-serve/register ────────────────────────────────────

const SelfServeRegisterSchema = z.object({
  email:           z.string().email('Geçerli bir e-posta adresi girin'),
  password:        z.string().min(8, 'Şifre en az 8 karakter olmalı'),
  name:            z.string().min(2, 'Ad soyad zorunlu').max(120),
  tenantName:      z.string().min(2, 'Kurum adı zorunlu').max(120),
  slug:            z
    .string()
    .min(2, 'Slug en az 2 karakter olmalı')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir'),
  programTemplate: z.enum(['MEZUN', 'KULUP', 'GONULLU', 'OZEL']).default('OZEL'),
  // KVKK Md.5 — açık rıza zorunlu. Frontend checkbox ile kontrol edilir;
  // backend de enforce eder (API doğrudan çağrılırsa da consent şart).
  kvkkConsent:     z.literal(true, { message: 'KVKK onayı zorunludur.' }),
});

export async function selfServeRegister(req: Request, res: Response) {
  const parsed = SelfServeRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { email, password, name, tenantName, slug, programTemplate } = parsed.data;

  const [slugExists, emailExists] = await Promise.all([
    prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);

  if (slugExists) {
    return res.status(409).json({
      error:   'SLUG_MEVCUT',
      message: 'Bu kurum adresi (slug) zaten kullanılıyor. Farklı bir tane deneyin.',
    });
  }
  if (emailExists) {
    return res.status(409).json({
      error:   'EMAIL_MEVCUT',
      message: 'Bu e-posta adresi zaten kayıtlı.',
    });
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Atomic transaction: tenant + admin kullanıcı + üyelik
  const { tenant, user } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name:             tenantName,
        slug,
        plan:             'FREE',
        onboardingStep:   'TEMPLATE',
        programTemplate,
        unsubscribeToken: crypto.randomUUID(), // Faz 3: e-posta unsubscribe linki
        kvkkConsentAt:    new Date(),           // KVKK Md.5: onay anını kaydet
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId:       tenant.id,
        email,
        password:       hashedPassword,
        authProvider:   'LOCAL',
        fullName:       name,
        role:           'ADMIN',
        approvalStatus: 'APPROVED', // Kurumu kuran yönetici direkt onaylıdır
        isActive:       true,
      },
      select: {
        id: true, email: true, fullName: true,
        role: true, tenantId: true,
      },
    });

    // requireTenant middleware'inin TenantMembership.isActive kontrolü için zorunlu
    await tx.tenantMembership.create({
      data: {
        userId:   user.id,
        tenantId: tenant.id,
        role:     'ADMIN',
        isActive: true,
      },
    });

    return { tenant, user };
  });

  // Access token + refresh token (login akışıyla tutarlı)
  const accessToken = signToken({
    sub:      user.id,
    tenantId: tenant.id,
    role:     'ADMIN',
    fullName: user.fullName,
  });

  const rawRefresh = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      token:     rawRefresh,
      userId:    user.id,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  return res.status(201).json({
    message: 'Kurumunuz başarıyla oluşturuldu.',
    tenant: {
      id:              tenant.id,
      name:            tenant.name,
      slug:            tenant.slug,
      plan:            tenant.plan,
      onboardingStep:  tenant.onboardingStep,
      programTemplate: tenant.programTemplate,
    },
    user: {
      id:       user.id,
      email:    user.email,
      fullName: user.fullName,
      role:     user.role,
    },
    accessToken,
    refreshToken: rawRefresh,
  });
}

// ─── PATCH /api/tenants/:id/onboarding ───────────────────────────────────────

const ONBOARDING_STEPS = ['PENDING', 'TEMPLATE', 'LOGO', 'PREVIEW', 'DONE'] as const;

const UpdateOnboardingSchema = z
  .object({
    onboardingStep:  z.enum(ONBOARDING_STEPS).optional(),
    logoUrl:         z.string().url('Geçerli bir URL girin').optional(),
    primaryColor:    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir hex renk kodu girin')
      .optional(),
    limits:          z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function updateOnboarding(req: Request, res: Response) {
  const payload = extractAdminPayload(req, res);
  if (!payload) return;

  const tenantId = req.params['id'] as string;

  if (payload.tenantId !== tenantId) {
    return res.status(403).json({
      error:   'YETKI_YOK',
      message: 'Başka bir kurumun onboarding adımını güncelleyemezsiniz.',
    });
  }

  const parsed = UpdateOnboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { onboardingStep, logoUrl, primaryColor, limits } = parsed.data;

  // Hiçbir alan gönderilmemişse 400 dön
  if (!onboardingStep && !logoUrl && !primaryColor && !limits) {
    return res.status(400).json({
      error:   'BOSH_ISTEK',
      message: 'En az bir güncelleme alanı gönderilmelidir.',
    });
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ...(onboardingStep !== undefined && { onboardingStep }),
      ...(logoUrl        !== undefined && { logoUrl }),
      ...(primaryColor   !== undefined && { primaryColor }),
      ...(limits         !== undefined && { limits }),
    },
    select: {
      id: true, name: true, slug: true,
      plan: true, onboardingStep: true,
      logoUrl: true, primaryColor: true,
      limits: true, programTemplate: true,
    },
  });

  invalidateTenant(tenantId);

  return res.json({ message: 'Onboarding adımı güncellendi.', tenant: updated });
}

// ─── GET /api/tenants/:slug/preview ──────────────────────────────────────────

export async function getTenantPreview(req: Request, res: Response) {
  const payload = extractAdminPayload(req, res);
  if (!payload) return;

  const slug = req.params['slug'] as string;

  const tenant = await prisma.tenant.findUnique({
    where:  { slug },
    select: { id: true, name: true, slug: true, plan: true, programTemplate: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  if (payload.tenantId !== tenant.id) {
    return res.status(403).json({
      error:   'YETKI_YOK',
      message: 'Bu kurumun önizlemesine erişim yetkiniz yok.',
    });
  }

  // Admin'in DISC vektörünü oku (findUnique → RLS extension filtrelemez, doğrudan güvenli)
  const admin = await prisma.user.findUnique({
    where:  { id: payload.sub },
    select: { discVector: true, discType: true },
  });

  if (!admin?.discVector) {
    return res.status(422).json({
      error:   'DISC_TESTI_EKSIK',
      message: 'Önizleme için önce DISC mizaç testini tamamlamanız gerekmektedir.',
      hint:    '/api/questions endpoint\'inden sorular alınabilir.',
    });
  }

  const discVector  = admin.discVector as Record<string, number>;
  const dominantDim = getDominantDimension(discVector);
  const adminArch   = DISC_ARCHETYPES[dominantDim];
  const personas    = buildMockPersonas(dominantDim);

  const blockedCount = personas.filter((p) => p.tier === 'red').length;
  const matchedCount = personas.length - blockedCount;

  return res.json({
    preview: true,
    tenant:  { id: tenant.id, name: tenant.name, slug: tenant.slug },
    adminProfile: {
      dominantDimension: dominantDim,
      archetype:         adminArch,
      discVector,
    },
    personas,
    meta: {
      total:        personas.length,
      matchedCount,
      blockedCount,
      message: `${adminArch?.emoji} ${adminArch?.name} profilinizle sistemimiz ${matchedCount} uyumlu eşleşme üretti ve ${blockedCount} toksik eşleşmeyi engelledi.`,
    },
  });
}

// ─── Davet Token Yardımcıları ─────────────────────────────────────────────────

interface InvitationTokenClaims {
  tenantId: string;
  role:     'MENTOR' | 'MENTI';
  type:     'invitation';
  iat?:     number;
  exp?:     number;
}

function signInvitationToken(tenantId: string, role: 'MENTOR' | 'MENTI'): string {
  return jwt.sign(
    { tenantId, role, type: 'invitation' },
    config.jwt.secret,
    { expiresIn: config.invitationTokenExpiry } as jwt.SignOptions,
  );
}

function verifyInvitationToken(token: string): InvitationTokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as InvitationTokenClaims;
    // type guard: normal auth token'larının bu endpoint'e geçmesini engelle
    return decoded.type === 'invitation' ? decoded : null;
  } catch {
    return null;
  }
}

// ─── POST /api/tenants/:id/invitations ───────────────────────────────────────

const CreateInvitationSchema = z.object({
  role: z.enum(['MENTOR', 'MENTI']),
});

export async function createInvitation(req: Request, res: Response) {
  const payload = extractAdminPayload(req, res);
  if (!payload) return;

  const tenantId = req.params['id'] as string;

  if (payload.tenantId !== tenantId) {
    return res.status(403).json({
      error:   'YETKI_YOK',
      message: 'Başka bir kurumun davet linkini oluşturamazsınız.',
    });
  }

  const parsed = CreateInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  // Tenant varlık kontrolü (JWT payload'ı stale olabilir)
  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, name: true, displayName: true, slug: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  const { role } = parsed.data;
  const invitationToken = signInvitationToken(tenantId, role);
  const invitationLink  = `${config.frontendBaseUrl}/join?token=${invitationToken}`;

  return res.status(201).json({
    invitationLink,
    token:     invitationToken,
    expiresIn: config.invitationTokenExpiry,
    role,
    tenant: {
      id:   tenant.id,
      name: tenant.displayName ?? tenant.name,
      slug: tenant.slug,
    },
  });
}

// ─── GET /api/invitations/:token/join ────────────────────────────────────────

export async function joinViaInvitation(req: Request, res: Response) {
  const rawToken = req.params['token'] as string;

  const claims = verifyInvitationToken(rawToken);
  if (!claims) {
    return res.status(401).json({
      error:   'TOKEN_GECERSIZ',
      message: 'Davet linki geçersiz veya süresi dolmuş. Yöneticinizden yeni bir link isteyin.',
      valid:   false,
    });
  }

  const tenant = await prisma.tenant.findUnique({
    where:  { id: claims.tenantId },
    select: {
      name:            true,
      displayName:     true,
      slug:            true,
      logoUrl:         true,
      primaryColor:    true,
      programTemplate: true,
      plan:            true,
    },
  });

  if (!tenant) {
    return res.status(404).json({
      error:   'TENANT_BULUNAMADI',
      message: 'Bu davet linki artık geçerli bir kuruma ait değil.',
      valid:   false,
    });
  }

  return res.json({
    valid:           true,
    role:            claims.role,
    tenantName:      tenant.displayName ?? tenant.name,
    slug:            tenant.slug,
    logoUrl:         tenant.logoUrl,
    primaryColor:    tenant.primaryColor ?? '#6366f1',
    programTemplate: tenant.programTemplate,
    plan:            tenant.plan,
  });
}

// ─── GET /api/tenants/unsubscribe?token=<uuid> ────────────────────────────────

/**
 * Faz 3 — E-posta aboneliğinden çıkma.
 * Auth gerektirmez; token yeterlidir (e-postaya gönderilen link).
 * KVKK: pazarlama/kurtarma e-postalarında unsubscribe linki ZORUNLU.
 */
export async function unsubscribeTenant(req: Request, res: Response) {
  const token = req.query['token'] as string | undefined;
  if (!token || typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ error: 'GECERSIZ_TOKEN', message: 'Geçersiz token.' });
  }

  const tenant = await prisma.tenant.findUnique({
    where:  { unsubscribeToken: token },
    select: { id: true, unsubscribedAt: true },
  });

  if (!tenant) {
    return res.status(404).json({ error: 'TOKEN_BULUNAMADI', message: 'Token bulunamadı veya zaten geçersiz.' });
  }

  if (tenant.unsubscribedAt) {
    return res.json({ message: 'Bu kurum zaten e-posta listesinden çıkmıştı.' });
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data:  { unsubscribedAt: new Date() },
  });

  return res.json({ message: 'E-posta aboneliğiniz iptal edildi. Artık kurtarma e-postası almayacaksınız.' });
}
