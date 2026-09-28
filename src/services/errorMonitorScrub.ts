/**
 * DK-01 — dış hata izleme (Sentry) olaylarının kişisel veri süzgeci.
 *
 * Neden: KARAR-27 → A "Sentry (ya da eşdeğeri) kurulur, KİŞİSEL VERİ TEMİZLEME ayarıyla." Dış servis
 * yurtdışında barındırılır (KVKK yurtdışı aktarım); oraya giden her olayda istek gövdesi, çerez,
 * Authorization başlığı, sorgu değerleri, kullanıcı e-postası/IP'si OLMAMALI. Bu süzgeç `beforeSend`
 * ve `beforeBreadcrumb` kancalarından çağrılır; SDK'nın `sendDefaultPii: false` ayarının ÜSTÜNE ikinci
 * bir savunma katmanıdır (SDK varsayılanları sürümle değişebilir, bu dosya değişmez).
 *
 * Kişisel veri temizleyicisi GV-07'den YENİDEN KULLANILIR (KARAR-80/M21): serbest metin → `scrubText`,
 * yapılandırılmış ek bilgi → `sanitizeLogMeta`, URL → `maskUrlForLog` (GV-14). `logSanitizer.ts`
 * burada DEĞİŞTİRİLMEZ; yalnız dış servise özgü ek kurallar (JWT / Bearer metni) bu sarmalayıcıdadır.
 *
 * Saf fonksiyonlar — SDK'yı içe aktarmaz, DB/HTTP bağımlılığı yok
 * (bkz. `tests/dk01-error-monitor.unit.test.ts`).
 */

import { REDACTED, sanitizeLogMeta, scrubText } from './logSanitizer.js';
import { maskUrlForLog } from './logUrl.js';

/**
 * SDK olay/iz kaydının bu süzgecin dokunduğu alt kümesi. `@sentry/node` tiplerine bağlanmaz ki
 * süzgeç SDK yüklenmeden de derlenip test edilebilsin; SDK tipleri yapısal olarak buna uyar.
 */
export interface ScrubbableFrame {
  filename?: string;
  lineno?: number;
  vars?: unknown;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
}

export interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScrubbableRequest {
  url?: string;
  method?: string;
  data?: unknown;
  cookies?: unknown;
  headers?: unknown;
  query_string?: unknown;
  env?: unknown;
}

export interface ScrubbableEvent {
  message?: string;
  request?: ScrubbableRequest;
  user?: { id?: string | number; email?: string; ip_address?: string | null; username?: string };
  exception?: {
    values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: ScrubbableFrame[] } }>;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: ScrubbableBreadcrumb[];
  logentry?: { message?: string; params?: unknown[] };
}

// JWT biçimli metin (erişim/yenileme token'ı hata mesajına ya da log satırına karışırsa).
const JWT_IN_TEXT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
// "Bearer <token>" ve "Basic <kimlik>" başlık değerleri metne düşerse.
const AUTH_SCHEME_IN_TEXT = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/** Serbest metni (hata mesajı, iz kaydı metni) dış servise gitmeden temizler. */
export function scrubMonitorText(text: string): string {
  return scrubText(text).replace(JWT_IN_TEXT, REDACTED).replace(AUTH_SCHEME_IN_TEXT, `$1 ${REDACTED}`);
}

/** Tam URL ya da yol+sorgu biçimindeki adresi maskeler; sorgu değerleri TAMAMEN düşer. */
export function scrubMonitorUrl(url: string): string {
  const q = url.indexOf('?');
  const base = q === -1 ? url : url.slice(0, q);
  // Yol içindeki token'lar (davet bağlantısı, JWT biçimli parça) GV-14 maskesiyle gizlenir.
  // Tam URL (şema+host) verilirse yol kısmını ayırıp maskeler.
  const schemeEnd = base.indexOf('://');
  if (schemeEnd === -1) return scrubMonitorText(maskUrlForLog(base));
  const pathStart = base.indexOf('/', schemeEnd + 3);
  if (pathStart === -1) return base;
  return scrubMonitorText(base.slice(0, pathStart) + maskUrlForLog(base.slice(pathStart)));
}

function scrubRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return record;
  const sanitized = sanitizeLogMeta(record);
  return deepScrubStrings(sanitized) as Record<string, unknown>;
}

// `sanitizeLogMeta` metinlerde yalnız e-postayı maskeler; JWT/Bearer için metinleri bir tur daha geçir.
function deepScrubStrings(value: unknown): unknown {
  if (typeof value === 'string') return scrubMonitorText(value);
  if (Array.isArray(value)) return value.map(deepScrubStrings);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepScrubStrings(v);
    return out;
  }
  return value;
}

/**
 * İz kaydı (breadcrumb) süzgeci. Konsol kayıtlarının ek verisi (log argümanları) tamamen düşer;
 * HTTP kayıtlarında adresin sorgu kısmı düşer; metinler temizlenir.
 */
export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const out: T = { ...breadcrumb };
  if (typeof out.message === 'string') out.message = scrubMonitorText(out.message);
  if (out.category === 'console') {
    delete out.data;
    return out;
  }
  if (out.data) {
    const data: Record<string, unknown> = { ...out.data };
    if (typeof data.url === 'string') data.url = scrubMonitorUrl(data.url);
    delete data['http.query'];
    delete data['http.fragment'];
    out.data = scrubRecord(data);
  }
  return out;
}

// Yığın çerçevesi: yerel değişken değerleri düşer; kaynak kod satırları (SDK'nın eklediği bağlam)
// metin olarak temizlenir — koda gömülü bir e-posta/JWT de dışarı çıkmasın.
function scrubFrame<F extends ScrubbableFrame>(frame: F): F {
  const { vars: _vars, ...rest } = frame;
  const out = rest as F;
  if (typeof out.context_line === 'string') out.context_line = scrubMonitorText(out.context_line);
  if (Array.isArray(out.pre_context)) out.pre_context = out.pre_context.map(scrubMonitorText);
  if (Array.isArray(out.post_context)) out.post_context = out.post_context.map(scrubMonitorText);
  return out;
}

/**
 * Olay (hata) süzgeci — `beforeSend`. Girdiyi değiştirmez, temizlenmiş YENİ olay döndürür.
 *
 * Düşenler: istek gövdesi, çerezler, TÜM istek başlıkları (Authorization/Cookie dahil), sorgu
 * değerleri, ortam değişkenleri, kullanıcı e-posta/ad/IP (yalnız `id` kalır — analitik kimlik),
 * yığın çerçevelerindeki yerel değişken değerleri.
 * Temizlenenler: mesaj, istisna metni, ek bilgi/bağlam/etiketler, iz kayıtları.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const out: T = { ...event };

  if (typeof out.message === 'string') out.message = scrubMonitorText(out.message);
  if (out.logentry) {
    out.logentry = {
      ...out.logentry,
      ...(typeof out.logentry.message === 'string' && { message: scrubMonitorText(out.logentry.message) }),
    };
    delete out.logentry.params;
  }

  if (out.request) {
    const request: NonNullable<ScrubbableEvent['request']> = {};
    if (typeof out.request.method === 'string') request.method = out.request.method;
    if (typeof out.request.url === 'string') request.url = scrubMonitorUrl(out.request.url);
    // data · cookies · headers · query_string · env bilinçli olarak KOPYALANMAZ.
    out.request = request;
  }

  if (out.user) {
    const id = out.user.id;
    if (id === undefined || id === null) delete out.user;
    else out.user = { id };
  }

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((value) => ({
        ...value,
        ...(typeof value.value === 'string' && { value: scrubMonitorText(value.value) }),
        ...(value.stacktrace && {
          stacktrace: {
            ...value.stacktrace,
            ...(value.stacktrace.frames && {
              frames: value.stacktrace.frames.map(scrubFrame),
            }),
          },
        }),
      })),
    };
  }

  if (out.extra) out.extra = scrubRecord(out.extra);
  if (out.contexts) out.contexts = scrubRecord(out.contexts);
  if (out.tags) out.tags = scrubRecord(out.tags);
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map((b) => scrubBreadcrumb(b));

  return out;
}
