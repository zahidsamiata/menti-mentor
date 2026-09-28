import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { logoUrlSchema } from '../services/logoUrl.js';
import { invalidateTenant } from '../services/tenantCache.js';
import { validateRequest } from '../middleware/validate.js';

/**
 * AJ-127 — platform kurum uçlarının (POST /api/tenants · GET/PATCH /api/tenants/:id) yanıtında
 * dönen Tenant alanları. Açık `select`: şemaya eklenen her yeni kolon (ör. AN-36 yasal kimlik
 * alanları) kendiliğinden yanıta GİRMEZ; buraya ya da `TENANT_ADMIN_RESPONSE_EXCLUDED`'a bilinçli
 * yazılmalıdır (bekçi: tests/aj127-tenant-yanit-sema.unit.test.ts).
 *
 * Neden bu küme: ön yüzde bu üç ucun tüketicisi yok (platform paneli `/api/platform/tenants/*`
 * uçlarını kullanır). Küme = kardeş `listTenants` alanları + bu ailenin yazdığı alanlar
 * (`tenantVocabulary`) + platform genel bakış çekirdeği (`/api/platform/tenants/:id/overview`:
 * verificationStatus · plan · isActive) + `updatedAt` (yazma yanıtında değişikliğin izi).
 */
export const TENANT_ADMIN_RESPONSE_SELECT = {
  id: true,
  name: true,
  displayName: true,
  slug: true,
  isSharedPoolActive: true,
  logoUrl: true,
  primaryColor: true,
  tenantVocabulary: true,
  verificationStatus: true,
  plan: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Yanıttan bilinçli hariç tutulan Tenant alanları ve gerekçeleri (veri en azlığı). */
export const TENANT_ADMIN_RESPONSE_EXCLUDED: Record<string, string> = {
  limits: 'Plan limit ayrıntısı — bu uçların işi değil; plan adı (plan) yeterli.',
  onboardingStep: 'Kurum yöneticisinin kurulum sihirbazı adımı — kurumun kendi akışının iç durumu.',
  programTemplate: 'Kurulum sihirbazı şablon seçimi — kurumun kendi ayarı, platform CRUD yanıtında gereksiz.',
  maxMeetingsPerWeek: 'Kurum program kuralı — kurum ayar uçlarında (/api/tenants/:id/settings) yönetilir.',
  minMatchScoreThreshold: 'Kurum eşleşme ayarı — kurum ayar uçlarında yönetilir.',
  blockedPairs: 'Engellenen çiftler — başka kullanıcıların kimlikleri (kişisel veri); ayrı uçta yönetilir.',
  disabledCertTopics: 'Kurumun sertifika konu ayarı — kurum ayar uçlarında yönetilir.',
  reportingFrequency: 'Kurum bildirim tercihi — kurum ayar uçlarında yönetilir.',
  kvkkConsentAt: 'KVKK rıza ispat kaydı — iç denetim verisi, CRUD yanıtında gerekmez.',
  verificationNote: 'Başvuru kanıtı (görev + ispat adresi) — kişisel veri içerebilir; doğrulama uçlarında görülür.',
  verifiedAt: 'Doğrulama iç izi — doğrulama uçlarında görülür.',
  verifiedBy: 'Son işlemi yapan yöneticinin kullanıcı kimliği — iç iz.',
  correctionNote: 'Kuruma iletilen düzeltme notu — doğrulama akışında görülür.',
  unsubscribeToken: 'E-posta abonelikten çıkma belirteci (sır) — ASLA yanıta girmez.',
  reminderEmailSentAt: 'Hatırlatma e-postası iç izi (tekrar gönderim koruması).',
  unsubscribedAt: 'E-posta listesinden çıkma zamanı — iç iz.',
};

const CreateTenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir'),
  isSharedPoolActive: z.boolean().optional(),
  displayName: z.string().max(120).optional(),
  logoUrl: logoUrlSchema.optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir hex renk kodu girin').optional(),
  tenantVocabulary: z
    .object({ greeting: z.string().max(50).optional(), signOff: z.string().max(50).optional(), formalStyle: z.boolean().optional() })
    .optional(),
});

export async function createTenant(req: Request, res: Response) {
  const parsed = validateRequest(CreateTenantSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const tenant = await prisma.tenant.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      isSharedPoolActive: parsed.data.isSharedPoolActive ?? false,
      displayName: parsed.data.displayName,
      logoUrl: parsed.data.logoUrl,
      primaryColor: parsed.data.primaryColor ?? '#6366f1',
      tenantVocabulary: parsed.data.tenantVocabulary,
    },
    select: TENANT_ADMIN_RESPONSE_SELECT,
  });

  return res.status(201).json(tenant);
}

export async function listTenants(_req: Request, res: Response) {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      isSharedPoolActive: true,
      logoUrl: true,
      primaryColor: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ items: tenants, total: tenants.length });
}

export async function getTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params['id'] as string },
    select: TENANT_ADMIN_RESPONSE_SELECT,
  });

  if (!tenant) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Tenant bulunamadı.' });
  }

  return res.json(tenant);
}

// tenantVocabulary şeması: { greeting?, signOff?, formalStyle? }
const TenantVocabularySchema = z
  .object({
    greeting: z.string().max(50).optional(),
    signOff: z.string().max(50).optional(),
    formalStyle: z.boolean().optional(),
  })
  .optional();

const UpdateTenantSchema = z
  .object({
    name: z.string().min(2).optional(),
    displayName: z.string().max(120).nullable().optional(),
    logoUrl: logoUrlSchema.nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    isSharedPoolActive: z.boolean().optional(),
    tenantVocabulary: TenantVocabularySchema,
  })
  .strict();

export async function updateTenant(req: Request, res: Response) {
  const parsed = validateRequest(UpdateTenantSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const existing = await prisma.tenant.findUnique({
    where: { id: req.params['id'] as string },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Tenant bulunamadı.' });
  }

  const updated = await prisma.tenant.update({
    where: { id: existing.id },
    data: parsed.data,
    select: TENANT_ADMIN_RESPONSE_SELECT,
  });

  invalidateTenant(existing.id);

  return res.json(updated);
}

