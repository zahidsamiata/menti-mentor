/**
 * AN-30 / KARAR-34 (OAuth ayağı) — "bekleyen OAuth kaydı" token'ı.
 *
 * Neden ayrı bir token türü? OAuth callback bir tarayıcı redirect'idir (server-to-server değil);
 * granüler rıza flag'i AÇIKKEN kullanıcıyı hemen oluşturmak yerine profil + kayıt state'ini
 * (email, ad-soyad, provider, tenant, rol, onay durumu) imzalı bir JWT'ye gömüp frontend'e
 * yönlendiriyoruz. Kullanıcı rıza ekranını doldurup `POST /api/auth/oauth/complete-registration`'a
 * bu token'ı geri gönderdiğinde kayıt asıl o zaman tamamlanır.
 *
 * Desen `invitationToken.ts` (davet token'ı) ile AYNIDIR: aynı `jwt` kütüphanesi, aynı
 * `config.jwt.secret`, aynı `type` guard'lı doğrulama. DB kaydı GEREKMEZ — imza tek başına yeterli.
 *
 * ⚠️ Bu token şifre/hassas kimlik bilgisi TAŞIMAZ — yalnız kayıt tamamlamak için gereken profil
 * alanları. Süre kısa (10 dk): kullanıcının rıza ekranını doldurması için yeterli, brute-force/
 * replay penceresini dar tutar. Tek kullanımlık DEĞİLDİR (davet token'ı da değil — aynı risk
 * seviyesi); kayıt tamamlanınca zaten kullanıcı DB'de var olacağından tekrar kullanımda
 * `finalizeOAuthRegistration` (oauthService.ts) mevcut e-postayı bulup KULLANICI_MEVCUT ile reddeder.
 */

import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import type { OAuthProviderName } from './oauthTypes.js';

const PENDING_OAUTH_REGISTRATION_TYPE = 'oauth_pending_registration';
const PENDING_OAUTH_REGISTRATION_EXPIRY = '10m';

export interface PendingOAuthRegistrationPayload {
  email: string;
  fullName: string;
  provider: OAuthProviderName;
  avatarUrl?: string;
  tenantId: string;
  role: 'MENTOR' | 'MENTI';
  approvalStatus: 'PENDING' | 'APPROVED';
}

interface PendingOAuthRegistrationClaims extends PendingOAuthRegistrationPayload {
  type: typeof PENDING_OAUTH_REGISTRATION_TYPE;
  iat?: number;
  exp?: number;
}

/** Bekleyen kayıt state'ini imzalı JWT'ye gömer (10 dk geçerli). */
export function signPendingOAuthRegistration(payload: PendingOAuthRegistrationPayload): string {
  const claims: Omit<PendingOAuthRegistrationClaims, 'iat' | 'exp'> = {
    ...payload,
    type: PENDING_OAUTH_REGISTRATION_TYPE,
  };
  return jwt.sign(claims, config.jwt.secret, { expiresIn: PENDING_OAUTH_REGISTRATION_EXPIRY } as jwt.SignOptions);
}

/** Geçerli + `type` doğruysa payload'ı döner; süresi geçmiş/bozuk/yanlış tip → null. */
export function verifyPendingOAuthRegistration(token: string): PendingOAuthRegistrationPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as PendingOAuthRegistrationClaims;
    if (decoded.type !== PENDING_OAUTH_REGISTRATION_TYPE) return null;
    const { type: _type, iat: _iat, exp: _exp, ...payload } = decoded;
    return payload;
  } catch {
    return null;
  }
}
