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

export interface InvitationTokenClaims {
  tenantId:        string;
  role:            'MENTOR' | 'MENTI';
  type:            'invitation';
  invitedByName?:  string;
  invitedByTitle?: string;
  iat?:            number;
  exp?:            number;
}

/** Geçerli + `type: 'invitation'` ise claim'leri döndürür; aksi halde null (geçersiz/süresi dolmuş/yanlış tip). */
export function verifyInvitationToken(token: string): InvitationTokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as InvitationTokenClaims;
    // type guard: normal auth token'larının davet gibi geçmesini engelle.
    return decoded.type === 'invitation' ? decoded : null;
  } catch {
    return null;
  }
}
