import jwt from 'jsonwebtoken';
import { config } from '../config.js';

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
}

export const PLATFORM_AUDIENCE = 'platform';

export function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'aud'>,
  options?: { audience?: string },
): string {
  // `as jwt.SignOptions`: config.jwt.expiresIn string'tir; ms-StringValue tipini karşılamak için cast.
  const signOptions = { expiresIn: config.jwt.expiresIn } as jwt.SignOptions;
  if (options?.audience) signOptions.audience = options.audience;
  return jwt.sign(payload, config.jwt.secret, signOptions);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwt.secret) as JwtPayload;
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}
