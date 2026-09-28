/**
 * AJ-102 — üç gizlilik iddiasının negatif testi (bugün doğru; bir sonraki refaktörde
 * sessizce bozulmasın diye kilitlenir).
 *
 *  md.88  GET /api/platform/stats → recentLogs içinde SystemLog.meta YOK
 *         (platformController.getPlatformStats — explicit select).
 *  md.80a GET /api/platform/logs  → items içinde SystemLog.meta YOK
 *         (platformController.getPlatformLogs — explicit select; komşu uç
 *         /api/system-logs testi security.test.ts "AJ-02").
 *  md.163 CertificationOption.internalNote kullanıcıya HİÇBİR AŞAMADA gitmez
 *         (schema.prisma yorumu). Seçeneğe dokunan üç kullanıcı ucu da kapsanır:
 *           GET  /api/scoring/certification/questions  (soru verilir)
 *           POST /api/scoring/certification/answer     (seçim sonrası açıklama)
 *           POST /api/scoring/certify                  (sınav sonucu)
 *
 * Kontrol rekürsiftir (yanıtın her düzeyinde anahtar aranır) ve boş listeyle geçemez:
 * önce meta'lı log / internalNote'lu seçenek oluşturulur, yanıtta en az bir kayıt beklenir.
 * Ek olarak gizli değerin kendisi ham JSON'da aranır (anahtar yeniden adlandırılsa da yakalar).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import type { Tenant } from '@prisma/client';

/** Yanıt gövdesinin HER düzeyinde (dizi öğeleri dahil) verilen anahtarı arar; bulunan yolları döner. */
function findKeyPaths(value: unknown, key: string, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findKeyPaths(item, key, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === key ? [`${path}.${k}`] : []),
      ...findKeyPaths(v, key, `${path}.${k}`),
    ]);
  }
  return [];
}

// ─── md.88 / md.80a — platform log uçları ─────────────────────────────────────

// Platform oturumu: security.test.ts / platform-read-audit.test.ts ile aynı desen.
function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

const LOG_SECRET_STACK = 'aj102-gizli-stack-izi';
const LOG_SECRET_EMAIL = 'aj102-sizmamali@example.org';

describe('AJ-102 · platform log uçları SystemLog.meta döndürmez', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    await testPrisma.systemLog.create({
      data: {
        level: 'ERROR',
        category: 'DB',
        message: 'aj102 örnek hata',
        meta: { userId: 'user-aj102', stack: LOG_SECRET_STACK, email: LOG_SECRET_EMAIL },
      },
    });
  });

  it('md.88 GET /api/platform/stats → recentLogs dolu, hiçbir düzeyde meta anahtarı yok', async () => {
    const res = await http.get('/api/platform/stats').set('Cookie', platformCookie());
    expect(res.status).toBe(200);
    const body = res.body as { recentLogs: Array<Record<string, unknown>> };
    expect(body.recentLogs.length).toBeGreaterThan(0);
    expect(body.recentLogs.some((l) => l['message'] === 'aj102 örnek hata')).toBe(true);
    expect(findKeyPaths(res.body, 'meta')).toEqual([]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(LOG_SECRET_STACK);
    expect(raw).not.toContain(LOG_SECRET_EMAIL);
  });

  it('md.80a GET /api/platform/logs → items dolu, hiçbir düzeyde meta anahtarı yok', async () => {
    const res = await http.get('/api/platform/logs').set('Cookie', platformCookie());
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<Record<string, unknown>> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((l) => l['message'] === 'aj102 örnek hata')).toBe(true);
    expect(findKeyPaths(res.body, 'meta')).toEqual([]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(LOG_SECRET_STACK);
    expect(raw).not.toContain(LOG_SECRET_EMAIL);
  });
});

// ─── md.163 — CertificationOption.internalNote ────────────────────────────────

const INTERNAL_NOTE_PREFIX = 'AJ102-IC-NOT-GIZLI';
const SCORE_BY_KEY: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };
const QUESTION_CODES = ['AJ102_Q1', 'AJ102_Q2', 'AJ102_Q3', 'AJ102_Q4', 'AJ102_Q5', 'AJ102_Q6'];

/** Her seçeneğinde internalNote DOLU olan kontrollü havuz (6 konu, 6. konu red-line). */
async function seedPoolWithInternalNotes() {
  await testPrisma.certificationOption.deleteMany({});
  await testPrisma.certificationQuestion.deleteMany({});
  for (const [i, code] of QUESTION_CODES.entries()) {
    const topic = `aj102-topic${i + 1}`;
    const q = await testPrisma.certificationQuestion.create({
      data: { code, dimension: topic, topic, variant: 'A', scenario: `Senaryo ${code}`, isRedLine: i === 5, isActive: true },
    });
    for (const key of ['A', 'B', 'C', 'D']) {
      const score = SCORE_BY_KEY[key]!;
      await testPrisma.certificationOption.create({
        data: {
          questionId: q.id, key, label: `Seçenek ${key}`, competencyScore: score,
          explanation: `Açıklama ${key}`, outcome: score === 3 ? 'correct' : score === 2 ? 'acceptable' : 'wrong',
          internalNote: `${INTERNAL_NOTE_PREFIX} ${code}/${key}`,
        },
      });
    }
  }
}

function expectNoInternalNote(body: unknown) {
  expect(findKeyPaths(body, 'internalNote')).toEqual([]);
  expect(JSON.stringify(body)).not.toContain(INTERNAL_NOTE_PREFIX);
}

describe('AJ-102 · md.163 CertificationOption.internalNote kullanıcıya gitmez', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    await seedPoolWithInternalNotes();
    // Ön koşul: iç not gerçekten DB'de dolu (boş alanla geçmesin).
    expect(await testPrisma.certificationOption.count({ where: { internalNote: { startsWith: INTERNAL_NOTE_PREFIX } } }))
      .toBe(QUESTION_CODES.length * 4);
    http = agent();
    tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    token = (await loginAs(http, mentor.email, mentor.rawPassword)).accessToken;
  });

  it('GET /api/scoring/certification/questions → sorular + seçenekler dolu, internalNote yok', async () => {
    const res = await http.get('/api/scoring/certification/questions').set(tenantHeaders(tenant.id, token));
    expect(res.status).toBe(200);
    const body = res.body as { questions: Array<{ options: unknown[] }> };
    expect(body.questions.length).toBeGreaterThan(0);
    expect(body.questions.every((q) => q.options.length > 0)).toBe(true);
    expectNoInternalNote(res.body);
  });

  it('POST /api/scoring/certification/answer → açıklama döner, internalNote yok', async () => {
    const res = await http
      .post('/api/scoring/certification/answer')
      .set(tenantHeaders(tenant.id, token))
      .send({ questionCode: 'AJ102_Q1', optionKey: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.explanation).toBe('Açıklama B');
    expectNoInternalNote(res.body);
  });

  it('POST /api/scoring/certify → sonuç döner, internalNote yok', async () => {
    const res = await http
      .post('/api/scoring/certify')
      .set(tenantHeaders(tenant.id, token))
      .send({ answers: QUESTION_CODES.map((c) => ({ questionCode: c, optionKey: 'A' })) });
    expect(res.status).toBe(200);
    expect(res.body.topicResults.length).toBe(QUESTION_CODES.length);
    expectNoInternalNote(res.body);
  });
});
