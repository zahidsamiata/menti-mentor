import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { isAccessTokenRevoked } from '../services/accessTokenRevocation.js';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: 'ADMIN' | 'MENTOR' | 'MENTI';
  fullName: string;
  isPlatformAdmin?: boolean;
  // Token domain ayrımı (güvenlik): platform token'ları aud:'platform' taşır.
  // Tenant/kullanıcı token'larında bu claim YOKTUR — böylece bir kullanıcı token'ı
  // yanlışlıkla platform endpoint'inde geçerli sayılamaz (bkz. requirePlatformAdmin).
  aud?: string;
  iat?: number;
  exp?: number;
  // AJ-03: her anahtar için rastgele, tahmin edilemez kimlik — logout bu kimliği bellek-içi
  // iptal listesine yazar (bkz. services/accessTokenRevocation.ts). Bu alandan ÖNCE
  // imzalanmış anahtarlarda jti YOKTUR (geriye uyumluluk — bkz. o dosyanın başlık yorumu).
  jti?: string;
  // AJ-31: anahtarın ait olduğu oturum = o oturumun RefreshToken kaydının id'si. Yenilemede kayıt
  // YERİNDE güncellenir (id sabit kalır), çıkışta silinir → requireTenant / authenticateTenantAdmin
  // kayıt yoksa anahtarı reddeder (bkz. membershipAccess.ts). Bellek-içi jti listesinden farkı:
  // DB'de durduğu için sunucu yeniden başlasa da geçerli. Platform anahtarında YOKTUR (oturum
  // kaydı yok). Bu alandan önce imzalanmış anahtarlarda da yoktur (geçiş: ≤ bir anahtar ömrü).
  sid?: string;
}

export const PLATFORM_AUDIENCE = 'platform';

export function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'aud' | 'jti'>,
  options?: { audience?: string },
): string {
  // `as jwt.SignOptions`: config.jwt.expiresIn string'tir; ms-StringValue tipini karşılamak için cast.
  const signOptions = { expiresIn: config.jwt.expiresIn } as jwt.SignOptions;
  if (options?.audience) signOptions.audience = options.audience;
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, config.jwt.secret, signOptions);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
    // AJ-03: imza geçerli olsa bile, sahibi çıkış yaptıysa (jti iptal listesindeyse) reddedilir.
    if (isAccessTokenRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}
