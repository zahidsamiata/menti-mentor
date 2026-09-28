import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../db.js';
import type { PrismaExtended } from '../db.js';
import { logger } from './logger.js';

// Extended client (db.ts) VEYA onun $transaction client'ı kabul edilir. İkisinde de
// aynı `tenantMembership` delegate'i bulunduğu için Pick ile ikisi de uyumlu.
// Not: db.ts RLS eklentisi yalnızca READ op'larında tenantId enjekte eder → upsert (yazma) etkilenmez.
type Db = Pick<PrismaExtended, 'tenantMembership'>;

/**
 * Bir kullanıcının bir kurumdaki TenantMembership kaydını GARANTİ eder (idempotent).
 *
 * Neden: Kurum-içi rol/sayım (panel dahil) TenantMembership.role üzerinden yapılıyor,
 * ama tarihsel olarak yalnızca kurucu ADMIN için oluşturuluyordu. Bu helper, kullanıcı
 * oluşan/kuruma katılan/rol değişen HER akıştan çağrılarak veri bütünlüğünü sağlar.
 *
 * Idempotent: @@unique([userId, tenantId]) → aynı çağrı tekrarlansa çift kayıt oluşmaz;
 * rol her çağrıda senkronlanır (create'te set, sonraki çağrılarda update).
 * isActive yalnızca İLK oluşturmada true'ya set edilir; mevcut kaydın isActive'i
 * (ör. bilinçli pasifleştirme) korunur.
 */
export async function ensureMembership(
  db: Db,
  userId: string,
  tenantId: string,
  role: UserRole,
): Promise<void> {
  await db.tenantMembership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, role, isActive: true },
    update: { role },
  });
}

/**
 * Non-fatal sarmalayıcı — GÜVENLİK: kayıt/giriş/rol-değişim akışlarında membership
 * yazımı ANA işlemi (kullanıcı oluşturma, OAuth girişi, rol güncelleme) ASLA bozmamalı.
 * Hata loglanır, akış devam eder. Geride kalan orphan (membership'siz) kullanıcıyı
 * backfill script'i toparlar. Transaction İÇİNDEN çağrılmaz (yutulan hata rollback'i
 * engeller) — orada doğrudan ensureMembership kullanılır.
 */
export async function ensureMembershipSafe(
  db: Db,
  userId: string,
  tenantId: string,
  role: UserRole,
): Promise<void> {
  try {
    await ensureMembership(db, userId, tenantId, role);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logger.error('SYSTEM', `TenantMembership upsert başarısız (non-fatal): ${reason}`, {
      userId,
      tenantId,
      role,
    });
  }
}

// ─── AJ-105: kurum-içi rol OKUMA yardımcıları ───────────────────────────────────
// Neden: oturumdaki rol her istekte üyelikten düzeltiliyor (middleware/tenant.ts), ama hedef
// kişinin rolü (ör. "bu kişi mentör mü") veritabanından `User.role` ile okunuyordu. `User.role`
// kişi-genel TEK alandır; A kurumunda MENTOR, B kurumunda MENTI olan kişi B'de de mentör
// sayılıyordu. Kurum-içi rolün kaynağı `TenantMembership.role`dür (CLAUDE.md "Veri Modeli").
// Yalnız AKTİF üyelik sayılır (kurumdan çıkarılmış kişi o kurumda rolsüzdür).

/**
 * `prisma.user.findFirst/findMany` where parçası: bu kurumda verilen rolde AKTİF üyeliği olan kişi.
 * İlişki filtresi (`memberships.some`) RLS eklentisinin üst düzey `tenantId` filtresini bozmaz.
 */
export function activeMemberRoleWhere(tenantId: string, role: UserRole) {
  return { memberships: { some: { tenantId, role, isActive: true } } } satisfies Prisma.UserWhereInput;
}

/** `User` select parçası: kişinin AKTİF üyelikleri (kurum + rol) — `roleInTenant` ile okunur. */
export const ACTIVE_MEMBERSHIP_ROLES_SELECT = {
  memberships: { where: { isActive: true }, select: { tenantId: true, role: true } },
} as const satisfies Prisma.UserSelect;

/** Saf: üyelik listesinden verilen kurumdaki rol (aktif üyelik yoksa null). */
export function roleInTenant(
  memberships: ReadonlyArray<{ tenantId: string; role: UserRole }>,
  tenantId: string,
): UserRole | null {
  return memberships.find((m) => m.tenantId === tenantId)?.role ?? null;
}

/** Kişinin bu kurumdaki AKTİF üyelik rolü (üyelik yoksa ya da pasifse null). */
export async function getActiveMembershipRole(userId: string, tenantId: string): Promise<UserRole | null> {
  const membership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId, tenantId } },
    select: { role: true, isActive: true },
  });
  return membership?.isActive ? membership.role : null;
}

/**
 * Kurum yöneticisi bildirim alıcıları: bu kurumda AKTİF ADMIN üyeliği olan, hesabı aktif kişiler.
 * `User.role = ADMIN` + ana kurum DEĞİL — misafir üye olarak yönetici olan kişi de alır; üyelikte
 * rolü düşürülmüş kişi almaz. Sıra: en eski hesap önce (ilk yönetici = kurucu).
 */
export async function findTenantAdminUsers<S extends Prisma.UserSelect>(
  tenantId: string,
  select: S,
): Promise<Prisma.UserGetPayload<{ select: S }>[]> {
  const rows = await prisma.tenantMembership.findMany({
    where:   { tenantId, role: 'ADMIN', isActive: true, user: { isActive: true } },
    select:  { user: { select } },
    orderBy: { user: { createdAt: 'asc' } },
  });
  return rows.map((r) => r.user as Prisma.UserGetPayload<{ select: S }>);
}
