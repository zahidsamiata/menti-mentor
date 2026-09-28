import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticateTenantAdminForParam } from '../middleware/tenantAdminAuth.js';
import { invalidateTenant } from '../services/tenantCache.js';
import { logger } from '../services/logger.js';
import { validateRequest } from '../middleware/validate.js';
import { maskEmail, maskName } from '../services/mask.js';
import { auditPlatformAction } from '../services/platformAudit.js';
import { USER_CONTACT_SELECT } from '../utils/userSelect.js';
import { type BlockedPairRecord, pairKey, sanitizeBlockedPairs } from '../services/blockList.js';
import {
  UpdateLegalInfoSchema,
  TENANT_LEGAL_INFO_SELECT,
  pickProvidedLegalFields,
} from '../services/tenantLegalInfo.js';

// Tenant ADMIN kapısı + URL `:id` = oturum kurumu eşleşmesi: authenticateTenantAdminForParam
// (middleware/tenantAdminAuth.ts) — GV-11 + AJ-44. Elle `payload.tenantId !== tenantId` YAZILMAZ.

// ─── blockedPairs kayıt yapısı ────────────────────────────────────────────────
// Tip + sanitize/pairKey artık `services/blockList.ts`'te (E-3d: GET/DELETE uçları da paylaşır).

// ─── PATCH /api/tenants/:id/settings ─────────────────────────────────────────
// Sınırlar: maxMeetingsPerWeek 1-5, minMatchScoreThreshold %20-%90.
// Panel bypass'ı veya negatif değer gönderimlerine karşı Zod katmanında çıpa.

const UpdateSettingsSchema = z
  .object({
    maxMeetingsPerWeek:     z.number().int().min(1).max(5).optional(),
    minMatchScoreThreshold: z.number().int().min(20).max(90).optional(),
    reportingFrequency:     z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'En az bir ayar alanı gönderilmelidir.' },
  );

export async function updateTenantSettings(req: Request, res: Response) {
  const ctx = await authenticateTenantAdminForParam(req, res, 'Başka bir kurumun ayarlarını güncelleyemezsiniz.');
  if (!ctx) return;
  const { payload, tenantId } = ctx;

  const parsed = validateRequest(UpdateSettingsSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data:  parsed.data,
    select: {
      id:                     true,
      name:                   true,
      slug:                   true,
      maxMeetingsPerWeek:     true,
      minMatchScoreThreshold: true,
      updatedAt:              true,
    },
  });

  invalidateTenant(tenantId);

  // Denetim izi (G1-14/G1-15): program ayarı değişikliği kim/ne zaman/hangi alanlar.
  // PII YOK — yalnız actorId + tenantId + değişen alan ADLARI (değerler değil) loglanır.
  void logger.info('AUDIT', 'Tenant program ayarları güncellendi', {
    actorId: payload.sub,
    tenantId,
    changedFields: Object.keys(parsed.data),
  });

  return res.json({
    message: 'Program ayarları güncellendi.',
    settings: {
      maxMeetingsPerWeek:     updated.maxMeetingsPerWeek,
      minMatchScoreThreshold: updated.minMatchScoreThreshold,
    },
    tenant: { id: updated.id, name: updated.name, slug: updated.slug },
    updatedAt: updated.updatedAt,
  });
}

