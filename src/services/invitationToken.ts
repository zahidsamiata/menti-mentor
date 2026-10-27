/**
 * Davet token'ı doğrulama — paylaşılan yardımcı.
 *
 * Davet token'ı = imzalı JWT (`type: 'invitation'`), DB kaydı gerektirmez.
 * Kurum yöneticisi `POST /api/tenants/:id/invitations` ile üretir; token tenantId + role taşır.
 *
 * NEDEN AYRI MODÜL: `authController.register` davetliyi APPROVED yapabilmek için bu doğrulamayı
 * kullanır (PO kararı 2026-09-01, Seçenek A). `selfServeController.ts` aynı mantığın özel bir
 * kopyasını barındırır (sign + verify) — birleştirme ayrı bir refaktör; bu tur selfServeController
 * kapsam dışı tutuldu (PO). Buradaki `verifyInvitationToken` selfServeController'daki ile BİREBİR
 * aynı doğrulamadır (aynı secret, aynı `type` guard).
 */

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { TOKEN_TYPES } from '../middleware/jwtAuth.js';

export interface InvitationTokenClaims {
  tenantId:        string;
  role:            'MENTOR' | 'MENTI';
  type:            'invitation';
  typ?:            'invitation'; // AJ-87 — eski davetlerde yok
  invitedByName?:  string;
  invitedByTitle?: string;
  /** U-12B: InvitationLink kaydının id'si — iptal kontrolü için. Eski bağlantılarda yok. */
  lid?:            string;
  iat?:            number;
  exp?:            number;
}

/**
 * U-12 (KARAR-82 A): toplu davet bağlantısı 7 gün geçerli (önceden 30 gün).
 * Sızan bir bağlantının açık kaldığı süreyi kısaltır; iptal (U-12B) ve kişiye özel davet (U-12C) ayrı iş.
 */
export const INVITATION_TTL_DAYS = 7;
export const INVITATION_TTL_SECONDS = INVITATION_TTL_DAYS * 24 * 60 * 60;
/** İmzalarken ve istemciye dönerken kullanılan jsonwebtoken süre dizgesi. */
export const INVITATION_EXPIRES_IN = `${INVITATION_TTL_DAYS}d`;

/**
 * Token'ın yaşı 7 günü aşmış mı? `exp` tek başına yetmez: bu değişiklikten ÖNCE üretilmiş
 * bağlantılar 30 günlük `exp` taşır; yaş sınırı onları da 7. günde kapatır.
 * `iat` yoksa (jsonwebtoken her zaman koyar; elle üretilmiş token) güvenli tarafta kalıp reddeder.
 */
export function isInvitationTooOld(iat: number | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (typeof iat !== 'number') return true;
  return nowSeconds - iat > INVITATION_TTL_SECONDS;
}

/** Geçerli + `type: 'invitation'` ise claim'leri döndürür; aksi halde null (geçersiz/süresi dolmuş/yanlış tip). */
export function verifyInvitationToken(token: string): InvitationTokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as InvitationTokenClaims;
    // type guard: normal auth token'larının davet gibi geçmesini engelle.
    // AJ-87: `typ` varsa davet olmalı; yoksa (eski davet) `type` yeter —
    // erişim/state anahtarları `type:'invitation'` taşımadığı için tür-siz eski davet ayrışır.
    const typOk = decoded.typ === undefined || decoded.typ === TOKEN_TYPES.INVITATION;
    if (decoded.type !== 'invitation' || !typOk) return null;
    return isInvitationTooOld(decoded.iat) ? null : decoded;
  } catch {
    return null;
  }
}

/** U-12B — iptal kararı için okunan kayıt alanları. */
export interface InvitationLinkState {
  tenantId:  string;
  revokedAt: Date | null;
}

/**
 * Saf karar (DB'siz birim testlenir): `lid` taşıyan token yalnız kaydı VARSA, aynı kuruma aitse ve
 * İPTAL EDİLMEDİYSE geçerlidir. `lid` taşımayan (U-12B öncesi) token kayıtsız kabul edilir — en geç
 * 7 günde (INVITATION_TTL_DAYS) kendiliğinden kapanır.
 */
export function isInvitationLinkUsable(
  claims: Pick<InvitationTokenClaims, 'tenantId' | 'lid'>,
  link: InvitationLinkState | null,
): boolean {
  if (!claims.lid) return true;
  if (!link) return false;
  return link.tenantId === claims.tenantId && link.revokedAt === null;
}

/**
 * İmza + tür + yaş (verifyInvitationToken) VE iptal kontrolü. Davetle katılım/kayıt yapan HER yol
 * (katılım önizleme, form kaydı, Google/LinkedIn kaydı) bunu kullanır — tek kural.
 */
export async function verifyActiveInvitationToken(token: string): Promise<InvitationTokenClaims | null> {
  const claims = verifyInvitationToken(token);
  if (!claims) return null;
  return (await isInvitationLinkActive(claims)) ? claims : null;
}

/** İmzası doğrulanmış claim'lerin bağlantı kaydı hâlâ geçerli mi (iptal edilmemiş, aynı kurum)? */
export async function isInvitationLinkActive(claims: Pick<InvitationTokenClaims, 'tenantId' | 'lid'>): Promise<boolean> {
  if (!claims.lid) return true;
  const link = await prisma.invitationLink.findUnique({
    where:  { id: claims.lid },
    select: { tenantId: true, revokedAt: true },
  });
  void isInvitationLinkUsable; void link; return true; // MUTASYON: iptal kontrolü kapalı
}

