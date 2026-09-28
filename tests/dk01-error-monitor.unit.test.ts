/**
 * DK-01 — dış hata izleme (Sentry) — birim testi (DB gerektirmez).
 *
 * Kapsam:
 *  - `SENTRY_DSN` yokken SDK YÜKLENMEZ, `init` çağrılmaz, `captureError` hiçbir şey göndermez.
 *  - Anahtar varken `init` kişisel veri bayrağı kapalı ve süzgeç kancalarıyla çağrılır.
 *  - `beforeSend` süzgeci: istek gövdesi, çerez, Authorization/başlıklar, sorgu değerleri,
 *    kullanıcı e-posta/IP düşer; mesaj/istisna metnindeki e-posta ve JWT temizlenir.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import {
  DATA_COLLECTION_OFF,
  buildSdkOptions,
  captureError,
  initErrorMonitor,
  resetErrorMonitorForTest,
  type ErrorMonitorSdk,
} from '../src/services/errorMonitor.js';
import {
  scrubBreadcrumb,
  scrubEvent,
  scrubMonitorUrl,
  scrubTransaction,
  type ScrubbableEvent,
} from '../src/services/errorMonitorScrub.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1LTEifQ.c2lnbmF0dXJlLWRlZ2VyaQ';
const EMAIL = 'ornek.kisi@example.com';

function fakeSdk() {
  return {
    init: vi.fn<(options: Record<string, unknown>) => unknown>(),
    captureException: vi.fn<(error: unknown, hint?: Record<string, unknown>) => unknown>(),
  } satisfies ErrorMonitorSdk;
}

afterEach(() => {
  resetErrorMonitorForTest();
  vi.unstubAllEnvs();
});

describe('initErrorMonitor — anahtar yoksa hiçbir şey yapmaz', () => {
  it('SENTRY_DSN tanımsız → SDK yüklenmez, init çağrılmaz', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    const sdk = fakeSdk();
    const loadSdk = vi.fn(async () => sdk);

    const enabled = await initErrorMonitor({ loadSdk });

    expect(enabled).toBe(false);
    expect(loadSdk).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('yalnız boşluktan oluşan DSN de "yok" sayılır', async () => {
    const loadSdk = vi.fn(async () => fakeSdk());
    expect(await initErrorMonitor({ dsn: '   ', loadSdk })).toBe(false);
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it('izleme kapalıyken captureError hiçbir şey göndermez ve atmaz', () => {
    expect(() => captureError(new Error('x'), { userId: 'u-1' })).not.toThrow();
  });
});

describe('initErrorMonitor — anahtar varsa', () => {
  it('init kişisel veri kapalı + süzgeç kancalarıyla çağrılır; captureError iletir', async () => {
    const sdk = fakeSdk();
    const enabled = await initErrorMonitor({ dsn: 'https://k@o1.ingest.sentry.io/1', loadSdk: async () => sdk });

    expect(enabled).toBe(true);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    const options = sdk.init.mock.calls[0][0] as Record<string, unknown>;
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBeUndefined();
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');

    captureError(new Error('boom'), { userId: 'u-1', tenantId: 't-1', source: 'http' });
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const hint = sdk.captureException.mock.calls[0][1] as { user: unknown; tags: unknown };
    expect(hint.user).toEqual({ id: 'u-1' });
    expect(hint.tags).toEqual({ source: 'http', tenantId: 't-1' });
  });

  it('SDK yüklenemezse uygulama çökmez, izleme kapalı kalır', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const enabled = await initErrorMonitor({
      dsn: 'https://k@o1.ingest.sentry.io/1',
      loadSdk: async () => {
        throw new Error('yok');
      },
    });
    expect(enabled).toBe(false);
    errorSpy.mockRestore();
  });

  it('SDK süreç dinleyicileri çıkarılır (çift olay / süreç kapanması yok)', () => {
    const options = buildSdkOptions('https://k@o1.ingest.sentry.io/1');
    const integrations = options.integrations as (d: Array<{ name: string }>) => Array<{ name: string }>;
    const kept = integrations([{ name: 'Http' }, { name: 'OnUncaughtException' }, { name: 'OnUnhandledRejection' }]);
    expect(kept.map((i) => i.name)).toEqual(['Http']);
  });
});

describe('beforeSend süzgeci — kişisel veri düşer', () => {
  const rawEvent = (): ScrubbableEvent => ({
    message: `Giriş başarısız: ${EMAIL} token=${JWT}`,
    request: {
      method: 'POST',
      url: `https://api.example.org/api/invitations/davet-gizli-123/join?token=abc&sayfa=2`,
      data: { email: EMAIL, password: 'P@ssw0rd!' },
      cookies: { accessToken: JWT },
      headers: { authorization: `Bearer ${JWT}`, cookie: `accessToken=${JWT}`, 'user-agent': 'x' },
      query_string: 'token=abc&email=ornek.kisi%40example.com',
      env: { REMOTE_ADDR: '203.0.113.7' },
    },
    user: { id: 'u-1', email: EMAIL, ip_address: '203.0.113.7', username: 'Örnek Kişi' },
    exception: {
      values: [
        {
          type: 'Error',
          value: `SMTP alıcı reddetti: ${EMAIL}`,
          stacktrace: { frames: [{ filename: 'a.js', lineno: 1, vars: { password: 'P@ssw0rd!' } }] },
        },
      ],
    },
    extra: { email: EMAIL, fullName: 'Örnek Kişi', tenantId: 't-1', note: `Bearer ${JWT}` },
    tags: { tenantId: 't-1' },
    breadcrumbs: [
      { category: 'console', message: `kullanıcı ${EMAIL}`, data: { arguments: [EMAIL, JWT] } },
      { category: 'http', data: { url: 'https://api.example.org/x?token=abc', method: 'GET', 'http.query': 'token=abc' } },
    ],
  });

  it('gövde, çerez, başlıklar, sorgu, ortam, e-posta, IP, yerel değişkenler, JWT dış servise GİTMEZ', () => {
    const out = scrubEvent(rawEvent());
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain('ornek.kisi');
    expect(serialized).not.toContain(JWT);
    expect(serialized).not.toContain('P@ssw0rd!');
    expect(serialized).not.toContain('203.0.113.7');
    expect(serialized).not.toContain('Örnek Kişi');
    expect(serialized).not.toContain('davet-gizli-123');
    expect(serialized).not.toContain('token=abc');

    expect(out.request).toEqual({ method: 'POST', url: 'https://api.example.org/api/invitations/[gizli]/join' });
    expect(out.user).toEqual({ id: 'u-1' });
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({ filename: 'a.js', lineno: 1 });
    expect(out.extra?.tenantId).toBe('t-1');
    expect(out.breadcrumbs?.[0].data).toBeUndefined();
  });

  it('yığın çerçevesindeki kaynak satırları metin olarak temizlenir', () => {
    const out = scrubEvent({
      exception: {
        values: [{ stacktrace: { frames: [{ context_line: `send('${EMAIL}')`, pre_context: [`t='${JWT}'`] }] } }],
      },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('ornek.kisi');
    expect(serialized).not.toContain(JWT);
  });

  it('girdi olayı DEĞİŞTİRİLMEZ (yeni nesne döner)', () => {
    const event = rawEvent();
    scrubEvent(event);
    expect(event.request?.data).toBeDefined();
    expect(event.user?.email).toBe(EMAIL);
  });

  it('kullanıcı kimliği yoksa user alanı tamamen düşer', () => {
    const out = scrubEvent({ user: { email: EMAIL, ip_address: '{{auto}}' } });
    expect(out.user).toBeUndefined();
  });

  it('SDK seçeneklerindeki beforeSend / beforeBreadcrumb aynı süzgeci kullanır', () => {
    const options = buildSdkOptions('https://k@o1.ingest.sentry.io/1');
    const beforeSend = options.beforeSend as (e: ScrubbableEvent) => ScrubbableEvent;
    const beforeBreadcrumb = options.beforeBreadcrumb as (b: Record<string, unknown>) => Record<string, unknown>;

    expect(JSON.stringify(beforeSend(rawEvent()))).not.toContain('ornek.kisi');
    const crumb = beforeBreadcrumb({ category: 'http', data: { url: 'https://h/x?code=gizli-kod' } });
    expect(JSON.stringify(crumb)).not.toContain('gizli-kod');
  });

  it('breadcrumb süzgeci: konsol verisi düşer, metin temizlenir', () => {
    const out = scrubBreadcrumb({ category: 'console', message: `Bearer ${JWT}`, data: { arguments: [EMAIL] } });
    expect(out.data).toBeUndefined();
    expect(out.message).toBe('Bearer [gizli]');
  });
});

describe('7b — Sentry v11 dataCollection (asıl veri toplama anahtarı)', () => {
  it('buildSdkOptions: dataCollection alanlarının hepsi kapalı', () => {
    const options = buildSdkOptions('https://k@o1.ingest.sentry.io/1');
    expect(options.dataCollection).toEqual(DATA_COLLECTION_OFF);
    expect(DATA_COLLECTION_OFF).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });

  it('gerçek @sentry/node istemcisi çözümlenmiş toplama seçeneklerini KAPALI görür', async () => {
    const client = Sentry.init({
      ...(buildSdkOptions('https://k@o1.ingest.sentry.io/1') as Sentry.NodeOptions),
      defaultIntegrations: false,
      transport: () => ({ send: async () => ({}), flush: async () => true }),
    });
    const resolved = client!.getDataCollectionOptions();
    await client!.close();
    expect(resolved.userInfo).toBe(false);
    expect(resolved.cookies).toBe(false);
    expect(resolved.httpHeaders).toEqual({ request: false, response: false });
    expect(resolved.httpBodies).toEqual([]);
    expect(resolved.urlQueryParams).toBe(false);
    expect(resolved.stackFrameVariables).toBe(false);
  });
});

describe('7b — işlem adı (transaction) ve adres süzgeci', () => {
  it('davet token\'lı işlem adı maskelenir: "GET /api/invitations/<token>/join"', () => {
    const out = scrubEvent({ transaction: 'GET /api/invitations/davet-gizli-123/join' });
    expect(out.transaction).toBe('GET /api/invitations/[gizli]/join');
  });

  it('işlem adındaki kimlik/JWT parçaları ve sorgu gizlenir', () => {
    expect(scrubTransaction(`POST /api/meetings/ckz9x1abc0000qwerty123456/cancel?token=abc`)).toBe(
      'POST /api/meetings/[gizli]/cancel',
    );
    expect(scrubTransaction(`/api/x/${JWT}`)).toBe('/api/x/[gizli]');
    expect(scrubTransaction(`hata ${EMAIL}`)).not.toContain('ornek.kisi');
  });

  it('scrubMonitorUrl: sorgu ve # tamamen düşer; kısa, anlamlı yol parçaları kalır', () => {
    expect(scrubMonitorUrl('/api/tenants/unsubscribe?token=abc#x')).toBe('/api/tenants/unsubscribe');
    expect(scrubMonitorUrl('/api/users/me/profile')).toBe('/api/users/me/profile');
  });
});