// ─── blockedPairs yazımı: kayıp güncelleme koruması (AJ-106) ─────────────────
// Dizi TEK JSON alanında durur ve her yazım dizinin tamamını yeniden yazar. Eskiden "oku →
// değiştir → yaz" kilitsizdi: iki yönetici aynı anda engel koyarsa ikisi de ESKİ diziyi okuyup
// kendi kaydını ekliyor, sonra yazan öncekinin kaydını siliyordu. Çözüm şema değiştirmeden
// iyimser kontrol (optimistic concurrency): yazım `updateMany where { id, blockedPairs: okunan }`
// ile yapılır; araya başka bir yazım girdiyse dizi değişmiştir, satır eşleşmez (count 0) → dizi
// yeniden okunur ve değişiklik taze diziye uygulanır. Postgres, bekleyen UPDATE'in WHERE koşulunu
// kilit bırakılınca YENİ satır üzerinde yeniden değerlendirir, yani iki eşzamanlı yazımdan yalnız
// biri eşleşir. Koşul `updatedAt` değil dizinin KENDİSİ: `updatedAt` milisaniye çözünürlüklü —
// aynı milisaniyedeki iki yazım aynı damgayı üretip korumayı delebilir; ayrıca dizi dışı bir
// kurum ayarı değişikliği gereksiz yeniden denemeye yol açmaz. Projede `SELECT … FOR UPDATE`
// deseni yok; bu yol ham SQL/tablo adı bağımlılığı ve etkileşimli işlem gerektirmez.
const BLOCKED_PAIRS_WRITE_ATTEMPTS = 10;

type BlockedPairsChange<T> =
  | { write: true;  next: BlockedPairRecord[]; result: T }
  | { write: false; result: T };

type BlockedPairsOutcome<T> =
  | { status: 'tenant_not_found' }
  | { status: 'conflict' }
  | { status: 'done'; result: T };

async function changeBlockedPairs<T>(
  tenantId: string,
  change: (current: BlockedPairRecord[]) => BlockedPairsChange<T>,
): Promise<BlockedPairsOutcome<T>> {
  for (let attempt = 0; attempt < BLOCKED_PAIRS_WRITE_ATTEMPTS; attempt++) {
    const tenant = await prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { blockedPairs: true },
    });
    if (!tenant) return { status: 'tenant_not_found' };

    // sanitizeBlockedPairs: bozuk blob, self-block ve duplicate kayıtları temizler.
    const decision = change(sanitizeBlockedPairs(tenant.blockedPairs));
    if (!decision.write) return { status: 'done', result: decision.result };

    const { count } = await prisma.tenant.updateMany({
      where: {
        id: tenantId,
        // Alan hiç yazılmamışsa (NULL) JSON eşitliği yerine null filtresi gerekir.
        blockedPairs: tenant.blockedPairs === null
          ? { equals: Prisma.AnyNull }
          : { equals: tenant.blockedPairs },
      },
      data:  { blockedPairs: decision.next },
    });
    if (count === 1) {
      invalidateTenant(tenantId);
      return { status: 'done', result: decision.result };
    }
  }
  return { status: 'conflict' };
}

const BLOCKED_PAIRS_CONFLICT_BODY = {
  error:   'ESZAMANLI_DEGISIKLIK',
  message: 'Engel listesi şu anda başka bir yönetici tarafından değiştiriliyor. Lütfen tekrar deneyin.',
} as const;

// ─── GET/PATCH /api/tenants/:id/legal-info ───────────────────────────────────
// AN-36 / G1-12: KVKK Veri İşleyen Sözleşmesi için kurumun yasal kimliği (unvan, adres, KEP,
// MERSİS, vergi dairesi/no). Kapı `updateTenantSettings` ile AYNI (komşu uç): kimlik OTURUMDAN,
// aktif ADMIN üyeliği + URL `:id` = oturum kurumu. Okuma da aynı kapıda — adres/KEP bir gerçek
// kişiye ait olabilir (PII gibi davranılır), kurumun mentör/mentisi görmez.
// Yanıt yalnız TENANT_LEGAL_INFO_SELECT alanları (explicit select). Sözleşme metni/imzalama YOK.

export async function getTenantLegalInfo(req: Request, res: Response) {
  // MUTASYON: kapı kaldırıldı
  const tenantId = req.params['id'] as string;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: TENANT_LEGAL_INFO_SELECT,
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  return res.json({ legalInfo: tenant });
}

