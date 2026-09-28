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
  // AJ-87: anahtarın türü (bkz. TOKEN_TYPES). Bu alandan önce imzalanmış anahtarlarda YOKTUR
  // (geçiş: bkz. LEGACY_UNTYPED_TOKENS_ACCEPTED_UNTIL_MS).
  typ?: TokenType;
}

export const PLATFORM_AUDIENCE = 'platform';

/**
 * AJ-87 — anahtar türleri. Erişim, platform, OAuth durum (state) ve davet anahtarları AYNI sırla
 * (config.jwt.secret) imzalanır; imza tek başına "bu hangi anahtar?" sorusunu cevaplamaz. Her
 * imzalayıcı `typ` yazar, her doğrulayıcı YALNIZ kendi türünü kabul eder — böylece bir türün
 * anahtarı başka türün kapısında geçerli sayılamaz (eskiden yalnız kurum uyuşmazlığı durduruyordu).
 */
export const TOKEN_TYPES = {
  ACCESS:      'access',
  PLATFORM:    'platform',
  OAUTH_STATE: 'oauth_state',
  INVITATION:  'invitation',
} as const;
export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

/** config.jwt.expiresIn'in jsonwebtoken tarafından yorumlanan süresi (ms) — sürenin tek kaynağı config. */
function accessTokenLifetimeMs(): number {
  const probe = jwt.decode(
    jwt.sign({}, config.jwt.secret, { expiresIn: config.jwt.expiresIn } as jwt.SignOptions),
  ) as { iat: number; exp: number };
  return (probe.exp - probe.iat) * 1000;
}

/**
 * AJ-87 GEÇİŞ PENCERESİ — tek yer. `typ` alanından ÖNCE imzalanmış (tür-siz) erişim/platform
 * anahtarları, bu kod yüklendikten sonra BİR erişim anahtarı ömrü (config.jwt.expiresIn) boyunca
 * kabul edilir; böylece dağıtım anında oturumu açık kullanıcılar atılmaz. Yeni kod tür-siz erişim
 * anahtarı ÜRETMEZ → pencere bittiğinde elde kalan her tür-siz anahtarın süresi zaten dolmuştur.
 * Tür-siz olup davet (`type`) ya da OAuth durum alanları (tenantSlug/nonce/inviteToken) taşıyan
 * anahtar pencere içinde de ASLA erişim anahtarı sayılmaz (bkz. isLegacyAccessShape).
 *
 * KALDIRMA: dağıtımdan bir ömür sonra bu sabit + isWithinLegacyWindow + iki doğrulayıcıdaki
 * `typ === undefined` dalı kaldırılabilir (silme protokolü: docs/arsiv/ kaydı ile).
 */
const LEGACY_UNTYPED_TOKENS_ACCEPTED_UNTIL_MS = Date.now() + accessTokenLifetimeMs();

function isWithinLegacyWindow(): boolean {
  return Date.now() < LEGACY_UNTYPED_TOKENS_ACCEPTED_UNTIL_MS;
}

const ACCESS_ROLES = new Set(['ADMIN', 'MENTOR', 'MENTI']);

/** Tür-siz anahtar yalnız eski erişim anahtarının biçimindeyse (sub/tenantId/role, başka tür alanı yok). */
function isLegacyAccessShape(decoded: Record<string, unknown>): boolean {
  return (
    typeof decoded['sub'] === 'string' &&
    typeof decoded['tenantId'] === 'string' &&
    typeof decoded['role'] === 'string' &&
    ACCESS_ROLES.has(decoded['role']) &&
    decoded['type'] === undefined &&
    decoded['tenantSlug'] === undefined &&
    decoded['nonce'] === undefined &&
    decoded['inviteToken'] === undefined
  );
}

export function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'aud' | 'jti' | 'typ'>,
  options?: { audience?: string },
): string {
  // `as jwt.SignOptions`: config.jwt.expiresIn string'tir; ms-StringValue tipini karşılamak için cast.
  const signOptions = { expiresIn: config.jwt.expiresIn } as jwt.SignOptions;
  if (options?.audience) signOptions.audience = options.audience;
  // AJ-87: platform anahtarı (aud:'platform') ayrı tür; geri kalan her şey erişim anahtarıdır.
  const typ = options?.audience === PLATFORM_AUDIENCE ? TOKEN_TYPES.PLATFORM : TOKEN_TYPES.ACCESS;
  return jwt.sign({ ...payload, typ, jti: crypto.randomUUID() }, config.jwt.secret, signOptions);
}

/**
 * Kurum/kullanıcı ERİŞİM anahtarını doğrular. Yalnız `typ:'access'` (ya da geçiş penceresinde
 * eski erişim biçimindeki tür-siz anahtar) kabul edilir; platform, OAuth durum ve davet anahtarları
 * imzası geçerli olsa da null döner (AJ-87). Platform anahtarı için: verifyPlatformToken.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload & Record<string, unknown>;
    if (payload.aud !== undefined) return null;
    if (payload.typ !== TOKEN_TYPES.ACCESS) {
      const legacyAccepted = payload.typ === undefined && isWithinLegacyWindow() && isLegacyAccessShape(payload);
      if (!legacyAccepted) return null;
    }
    // AJ-03: imza geçerli olsa bile, sahibi çıkış yaptıysa (jti iptal listesindeyse) reddedilir.
    if (isAccessTokenRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Platform yöneticisi anahtarını doğrular: `aud:'platform'` (jsonwebtoken denetler) + `typ:'platform'`
 * (geçiş penceresinde tür-siz eski platform anahtarı da). Erişim anahtarı burada geçmez (AJ-87).
 */
export function verifyPlatformToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret, { audience: PLATFORM_AUDIENCE }) as JwtPayload;
    if (payload.typ !== TOKEN_TYPES.PLATFORM) {
      const legacyAccepted = payload.typ === undefined && isWithinLegacyWindow() && payload.isPlatformAdmin === true;
      if (!legacyAccepted) return null;
    }
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
