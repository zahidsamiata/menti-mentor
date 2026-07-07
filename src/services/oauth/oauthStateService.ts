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
import type { OAuthStatePayload } from './oauthTypes.js';

const STATE_EXPIRY_SECONDS = 600; // 10 dakika — authorization flow için yeterli

/** Tenant ve rol bilgisini imzalanmış bir state string'ine dönüştürür. */
export function createOAuthState(tenantSlug: string, role: 'MENTOR' | 'MENTI'): string {
  const payload: OAuthStatePayload = {
    tenantSlug,
    role,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  return jwt.sign(payload, config.jwt.secret, { expiresIn: STATE_EXPIRY_SECONDS });
}

/**
 * Callback'ten dönen state string'ini doğrular ve içeriğini döner.
 * @returns Geçerliyse payload, değilse null (süre dolmuş veya imza bozuk)
 */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  try {
    const decoded = jwt.verify(state, config.jwt.secret) as OAuthStatePayload & jwt.JwtPayload;
    // jwt.verify zaten exp kontrolü yapıyor; tip guard olarak alanları kontrol et
    if (!decoded.tenantSlug || !decoded.role || !decoded.nonce) return null;
    return { tenantSlug: decoded.tenantSlug, role: decoded.role, nonce: decoded.nonce };
  } catch {
    return null;
  }
}
