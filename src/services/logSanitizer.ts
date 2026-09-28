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
// Parça uzunlukları sınırlı (RFC: yerel ≤64, etiket ≤63): sınırsız `+` uzun, `@` içermeyen metinde
// her başlangıç noktasından sona kadar tarayıp karesel süre üretiyordu (inceleme bulgusu). Sınırla
// doğrusal kalır; `@` yoksa hiç çalıştırılmaz.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(normalized: string): boolean {
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Serbest metindeki e-posta adreslerini maskeler; e-posta yoksa metni aynen döndürür. */
export function scrubText(text: string): string {
  if (!text.includes('@')) return text;
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

// ─── DK-03 · hata iz kaydı (stack) süzgeci ─────────────────────────────────────
//
// Neden: KARAR-24 → B (PO 2026-09-21) — bir 500'ün tam iz kaydı platform paneline "kişisel veri
// temizlenmiş" olarak açılır. Stack'in İLK satırı hata mesajıdır ve mesaj; Prisma çağrı dökümü
// (`data: { fullName: "…", email: "…" }`), istek URL'si (`?token=…`), `Bearer …` başlığı ya da
// telefon numarası taşıyabilir. `scrubText` yalnız e-postayı maskeler; iz kaydı panele açıldığı
// için burada daha geniş (ve bilinçli olarak AGRESİF) bir süzgeç uygulanır. Dosya yolu + satır
// numarası (teşhisin kendisi) AYNEN kalır.
//
// Her desen üst sınırlı tekrar kullanır (karesel süre/ReDoS yok — `EMAIL_PATTERN` notuna bkz.).

/** Panele gidecek iz kaydının üst sınırı — aşırı uzun metin kesilir. */
export const TRACE_MAX_LENGTH = 16_000;
const TRACE_TRUNCATED = '…[kesildi]';

/**
 * JWT (üç base64url parçası, başlık `eyJ` ile başlar). Önünde base64url karakteri olmamalı: aksi
 * hâlde `eyJeyJ…` girdisinde her `eyJ`'den 2048 karaktere taranıp karesel süre oluşurdu.
 */
const JWT_PATTERN = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,4096}\.[A-Za-z0-9_-]{0,1024}/g;
/** `Authorization: Bearer <değer>` biçimi. */
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,4096}/gi;
/** URL sorgu parametresi DEĞERİ (`?anahtar=` / `&anahtar=` sonrası) — anahtar teşhis için kalır. */
const QUERY_VALUE_PATTERN = /([?&][A-Za-z0-9_.%[\]-]{1,64}=)[^&\s#'"`)<>]{1,2048}/g;
/**
 * Çift tırnaklı metin — Prisma çağrı dökümündeki alan değerleri (ad, e-posta, serbest metin).
 * Uzunluk sınırı YOK (uzun bio metni de maskelenir; girdi zaten TRACE_MAX_LENGTH ile kesik) ve
 * kapanmayan tırnak (kesilmiş döküm) satır sonuna kadar maskelenir. Dallar ayrık (`[^"\\\n]` ·
 * `\\` + satır içi karakter · satır sonundaki `\\`) → her başlangıçta tek yol, doğrusal.
 */
const DOUBLE_QUOTED_PATTERN = /"(?:[^"\\\n]|\\[^\n]|\\$)*(?:"|$)/gm;
/**
 * Tek tırnaklı değer (ör. `'ali@…'`, `(reading 'x')`) — yalnız aynı satırda kapananlar. Kaçış
 * (`\\'`) bilinçli olarak YOK: kaçışlı dal, `\\'\\'…` girdisinde her tırnaktan satır sonuna tarayıp
 * karesel süre üretirdi; kaçışsız desen yalnız satırın SON tırnağında başarısız olur → doğrusal.
 */
const SINGLE_QUOTED_PATTERN = /'[^'\n]*'/g;
/** Postgres kısıt ihlali ayrıntısı: `Key (email)=(değer) already exists` → sütun kalır, değer gider. */
const PG_KEY_DETAIL_PATTERN = /(\bKey \([^()\n]{1,200}\)=\()[^\n]*/g;
/**
 * Telefon (ve benzeri uzun rakam dizisi: kart no, TCKN, IP). 10–25 rakam; araya en fazla iki
 * ayırıcı (boşluk . - parantez) girebilir: `+90 555 123 45 67`, `+90(555)1234567`, `(0555) 123-45-67`.
 */
const PHONE_PATTERN = /(?<![A-Za-z0-9_+])\+?\(?\d(?:[ .()-]{0,2}\d){9,24}\)?(?![A-Za-z0-9_])/g;

/**
 * Hata iz kaydını (stack veya hata mesajı) panele gösterilebilir hâle getirir: JWT, Bearer/Basic
 * değeri, URL sorgu değerleri, Postgres `Key (…)=(…)` değeri, çift/tek tırnaklı değerler, e-posta ve telefon/uzun rakam dizileri
 * `[gizli]` (e-posta: `maskEmail`) olur. Saf fonksiyon — `tests/dk03-error-trace.unit.test.ts`.
 */
export function scrubStackTrace(text: string): string {
  const bounded = text.length > TRACE_MAX_LENGTH ? `${text.slice(0, TRACE_MAX_LENGTH)}${TRACE_TRUNCATED}` : text;
  const withoutSecrets = bounded
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(QUERY_VALUE_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(PG_KEY_DETAIL_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED})`)
    .replace(DOUBLE_QUOTED_PATTERN, `"${REDACTED}"`)
    .replace(SINGLE_QUOTED_PATTERN, `'${REDACTED}'`);
  return scrubText(withoutSecrets).replace(PHONE_PATTERN, REDACTED);
}
