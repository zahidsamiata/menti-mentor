/**
 * AJ-52 — Tarayıcının gönderdiği CSP ihlal raporunu günlüğe yazılabilir, PII'siz özete indirger.
 *
 * Neden: ön yüz CSP'si ENGELLEYEN modda (AJ-22). Politikaya takılan kaynak kullanıcının tarayıcısında
 * sessizce kaybolur; rapor toplanmazsa hangi kaynağın kırıldığı hiç görülmez
 * (`docs/raporlar/kesif/csp-zorunlu-mod-hazirlik-2026-09-27.md` Bulgu 1).
 *
 * Güvenlik: rapor OTURUMSUZ ve SAHTELENEBİLİR dış girdidir. Yalnız dört alan alınır, hepsi daraltılır:
 *   - belge adresi  → yalnız YOL (sorgu dizgisi ve `#parça` ATILIR; ör. `?token=` sızmasın) + `maskUrlForLog`
 *   - engellenen adres → anahtar sözcük (inline/eval/data…) ya da origin + yol (sorgu/parça ATILIR)
 *   - yönerge        → yalnız `[a-z-]` tek sözcük (ör. `img-src`); uymayan rapor YAZILMAZ
 *   - mod            → `enforce` | `report`
 * Diğer her alan (özgün politika, kaynak dosya, örnek kod, user-agent, referrer) yok sayılır.
 *
 * İki biçim desteklenir:
 *   - `application/csp-report`   (eski `report-uri`):  `{ "csp-report": { "document-uri", … } }`
 *   - `application/reports+json` (Reporting API, `report-to`): `[{ type: "csp-violation", body: { documentURL, … } }]`
 *
 * Saf modül (DB/HTTP yok) — birim testi: `tests/csp-report.unit.test.ts`.
 */

import { z } from 'zod';
import { maskUrlForLog } from './logUrl.js';

/** Kabul edilen içerik tipleri (tarayıcının gönderdiği iki biçim). `application/json` kabul EDİLMEZ. */
export const CSP_REPORT_CONTENT_TYPES = ['application/csp-report', 'application/reports+json'];

/** Gövde boyut sınırı — tek bir tarayıcı raporu birkaç yüz bayttır; özgün politika dahil 8 KB bol. */
export const CSP_REPORT_BODY_LIMIT = '8kb';

/** Tek istekte işlenen en fazla rapor (Reporting API toplu gönderir); fazlası yok sayılır. */
export const CSP_REPORT_MAX_PER_REQUEST = 5;

/** Ham alan uzunluk tavanı — aşan alan rapor şemasına uymaz, rapor yazılmaz. */
const RAW_FIELD_MAX = 2048;

/** Günlüğe yazılan adreslerin uzunluk tavanı. */
const LOGGED_URL_MAX = 256;

/** Geçersiz / tanınmayan adres yerine yazılan değer. */
export const CSP_UNKNOWN_VALUE = '[gecersiz]';

const DIRECTIVE_PATTERN = /^[a-z-]{1,64}$/;
/** `blocked-uri` anahtar sözcükleri: inline, eval, data, blob, self, wasm-eval, trusted-types-sink … */
const BLOCKED_KEYWORD_PATTERN = /^[a-z][a-z-]{0,31}$/;
const URL_PROTOCOLS_WITH_ORIGIN = new Set(['http:', 'https:', 'ws:', 'wss:']);

const rawField = z.string().max(RAW_FIELD_MAX).optional();

const LegacyReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': rawField,
    'violated-directive': rawField,
    'effective-directive': rawField,
    'blocked-uri': rawField,
    disposition: rawField,
  }),
});

const ReportingApiEntrySchema = z.object({
  type: z.literal('csp-violation'),
  body: z.object({
    documentURL: rawField,
    effectiveDirective: rawField,
    blockedURL: rawField,
    disposition: rawField,
  }),
});

/** Günlüğe yazılacak, daraltılmış tek ihlal. */
export type CspViolationSummary = {
  directive: string;
  documentPath: string;
  blocked: string;
  disposition?: 'enforce' | 'report';
};

function truncate(value: string): string {
  return value.length > LOGGED_URL_MAX ? value.slice(0, LOGGED_URL_MAX) : value;
}

/** Belge adresinden yalnız yol — sorgu dizgisi ve parça atılır, yoldaki gizli parçalar maskelenir. */
export function sanitizeDocumentUri(raw: string | undefined): string {
  if (!raw) return CSP_UNKNOWN_VALUE;
  try {
    return truncate(maskUrlForLog(new URL(raw).pathname));
  } catch {
    return CSP_UNKNOWN_VALUE;
  }
}

/** Engellenen adres — anahtar sözcük aynen; http(s)/ws(s) için origin + yol; diğer şemalar yalnız şema adı. */
export function sanitizeBlockedUri(raw: string | undefined): string {
  if (!raw) return CSP_UNKNOWN_VALUE;
  const trimmed = raw.trim();
  if (BLOCKED_KEYWORD_PATTERN.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (URL_PROTOCOLS_WITH_ORIGIN.has(url.protocol)) {
      return truncate(`${url.origin}${maskUrlForLog(url.pathname)}`);
    }
    const scheme = url.protocol.replace(/:$/, '');
    return BLOCKED_KEYWORD_PATTERN.test(scheme) ? scheme : CSP_UNKNOWN_VALUE;
  } catch {
    return CSP_UNKNOWN_VALUE;
  }
}

/** Yönerge — yalnız ilk sözcük (CSP2 `violated-directive` "img-src 'self'" biçiminde gelebilir). */
export function sanitizeDirective(raw: string | undefined): string | null {
  const first = raw?.trim().split(/\s+/)[0]?.toLowerCase();
  return first && DIRECTIVE_PATTERN.test(first) ? first : null;
}

function sanitizeDisposition(raw: string | undefined): 'enforce' | 'report' | undefined {
  return raw === 'enforce' || raw === 'report' ? raw : undefined;
}

function summarize(fields: {
  documentUri?: string;
  directive?: string;
  blockedUri?: string;
  disposition?: string;
}): CspViolationSummary | null {
  const directive = sanitizeDirective(fields.directive);
  if (!directive) return null;
  const disposition = sanitizeDisposition(fields.disposition);
  return {
    directive,
    documentPath: sanitizeDocumentUri(fields.documentUri),
    blocked: sanitizeBlockedUri(fields.blockedUri),
    ...(disposition && { disposition }),
  };
}

/**
 * Ayrıştırılmış gövdeden günlüğe yazılacak ihlalleri çıkarır. Tanınmayan/bozuk gövde → boş liste
 * (hata FIRLATMAZ — uç her durumda 204 döner).
 */
export function extractCspViolations(body: unknown): CspViolationSummary[] {
  if (Array.isArray(body)) {
    return body
      .slice(0, CSP_REPORT_MAX_PER_REQUEST)
      .map((entry) => ReportingApiEntrySchema.safeParse(entry))
      .flatMap((parsed) => {
        if (!parsed.success) return [];
        const b = parsed.data.body;
        const summary = summarize({
          documentUri: b.documentURL,
          directive: b.effectiveDirective,
          blockedUri: b.blockedURL,
          disposition: b.disposition,
        });
        return summary ? [summary] : [];
      });
  }

  const parsed = LegacyReportSchema.safeParse(body);
  if (!parsed.success) return [];
  const r = parsed.data['csp-report'];
  const summary = summarize({
    documentUri: r['document-uri'],
    directive: r['effective-directive'] ?? r['violated-directive'],
    blockedUri: r['blocked-uri'],
    disposition: r.disposition,
  });
  return summary ? [summary] : [];
}
