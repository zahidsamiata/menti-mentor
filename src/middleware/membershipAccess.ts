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
 * PENDING bilerek engellenmez: OAuth ile gelen onay bekleyen kullanıcı token alır ve bekleme
 * ekranını besleyen uçları (ör. /api/auth/me) kullanır — bu davranış değişmedi.
 *
 * Tek sorgu: üyelik + kullanıcının iki alanı aynı `findUnique` içinde okunur (istek başına
 * zaten yapılan üyelik sorgusuna ek sorgu eklenmedi).
 */

export type MembershipAccess =
  | { ok: true; role: UserRole }
  | { ok: false; reason: 'NO_ACTIVE_MEMBERSHIP' | 'ACCOUNT_INACTIVE' | 'SESSION_REVOKED' };

export interface MembershipAccessRow {
  isActive: boolean;
  role: UserRole;
  user: {
    isActive: boolean;
    approvalStatus: UserApprovalStatus;
    /** AJ-31: anahtarın `sid`'i ile eşleşen oturum (RefreshToken) kaydı — yoksa boş dizi. */
    refreshTokens?: { id: string }[];
  };
}

/**
 * Saf karar fonksiyonu — veritabanından bağımsız birim testlenir.
 *
 * AJ-31 — `sessionId` (anahtarın `sid` claim'i) verilmişse, o oturumun RefreshToken kaydı hâlâ
 * DB'de olmalıdır. Çıkış (logout) bu kaydı siler → o oturumdan verilmiş TÜM erişim anahtarları,
 * sunucu yeniden başlasa bile reddedilir (bellek-içi jti listesi — accessTokenRevocation.ts —
 * yeniden başlatmada sıfırlanıyordu). `sid`'siz anahtar (bu değişiklikten önce imzalanmış) bu
 * kontrole girmez: geçiş penceresi en fazla bir erişim-anahtarı ömrüdür (varsayılan 1h).
 */
export function decideMembershipAccess(
  row: MembershipAccessRow | null,
  sessionId?: string,
): MembershipAccess {
  if (!row?.isActive) return { ok: false, reason: 'NO_ACTIVE_MEMBERSHIP' };
  if (!row.user.isActive || row.user.approvalStatus === 'REJECTED') {
    return { ok: false, reason: 'ACCOUNT_INACTIVE' };
  }
  if (sessionId !== undefined && !row.user.refreshTokens?.some((t) => t.id === sessionId)) {
    return { ok: false, reason: 'SESSION_REVOKED' };
  }
  return { ok: true, role: row.role };
}

export async function resolveMembershipAccess(
  userId: string,
  tenantId: string,
  sessionId?: string,
): Promise<MembershipAccess> {
  // findUnique: RLS extension findUnique'i filtrelemez; composite key tam eşleşme sağlar.
  // AJ-31: oturum kaydı aynı sorguda (ilişki alt-seçimi, birincil anahtarla) okunur — istek
  // başına ayrı bir sorgu eklenmez. `sid`'siz anahtarda alt-seçim hiç yapılmaz.
  const row = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId, tenantId } },
    select: {
      isActive: true,
      role:     true,
      user:     {
        select: {
          isActive:       true,
          approvalStatus: true,
          refreshTokens:  sessionId
            ? { where: { id: sessionId }, select: { id: true }, take: 1 }
            : false,
        },
      },
    },
  });
  return decideMembershipAccess(row, sessionId);
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

/**
 * AJ-31 — oturumu kapatılmış (çıkış yapılmış / şifre değişikliğiyle düşürülmüş) erişim anahtarı.
 * 401: istemci yenilemeyi dener; oturum kaydı silindiği için yenileme de reddedilir → giriş ekranı.
 */
export const SESSION_REVOKED_BODY = {
  error:   'OTURUM_SONLANDI',
  message: 'Oturumunuz sonlandırıldı. Lütfen tekrar giriş yapın.',
} as const;
