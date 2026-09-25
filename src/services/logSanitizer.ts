/**
 * Günlük (log) kişisel veri süzgeci — `logger` her kaydı buradan geçirir.
 *
 * Neden: `backend/CLAUDE.md` PII kuralı #5 "log'a yalnız userId/tenantId; e-posta, ad, discVector ASLA"
 * der; ama kural yalnız çağrı yerinin disiplinine bağlıydı ve bir çağrı yeri (başarısız platform girişi)
 * ham e-postayı kalıcı `SystemLog` tablosuna yazıyordu. Bu süzgeç SAVUNMA katmanıdır: çağrı yeri yanlış
 * bir şey koysa bile PII DB'ye inmez. Çağrı yerlerinin kendisi de temiz tutulmaya devam eder.
 *
 * Kurallar:
 *  - Anahtar adı PII/sır listesindeyse (ya da `...email`, `...token`, `...password`, `...secret` ile
 *    bitiyorsa) değer maskelenir. E-posta anahtarları `maskEmail` ile iz bırakır (ilk harf + alan adı),
 *    diğerleri tamamen `[gizli]` olur.
 *  - Her metin değerinde (ve log mesajında) e-posta biçimli alt dizeler maskelenir — SMTP hata metinleri
 *    alıcı adresini içerebildiği için.
 *  - İç içe nesne/dizi taranır; döngüsel referans ve aşırı derinlik güvenle kesilir.
 *  - `userId`, `tenantId`, sayılar ve diğer analitik alanlar AYNEN kalır.
 *
 * Saf fonksiyon — DB/HTTP bağımlılığı yok (bkz. `tests/log-sanitizer.unit.test.ts`).
 */

import { maskEmail } from './mask.js';

export const REDACTED = '[gizli]';
const CIRCULAR = '[döngüsel]';
const TOO_DEEP = '[derin]';
const MAX_DEPTH = 8;

/**
 * Tam eşleşen anahtarlar (küçük harfe çevrilmiş, `_`/`-` atılmış hâliyle karşılaştırılır).
 * Kaynak: `backend/CLAUDE.md` "PII vs Analytical Data Segregation" tablosu + kimlik bilgisi/sır alanları.
 */
const SENSITIVE_KEYS = new Set([
  // Kimlik
  'email', 'fullname', 'firstname', 'lastname', 'username', 'phone', 'contact', 'reportername',
  // Serbest profil metinleri (PII tablosu)
  'biosummary', 'expertisedetails', 'targetaudience', 'volunteerhistory', 'pastprojects', 'education',
  'selfprofile', 'icebreaker', 'requestmessage', 'schools', 'companies', 'communities',
  'feedbacknote', 'reviewnote', 'rejectionreason', 'locationurl',
  // Psikometrik
  'discvector', 'disctype', 'temperamentjson', 'archetype',
  'discd', 'disci', 'discs', 'discc',
  'oceano', 'oceanc', 'oceane', 'oceana', 'oceann',
  // Kimlik bilgisi / sır
  'password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'secret',
  'clientsecret', 'apikey', 'authorization', 'cookie', 'otp',
]);

/** Bu eklerle biten anahtarlar da hassastır (ör. `toEmail`, `inviteToken`, `newPassword`). */
const SENSITIVE_SUFFIXES = ['email', 'token', 'password', 'secret'];

const EMAIL_KEY_SUFFIX = 'email';

// E-posta biçimli alt dize. Yerel kısım en az bir karakter; `@scope/paket` yolları eşleşmez.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(normalized: string): boolean {
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Serbest metindeki e-posta adreslerini maskeler; e-posta yoksa metni aynen döndürür. */
export function scrubText(text: string): string {
  return text.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}

function redactValue(normalizedKey: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (normalizedKey.endsWith(EMAIL_KEY_SUFFIX) && typeof value === 'string') return maskEmail(value);
  return REDACTED;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value instanceof Error) return scrubText(value.message);

  if (seen.has(value)) return CIRCULAR;
  if (depth >= MAX_DEPTH) return TOO_DEEP;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }
  if (!isPlainObject(value)) {
    // Sınıf örnekleri (Buffer, Map vb.) — içeriği tahmin edilemez; güvenli tarafta kal.
    return REDACTED;
  }

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    out[key] = isSensitiveKey(normalized)
      ? redactValue(normalized, inner)
      : sanitizeValue(inner, depth + 1, seen);
  }
  return out;
}

/**
 * Log meta'sını PII'den arındırılmış YENİ bir nesne olarak döndürür (girdiyi değiştirmez).
 */
export function sanitizeLogMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(meta, 0, new WeakSet()) as Record<string, unknown>;
}
