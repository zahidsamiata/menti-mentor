/**
 * AJ-51 — platform çıkışı sunucu yeniden başlatmasından sonra da geçerli kalır (uçtan uca, gerçek DB).
 *
 * Eskiden çıkış yalnız bellek-içi jti listesine yazılıyordu (accessTokenRevocation.ts); süreç yeniden
 * başlayınca liste boşalıyor, çıkış yapılmış platform anahtarı ömrü dolana kadar yeniden geçerli
 * oluyordu. Yeniden başlatma burada bellek listesini sıfırlayarak taklit edilir
 * (`__resetAccessTokenRevocationForTests`) — DB'deki çıkış kaydı yine de anahtarı reddettirmeli.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createTestApp } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { __resetAccessTokenRevocationForTests } from '../src/services/accessTokenRevocation.js';

const ADMIN_EMAIL = process.env['PLATFORM_ADMIN_EMAIL'] ?? 'admin@platform.local';
const ADMIN_KEY   = process.env['PLATFORM_ADMIN_KEY']   ?? 'test-platform-key';

/** Giriş yapar, Set-Cookie'deki ham platform çerezini "platform_token=<değer>" olarak döndürür. */
async function loginRawCookie(http: ReturnType<typeof supertest>): Promise<string> {
  const res = await http.post('/api/platform/auth').send({ email: ADMIN_EMAIL, password: ADMIN_KEY }).expect(200);
  const raw: unknown = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const tokenCookie = cookies.find((c) => c.startsWith('platform_token='));
  expect(tokenCookie).toBeDefined();
  return tokenCookie!.split(';')[0]!;
}

function jtiOf(cookieHeader: string): string {
  const token = decodeURIComponent(cookieHeader.slice('platform_token='.length));
  const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { jti?: string };
  expect(typeof payload.jti).toBe('string');
  return payload.jti!;
}

describe('AJ-51 · platform çıkışı yeniden başlatmadan sonra da geçerli', () => {
  beforeEach(async () => {
    await cleanDb();
    __resetAccessTokenRevocationForTests();
  });

  it('giriş → çıkış → (yeniden başlatma: bellek listesi boş) → eski çerezle platform isteği 403', async () => {
    const http = supertest(createTestApp());
    const cookie = await loginRawCookie(http);

    await http.get('/api/platform/stats').set('Cookie', cookie).expect(200);
    await http.post('/api/platform/logout').set('Cookie', cookie).expect(200);

    // Çıkış kaydı DB'de: jti meta'da, kişisel veri yok.
    const jti = jtiOf(cookie);
    const log = await testPrisma.systemLog.findFirst({
      where: { category: 'AUTH', message: 'PLATFORM_LOGOUT', meta: { path: ['jti'], equals: jti } },
    });
    expect(log).not.toBeNull();
    expect(Object.keys((log!.meta ?? {}) as object).sort()).toEqual(['exp', 'jti']);

    // Sunucu yeniden başladı: bellek-içi iptal listesi boş.
    __resetAccessTokenRevocationForTests();

    const res = await http.get('/api/platform/stats').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('YETKISIZ');
  });

  it('negatif kontrol: çıkış yapılmamış başka platform oturumu yeniden başlatmadan sonra da çalışır', async () => {
    const http = supertest(createTestApp());
    const loggedOut = await loginRawCookie(http);
    const stillOpen = await loginRawCookie(http);
    expect(jtiOf(loggedOut)).not.toBe(jtiOf(stillOpen));

    await http.post('/api/platform/logout').set('Cookie', loggedOut).expect(200);
    __resetAccessTokenRevocationForTests();

    await http.get('/api/platform/stats').set('Cookie', stillOpen).expect(200);
    await http.get('/api/platform/stats').set('Cookie', loggedOut).expect(403);
  });
});
