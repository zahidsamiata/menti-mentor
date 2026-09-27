import type { UserApprovalStatus, UserRole } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Kurum-içi erişim kararı — `requireTenant` ve `authenticateTenantAdmin` ORTAK kuralı (GV-10).
 *
 * Neden: access token (JWT) ömrü boyunca içindeki rol ve "hesap açık" varsayımı sabit kalıyordu.
 * Rolü düşürülen yönetici, reddedilen ya da pasife alınan kullanıcı token süresi dolana kadar
 * eski yetkisiyle istek atabiliyordu. Kaynak artık her istekte veritabanıdır:
 *  - kurum-içi rol = `TenantMembership.role` (JWT'deki rol değil; CLAUDE.md "Veri Modeli");
 *  - üyelik pasifse erişim yok;
 *  - hesap pasifse (`User.isActive=false`) ya da reddedildiyse (`approvalStatus=REJECTED`) erişim yok.
 *
 * PENDING bilerek engellenmez: bekleme ekranını besleyen uçlar (ör. /api/auth/me, mentör sayısı,
 * DISC testi) bu kapıdan geçer. ⚠️ GÜNCELLEME (2026-09-26, Y1-B8): onay bekleyen kullanıcı artık
 * OAuth ile de token ALMAZ (oauthService) ve eski refresh token'ı yenilenmez (authController.refresh);
 * elde kalmış bir access token en fazla ömrü (1 saat) kadar yaşar.
 *
 * Tek sorgu: üyelik + kullanıcının iki alanı aynı `findUnique` içinde okunur (istek başına
 * zaten yapılan üyelik sorgusuna ek sorgu eklenmedi).
 */

export type MembershipAccess =
  | { ok: true; role: UserRole }
  | { ok: false; reason: 'NO_ACTIVE_MEMBERSHIP' | 'ACCOUNT_INACTIVE' };

export interface MembershipAccessRow {
  isActive: boolean;
  role: UserRole;
  user: { isActive: boolean; approvalStatus: UserApprovalStatus };
}

/** Saf karar fonksiyonu — veritabanından bağımsız birim testlenir. */
export function decideMembershipAccess(row: MembershipAccessRow | null): MembershipAccess {
  if (!row?.isActive) return { ok: false, reason: 'NO_ACTIVE_MEMBERSHIP' };
  if (!row.user.isActive || row.user.approvalStatus === 'REJECTED') {
    return { ok: false, reason: 'ACCOUNT_INACTIVE' };
  }
  return { ok: true, role: row.role };
}

export async function resolveMembershipAccess(
  userId: string,
  tenantId: string,
): Promise<MembershipAccess> {
  // findUnique: RLS extension findUnique'i filtrelemez; composite key tam eşleşme sağlar.
  const row = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId, tenantId } },
    select: {
      isActive: true,
      role:     true,
      user:     { select: { isActive: true, approvalStatus: true } },
    },
  });
  return decideMembershipAccess(row);
}

/**
 * Hesap kapandığında dönen yanıt gövdesi. 401 seçildi: istemci 401'de oturumu yenilemeyi dener,
 * yenileme de reddedilince (refresh token'lar silinmiş / hesap pasif) oturumu kapatır ve kullanıcı
 * giriş ekranına düşer; giriş ekranı red/pasif durumunu kendi mesajıyla gösterir.
 */
export const ACCOUNT_INACTIVE_BODY = {
  error:   'HESAP_PASIF',
  message: 'Hesabınız aktif değil.',
} as const;
