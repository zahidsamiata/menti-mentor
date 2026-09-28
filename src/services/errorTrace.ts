/**
 * DK-03 · Platform panelinde hata "iz kaydı" görünümü (KARAR-24 → B, PO 2026-09-21).
 *
 * Neden: platform operatörü bir 500 hatasının iz kaydını (stack) panelde göremiyordu; teşhis elle
 * DB sorgusuna bağlıydı. PO kararı: tam iz kaydı platform paneline KİŞİSEL VERİ TEMİZLENMİŞ açılır.
 *
 * Tasarım (AJ-102 ile ilişki): `GET /api/platform/logs` ve `/stats` `SystemLog.meta`'yı BİLİNÇLİ
 * olarak döndürmez (explicit select, `tests/aj102-gizlilik-negatif.test.ts` kilitli). O sözleşme
 * korunur; iz kaydı yalnız ayrı, tek-kayıtlık ve denetim izli `GET /api/platform/logs/:id/trace`
 * ucundan, bu dosyadaki görünüm üzerinden verilir:
 *   - Yalnız `ERROR` seviyesindeki kayıtlar (diğerleri → null → 404).
 *   - Ham `meta` ASLA dönmez: yalnız izin listesindeki alanlar (stack, hata mesajı, yöntem, URL,
 *     kullanıcı/kurum KİMLİK NUMARASI) seçilir; her metin `scrubStackTrace`'ten geçer.
 *   - Okuma tarafında da temizlenir: bu süzgeçten önce yazılmış eski satırlar da temiz görünür.
 *
 * Saf fonksiyon — DB/HTTP bağımlılığı yok (bkz. `tests/dk03-error-trace.unit.test.ts`).
 */

import { scrubStackTrace } from './logSanitizer.js';
import { maskUrlForLog } from './logUrl.js';

export interface ErrorTraceSource {
  id: string;
  level: string;
  category: string;
  message: string;
  createdAt: Date;
  meta: unknown;
}

export interface ErrorTraceView {
  id: string;
  category: string;
  message: string;
  createdAt: Date;
  errorMessage: string | null;
  stack: string | null;
  method: string | null;
  url: string | null;
  userId: string | null;
  tenantId: string | null;
}

/** Kimlik alanları kısa, düz kimlik biçiminde olmalı (cuid/uuid/slug) — değilse gösterilmez. */
const ID_LIKE = /^[A-Za-z0-9_-]{1,64}$/;
const METHOD_LIKE = /^[A-Z]{3,7}$/;

function readString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readScrubbed(meta: Record<string, unknown>, key: string): string | null {
  const value = readString(meta, key);
  return value === null ? null : scrubStackTrace(value);
}

function readMatching(meta: Record<string, unknown>, key: string, pattern: RegExp): string | null {
  const value = readString(meta, key);
  return value !== null && pattern.test(value) ? value : null;
}

function readUrl(meta: Record<string, unknown>): string | null {
  const value = readString(meta, 'url');
  return value === null ? null : scrubStackTrace(maskUrlForLog(value));
}

/**
 * `SystemLog` satırından panele gösterilecek temizlenmiş iz kaydını kurar.
 * ERROR dışı seviye → `null` (uç 404 döner; iz kaydı yalnız hatalar için açıktır).
 */
export function buildErrorTraceView(row: ErrorTraceSource): ErrorTraceView | null {
  if (row.level !== 'ERROR') return null;
  const meta = row.meta !== null && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : {};

  return {
    id: row.id,
    category: row.category,
    message: scrubStackTrace(row.message),
    createdAt: row.createdAt,
    errorMessage: readScrubbed(meta, 'message'),
    stack: readScrubbed(meta, 'stack'),
    method: readMatching(meta, 'method', METHOD_LIKE),
    // GV-14 öncesi yazılmış eski satırlarda yol içi token (davet vb.) olabilir → önce URL maskesi.
    url: readUrl(meta),
    userId: readMatching(meta, 'userId', ID_LIKE),
    tenantId: readMatching(meta, 'tenantId', ID_LIKE),
  };
}
