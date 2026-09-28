/**
 * DK-01 — dış hata izleme (Sentry) bağlantısı. KARAR-27 → A.
 *
 * ── Anahtar yoksa HİÇBİR ŞEY yapmaz ──────────────────────────────────────────
 * `SENTRY_DSN` ortam değişkeni boş/tanımsızsa SDK YÜKLENMEZ (dinamik import bile yapılmaz),
 * `init` çağrılmaz, ağ isteği olmaz; `captureError` sessizce döner. Anahtar Dokploy'a girilene
 * (PO işi, 03-PO-ELLE-ISLER) kadar canlıda davranış değişmez.
 *
 * ── Kişisel veri ─────────────────────────────────────────────────────────────
 * `sendDefaultPii: false` + her olay/iz kaydı `errorMonitorScrub.ts` süzgecinden geçer (GV-07
 * temizleyicisi yeniden kullanılır). Performans izleme (tracing) ve oturum kaydı KAPALI:
 * `tracesSampleRate` verilmez → iz/performans verisi gönderilmez.
 *
 * ── Neden `--import` / ayrı instrument dosyası yok ───────────────────────────
 * Resmi kurulum, Express/HTTP otomatik ölçümü için SDK'nın süreçten ÖNCE yüklenmesini ister
 * (`node --import`). Burada yalnız HATA toplanır; hatalar açıkça `captureError` ile (500 hata
 * yakalayıcısı + yakalanmamış istisna/ret) gönderilir. Böylece Dockerfile ve başlatma komutu
 * değişmez; otomatik ölçüm gerekmez.
 */

import type { ErrorEvent, Breadcrumb } from '@sentry/node';
import { scrubBreadcrumb, scrubEvent } from './errorMonitorScrub.js';

/** Hata yakalanırken iliştirilen bağlam. Yalnız analitik kimlikler — e-posta/ad ASLA. */
export interface ErrorContext {
  userId?: string;
  tenantId?: string;
  method?: string;
  url?: string;
  source?: string;
}

/** SDK'nın bu modülün kullandığı kısmı (testte sahte yükleyici verilebilsin diye). */
export interface ErrorMonitorSdk {
  init: (options: Record<string, unknown>) => unknown;
  captureException: (error: unknown, hint?: Record<string, unknown>) => unknown;
}

export interface ErrorMonitorOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  loadSdk?: () => Promise<ErrorMonitorSdk>;
}

let activeSdk: ErrorMonitorSdk | null = null;

const SDK_PROCESS_HANDLERS = new Set(['OnUncaughtException', 'OnUnhandledRejection']);

const defaultLoadSdk = async (): Promise<ErrorMonitorSdk> =>
  (await import('@sentry/node')) as unknown as ErrorMonitorSdk;

/** `init`e verilen seçenekler — testte süzgeç kancaları ve PII bayrağı doğrulanır. */
export function buildSdkOptions(dsn: string, environment?: string, release?: string): Record<string, unknown> {
  return {
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    // Yerel değişken değerleri yığın çerçevelerine eklenmez (kişisel veri taşıyabilir).
    includeLocalVariables: false,
    // SDK'nın kendi yakalanmamış istisna/ret dinleyicileri çıkarılır: `server.ts`'teki mevcut
    // dinleyiciler (V-02) zaten `captureError` çağırır. SDK dinleyicisi hem çift olay üretir hem de
    // yakalanmamış istisnada süreci kapatabilir — bugünkü "logla, ayakta kal" davranışı korunur.
    integrations: (defaults: Array<{ name: string }>) =>
      defaults.filter((integration) => !SDK_PROCESS_HANDLERS.has(integration.name)),
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}

/**
 * Anahtar varsa SDK'yı yükleyip başlatır; yoksa hiçbir şey yapmaz.
 * @returns izlemenin etkin olup olmadığı
 */
export async function initErrorMonitor(options: ErrorMonitorOptions = {}): Promise<boolean> {
  const dsn = (options.dsn ?? process.env.SENTRY_DSN ?? '').trim();
  if (!dsn) return false;
  try {
    const sdk = await (options.loadSdk ?? defaultLoadSdk)();
    sdk.init(
      buildSdkOptions(
        dsn,
        options.environment ?? process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        options.release ?? process.env.GIT_SHA,
      ),
    );
    activeSdk = sdk;
    return true;
  } catch (err) {
    // İzleme kurulamadıysa uygulama ÇALIŞMAYA devam eder; ayrıntı (DSN dahil) basılmaz.
    console.error('[error-monitor] başlatılamadı:', err instanceof Error ? err.name : 'bilinmeyen hata');
    return false;
  }
}

/** Hatayı dış izleme servisine iletir. İzleme etkin değilse hiçbir şey yapmaz. */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  if (!activeSdk) return;
  try {
    const { source, ...extra } = context;
    activeSdk.captureException(error, {
      ...(context.userId && { user: { id: context.userId } }),
      tags: { ...(source && { source }), ...(context.tenantId && { tenantId: context.tenantId }) },
      extra,
    });
  } catch {
    // İzleme hatası asla asıl akışı bozmaz.
  }
}

/** Yalnız test: modül durumunu sıfırlar. */
export function resetErrorMonitorForTest(): void {
  activeSdk = null;
}
