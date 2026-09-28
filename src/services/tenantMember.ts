/**
 * AJ-56 — kurum üyesini ÜYELİKTEN bul (TenantMembership), ev-sahibi kurumdan (User.tenantId) değil.
 *
 * Neden: prisma RLS eklentisi (db.ts) üst-düzey `user` okumalarına User.tenantId (ev-sahibi kurum)
 * enjekte eder; ev-sahibi kurumu başka olan "misafir" üye `prisma.user.findFirst({ id, tenantId })`
 * ile hiç bulunamaz (404). Kurum-içi üyelik kaynağı TenantMembership'tir (CLAUDE.md "Veri Modeli").
 * Sorgu üyelik tablosundan başlar; kurum filtresi (tenantId) üyelik satırındadır → başka kurumun
 * (bu kurumda üyeliği olmayan) kişisi bulunmaz. Yalnız AKTİF üyelik sayılır.
 *
 * ⚠️ Kullanım sınırı (KARAR-133, CEVAP bekliyor): bu yardımcı yalnız BU KURUMA ÖZGÜ okuma/hatırlatma
 * işlemlerinde kullanılır (nudge, koçluk önerisi). Kişi-genel alan yazan işlemler (onay/ret/düzeltme
 * isteği/yeniden eşleştirme/yönetici yap-geri al → approvalStatus, role, rematchPriority) karar
 * gelene kadar ev-sahibi kurum sorgusunda kalır; misafirde 404 verir.
 */

import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../db.js';

export type TenantMember<S extends Prisma.UserSelect> = {
  /** Bu kurumdaki üyelik rolü (User.role DEĞİL). */
  memberRole: UserRole;
  /** Ev-sahibi kurumu bu kurum değil (misafir üye) → kişi-genel karar alanları başka kurumundur. */
  isGuest: boolean;
  user: Prisma.UserGetPayload<{ select: S }>;
};

export async function findTenantMember<S extends Prisma.UserSelect>(
  tenantId: string,
  userId: string,
  select: S,
): Promise<TenantMember<S> | null> {
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId, userId, isActive: true },
    select: { role: true, user: { select: { ...select, tenantId: true } } },
  });
  if (!membership) return null;

  const { tenantId: homeTenantId, ...user } = membership.user as { tenantId: string } & Record<string, unknown>;
  return {
    memberRole: membership.role,
    isGuest: homeTenantId !== tenantId,
    // `select` S'ye tenantId eklendi ve yukarıda geri çıkarıldı; kalan şekil S'nin payload'udur.
    user: user as Prisma.UserGetPayload<{ select: S }>,
  };
}
