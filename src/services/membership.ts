import type { UserRole } from '@prisma/client';
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
