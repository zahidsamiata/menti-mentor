/**
 * OAuth CSRF koruması için stateless state yönetimi.
 *
 * Tasarım kararı: Session store veya Redis kullanmak yerine JWT imzası tercih edildi.
 * Bu yaklaşım yatay ölçeklemede sorunsuz çalışır (herhangi bir pod callback'i doğrulayabilir).
 * Trade-off: Token süresi dolmadan invalidate edilemez — 10 dakikalık kısa expiry bu riski sınırlar.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { TOKEN_TYPES } from '../../middleware/jwtAuth.js';
import type { OAuthStatePayload } from './oauthTypes.js';

const STATE_EXPIRY_SECONDS = 600; // 10 dakika — authorization flow için yeterli

/** Tenant, rol ve (varsa) davet token'ını imzalanmış bir state string'ine dönüştürür. */
export function createOAuthState(tenantSlug: string, role: 'MENTOR' | 'MENTI', inviteToken?: string): string {
  const payload: OAuthStatePayload = {
    tenantSlug,
    role,
    nonce: crypto.randomBytes(16).toString('hex'),
    ...(inviteToken ? { inviteToken } : {}),
  };
  // AJ-87: tür bilgisi — state anahtarı erişim anahtarı yerine (ya da tersi) kullanılamasın.
  return jwt.sign({ ...payload, typ: TOKEN_TYPES.OAUTH_STATE }, config.jwt.secret, { expiresIn: STATE_EXPIRY_SECONDS });
}

/**
 * Callback'ten dönen state string'ini doğrular ve içeriğini döner.
 * @returns Geçerliyse payload, değilse null (süre dolmuş veya imza bozuk)
 */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  try {
    const decoded = jwt.verify(state, config.jwt.secret) as OAuthStatePayload & jwt.JwtPayload & { typ?: string };
    // AJ-87: yalnız state türü. Tür-siz eski state'e geçiş YOK: ömrü 10 dk, reddedilen kullanıcı
    // girişi yeniden başlatır (erişim anahtarı state yerine verilirse de burada düşer).
    if (decoded.typ !== TOKEN_TYPES.OAUTH_STATE) return null;
    // jwt.verify zaten exp kontrolü yapıyor; tip guard olarak alanları kontrol et
    if (!decoded.tenantSlug || !decoded.role || !decoded.nonce) return null;
    return {
      tenantSlug: decoded.tenantSlug,
      role: decoded.role,
      nonce: decoded.nonce,
      ...(typeof decoded.inviteToken === 'string' ? { inviteToken: decoded.inviteToken } : {}),
    };
  } catch {
    return null;
  }
}