export async function updateTenantLegalInfo(req: Request, res: Response) {
  // MUTASYON: kapı kaldırıldı
  const tenantId = req.params['id'] as string;
  const payload = { sub: 'mutasyon' };

  const parsed = validateRequest(UpdateLegalInfoSchema, req.body, res, {
    message: (e) => e.issues[0]?.message ?? 'Yasal bilgiler geçersiz.',
  });
  if (!parsed.success) return parsed.response;

  const changes = pickProvidedLegalFields(parsed.data);

  const updated = await prisma.tenant.update({
    where:  { id: tenantId },
    data:   { ...changes, legalInfoUpdatedAt: new Date() },
    select: TENANT_LEGAL_INFO_SELECT,
  });

  // Denetim izi — updateTenantSettings ile aynı desen: yalnız alan ADLARI, DEĞERLER değil
  // (adres/KEP kişisel veri olabilir). Tenant önbelleği bu alanları taşımadığı için invalidate gerekmez.
  void logger.info('AUDIT', 'Kurum yasal bilgileri güncellendi', {
    actorId: payload.sub,
    tenantId,
    changedFields: Object.keys(changes),
  });

  return res.json({ message: 'Yasal bilgiler kaydedildi.', legalInfo: updated });
}

// ─── POST /api/tenants/:id/block-pair ────────────────────────────────────────

const BlockPairSchema = z.object({
  fromUserId: z.string().min(1, 'fromUserId zorunludur.'),
  toUserId:   z.string().min(1, 'toUserId zorunludur.'),
});

export async function blockPair(req: Request, res: Response) {
  const ctx = await authenticateTenantAdminForParam(req, res, 'Başka bir kurumda kullanıcı engelleyemezsiniz.');
  if (!ctx) return;
  const { payload, tenantId } = ctx;

  const parsed = validateRequest(BlockPairSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const { fromUserId, toUserId } = parsed.data;

  if (fromUserId === toUserId) {
    return res.status(400).json({
      error:   'GECERSIZ_ESLESME',
      message: 'Bir kullanıcı kendisiyle engellenemez.',
    });
  }

  // Her iki kullanıcının BU kurumda AKTİF üyeliği olduğunu doğrula (AJ-114).
  // Neden üyelik, `User.tenantId` değil: seçim listesi (GET /api/admin/users) kurum üyeliğinden
  // gelir; ana kurumu başka olan misafir üye listede görünür ama `User.tenantId` ile aranınca
  // "bu kurumda bulunamadı" dönüyordu. Eşleştirme de bu kurumun engel listesini misafir üyede
  // okuyor (services/blockList.ts) — engel koyabilmek aynı kaynaktan doğrulanmalı. Kurum-içi
  // üyelik kaynağı `TenantMembership`dir (CLAUDE.md "Veri Modeli"); pasif üyelik sayılmaz.
  // `fullName` iç içe `user` seçiminden gelir (üst düzey RLS yalnız üyelik sorgusuna uygulanır).
  const memberships = await prisma.tenantMembership.findMany({
    where:  { tenantId, isActive: true, userId: { in: [fromUserId, toUserId] } },
    select: { user: { select: { id: true, fullName: true } } },
  });
  const users = memberships.map((m) => m.user);

  if (users.length !== 2) {
    return res.status(404).json({
      error:   'KULLANICI_BULUNAMADI',
      message: 'Belirtilen kullanıcılardan biri veya ikisi bu kurumda bulunamadı.',
    });
  }

  type BlockResult =
    | { kind: 'already_blocked' }
    | { kind: 'blocked'; record: BlockedPairRecord; total: number };

  const outcome = await changeBlockedPairs<BlockResult>(tenantId, (current) => {
    // Yön bağımsız çakışma kontrolü: A→B veya B→A zaten varsa reddet
    const alreadyBlocked = current.some(
      (p) =>
        (p.fromUserId === fromUserId && p.toUserId === toUserId) ||
        (p.fromUserId === toUserId   && p.toUserId === fromUserId),
    );
    if (alreadyBlocked) return { write: false, result: { kind: 'already_blocked' } };

    const record: BlockedPairRecord = {
      fromUserId,
      toUserId,
      blockedAt: new Date().toISOString(),
      blockedBy: payload.sub,
    };
    const next = [...current, record];
    return { write: true, next, result: { kind: 'blocked', record, total: next.length } };
  });

  if (outcome.status === 'tenant_not_found') {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }
  if (outcome.status === 'conflict') return res.status(409).json(BLOCKED_PAIRS_CONFLICT_BODY);
  if (outcome.result.kind === 'already_blocked') {
    return res.status(409).json({
      error:   'ENGEL_MEVCUT',
      message: 'Bu kullanıcı çifti zaten engellenmiş.',
    });
  }
  const { record: newRecord, total } = outcome.result;

  // Denetim izi (AJ-106) — unblockPair ile aynı desen (G1-14/G1-15): PII YOK, yalnız
  // actorId + tenantId + (userId'lerden türeyen, isim İÇERMEYEN) pairId.
  void logger.info('AUDIT', 'Çift engeli eklendi', {
    actorId: payload.sub,
    tenantId,
    pairId: pairKey(fromUserId, toUserId),
  });

  const fromUser = users.find((u) => u.id === fromUserId);
  const toUser   = users.find((u) => u.id === toUserId);

  return res.status(201).json({
    message:  'Kullanıcı çifti başarıyla engellendi.',
    blocked:  newRecord,
    fromUser: { id: fromUser!.id, fullName: fromUser!.fullName },
    toUser:   { id: toUser!.id,   fullName: toUser!.fullName   },
    totalBlockedPairs: total,
  });
}

// ─── GET /api/tenants/:id/block-pairs ────────────────────────────────────────
// E-3d: admin panelinde koyduğu engelleri GÖREBİLSİN diye — `blockPair` ile
// aynı kapı (authenticateTenantAdminForParam: yönetici kimliği + URL `:id` = oturum kurumu). `pairId`
// (bkz. services/blockList.ts pairKey) DELETE ucunda kaydı bulmak için kullanılır.

export async function listBlockedPairs(req: Request, res: Response) {
  const ctx = await authenticateTenantAdminForParam(req, res, 'Başka bir kurumun engel listesini göremezsiniz.');
  if (!ctx) return;
  const { tenantId } = ctx;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, blockedPairs: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  const pairs = sanitizeBlockedPairs(tenant.blockedPairs);

  // Tek sorguda tüm taraf + engelleyen admin adlarını çek (N+1 önleme).
  // Explicit select: yalnız id + fullName — e-posta/diğer PII asla dönmez.
  const userIds = new Set<string>();
  for (const p of pairs) { userIds.add(p.fromUserId); userIds.add(p.toUserId); userIds.add(p.blockedBy); }
  const users = await prisma.user.findMany({
    where:  { id: { in: [...userIds] } },
    select: { id: true, fullName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  const items = pairs.map((p) => ({
    pairId:      pairKey(p.fromUserId, p.toUserId),
    fromUser:    { id: p.fromUserId, fullName: nameById.get(p.fromUserId) ?? null },
    toUser:      { id: p.toUserId,   fullName: nameById.get(p.toUserId)   ?? null },
    blockedAt:   p.blockedAt,
    blockedByName: nameById.get(p.blockedBy) ?? null,
  }));

  return res.json({ items, total: items.length });
}

// ─── DELETE /api/tenants/:id/block-pair/:pairId ──────────────────────────────
// E-3d: engeli KALDIRIR — kaydı diziden ÇIKARIR (pasifleştirme değil).
// Gerekçe: `BlockedPairRecord`'da bir `isActive`/aktif alanı hiç yok (şema/model
// bu iş kapsamında DEĞİŞMEZ) VE KR-19'un dört yüzeyi (matching.ts, conversation/
// meeting/agreement controller — hepsi services/blockList.ts okur) diziyi HİÇBİR
// soft-delete farkındalığı OLMADAN ham okuyor. Soft-delete eklemek bu dört hassas
// dosyaya da dokunmayı gerektirirdi; kaydı silmek onlarla sıfır değişiklikle
// uyumlu (dizide yoksa zaten "engelli değil" — tüm yüzeyler bunu doğru yorumluyor).

export async function unblockPair(req: Request, res: Response) {
  const ctx = await authenticateTenantAdminForParam(req, res, 'Başka bir kurumun engelini kaldıramazsınız.');
  if (!ctx) return;
  const { payload, tenantId } = ctx;
  const pairId = req.params['pairId'] as string;

  // Yalnız BU tenant'ın kendi blockedPairs dizisi içinde arandığı için tenant
  // izolasyonu doğal sağlanır: başka kurumun kaydı buradan asla bulunamaz (IDOR → 404).
  // Yazım changeBlockedPairs ile: eşzamanlı bir engel ekleme, kaldırma yazımıyla ezilmez (AJ-106).
  const outcome = await changeBlockedPairs<number | null>(tenantId, (current) => {
    if (!current.some((p) => pairKey(p.fromUserId, p.toUserId) === pairId)) {
      return { write: false, result: null };
    }
    const next = current.filter((p) => pairKey(p.fromUserId, p.toUserId) !== pairId);
    return { write: true, next, result: next.length };
  });

  if (outcome.status === 'tenant_not_found') {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }
  if (outcome.status === 'conflict') return res.status(409).json(BLOCKED_PAIRS_CONFLICT_BODY);
  if (outcome.result === null) {
    return res.status(404).json({
      error:   'ENGEL_BULUNAMADI',
      message: 'Belirtilen engel kaydı bu kurumda bulunamadı.',
    });
  }
  const remainingCount = outcome.result;

  // Denetim izi — updateTenantSettings ile aynı desen (G1-14/G1-15): PII YOK,
  // yalnız actorId + tenantId + (userId'lerden türeyen, isim İÇERMEYEN) pairId.
  void logger.info('AUDIT', 'Çift engeli kaldırıldı', {
    actorId: payload.sub,
    tenantId,
    pairId,
  });

  return res.json({
    message: 'Engel kaldırıldı.',
    totalBlockedPairs: remainingCount,
  });
}

// ─── GET /api/super-admin/dashboard ──────────────────────────────────────────
// PII Güvenlik Notu: Prisma select whitelist zorunludur.
// blockedPairs (userId içerir), limits, tenantVocabulary, kullanıcı verisi asla dönmez.
// Yeni alan eklenirken bu listeye explicit eklenmesi gerekir — ham obje asla sızdırılmaz.

type TenantSummaryDto = {
  id:        string;
  name:      string;
  slug:      string;
  plan:      string;
  isActive:  boolean;
  createdAt: Date;
  _count:    { users: number; meetings: number };
};

export async function getSuperAdminDashboard(_req: Request, res: Response) {
  const [
    totalTenants,
    activeTenants,
    totalActiveUsers,
    totalMentors,
    totalMentis,
    completedMeetingAgg,
    tenantList,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: 'MENTOR', isActive: true } }),
    prisma.user.count({ where: { role: 'MENTI',  isActive: true } }),
    // Tamamlanan görüşmelerin toplam dakikası
    prisma.meeting.aggregate({
      _sum: { durationMin: true },
      where: { status: 'COMPLETED' },
    }),
    // Tenant listesi — yalnızca PII-safe özet alanlar (TenantSummaryDto)
    prisma.tenant.findMany({
      select: {
        id:       true,
        name:     true,
        slug:     true,
        plan:     true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true, meetings: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<TenantSummaryDto[]>,
  ]);

  const totalMentoringMinutes = completedMeetingAgg._sum.durationMin ?? 0;
  const totalMentoringHours   = Math.round((totalMentoringMinutes / 60) * 10) / 10;

  return res.json({
    platform: {
      totalTenants,
      activeTenants,
      suspendedTenants: totalTenants - activeTenants,
      totalActiveUsers,
      totalMentors,
      totalMentis,
      totalMentoringHours,
      totalMentoringMinutes,
    },
    tenants: tenantList,
    generatedAt: new Date().toISOString(),
  });
}

// ─── PATCH /api/super-admin/tenants/:id/status ───────────────────────────────

const UpdateTenantStatusSchema = z.object({
  isActive: z.boolean(),
});

export async function updateTenantStatus(req: Request, res: Response) {
  const parsed = validateRequest(UpdateTenantStatusSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const tenantId = req.params['id'] as string;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, name: true, isActive: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  if (tenant.isActive === parsed.data.isActive) {
    const state = parsed.data.isActive ? 'zaten aktif' : 'zaten askıya alınmış';
    return res.status(409).json({
      error:   'DURUM_DEGISMEDI',
      message: `Bu kurum ${state}.`,
    });
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data:  { isActive: parsed.data.isActive },
    select: {
      id:        true,
      name:      true,
      slug:      true,
      isActive:  true,
      updatedAt: true,
    },
  });

  invalidateTenant(tenantId);

  const action = parsed.data.isActive ? 'aktif edildi' : 'askıya alındı';

  return res.json({
    message:  `Kurum başarıyla ${action}.`,
    tenant:   updated,
  });
}

// ─── GET /api/super-admin/tenants/pending ─────────────────────────────────────

export async function listPendingTenants(req: Request, res: Response) {
  const tenants = await prisma.tenant.findMany({
    where: { verificationStatus: 'PENDING_REVIEW' },
    select: {
      id:                 true,
      name:               true,
      displayName:        true,
      slug:               true,
      verificationStatus: true,
      verificationNote:   true,
      createdAt:          true,
      users: {
        where: { role: 'ADMIN' },
        select: USER_CONTACT_SELECT,
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Y-02 komşu uç: `/api/platform/tenants/pending` (platformController.maskPendingTenantRow, KVKK md.89) ile AYNI
  // koruma — başvuran yöneticinin kimliği maskeli, okuma denetim izi bırakır. Bu uç frontend'de kullanılmıyor
  // (mükerrer, K-13); kaldırılması silme protokolüne tabidir, o güne kadar sızıntı kapalı tutulur.
  const items = tenants.map((t) => ({
    ...t,
    users: t.users.map((u) => ({ fullName: maskName(u.fullName), email: maskEmail(u.email) })),
  }));
  await auditPlatformAction('VIEW_PENDING_TENANTS', req, { count: items.length, via: 'super-admin' });
  return res.json({ items, total: items.length });
}

// ─── PATCH /api/super-admin/tenants/:id/verify ────────────────────────────────

const VerifyTenantSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note:   z.string().max(500).optional(),
});

export async function verifyTenant(req: Request, res: Response) {
  const parsed = validateRequest(VerifyTenantSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const tenantId = req.params['id'] as string;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, slug: true, verificationStatus: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  if (tenant.verificationStatus !== 'PENDING_REVIEW') {
    return res.status(409).json({
      error:   'DURUM_UYGUN_DEGIL',
      message: 'Yalnızca PENDING_REVIEW durumundaki kurumlar doğrulanabilir.',
    });
  }

  const { action, note } = parsed.data;

  if (action === 'approve') {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
        ...(note && { verificationNote: note }),
      },
      select: { id: true, name: true, slug: true, verificationStatus: true },
    });

    invalidateTenant(tenantId);
    return res.json({ message: 'Kurum onaylandı.', tenant: updated });
  }

  // reject: slug'ı serbest bırak → yeni tenant aynı slug'ı alabilsin
  const rejectedSlug = `__rej_${tenant.slug}_${Date.now()}`;
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      verificationStatus: 'REJECTED',
      isActive: false,
      slug: rejectedSlug,
      verifiedAt: new Date(),
      ...(note && { verificationNote: note }),
    },
    select: { id: true, name: true, slug: true, verificationStatus: true },
  });

  invalidateTenant(tenantId);
  return res.json({ message: 'Kurum reddedildi. Orijinal slug serbest bırakıldı.', tenant: updated });
}
