/**
 * IC-05 devamı — kalan İngilizce/teknik doğrulama mesajları Türkçe ve anlaşılır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Mizaç testi: eksik/tekrarlı yanıt mesajı Türkçe', () => {
  let http: TestAgent;
  let tenantId: string;
  let userId: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
    const menti = await createUser({ tenantId, role: 'MENTI' });
    userId = menti.id;
    ({ accessToken: token } = await loginAs(http, menti.email, menti.rawPassword));
  });

  const answer = (questionId: number) => ({ questionId, selectedDisc: 'D' });

  it('negatif: 6 yanıt → 400, mesaj Türkçe (İngilizce sızmaz)', async () => {
    const res = await http
      .post(`/api/users/${userId}/temperament-test`)
      .set(tenantHeaders(tenantId, token))
      .send({ answers: [1, 2, 3, 4, 5, 6].map(answer) })
      .expect(400);
    const body = JSON.stringify(res.body);
    expect(body).toContain('7 sorunun hepsi yanıtlanmalı');
    expect(body).not.toMatch(/Exactly|required|must appear/);
  });

  it('negatif: tekrarlanan soru → 400, mesaj Türkçe', async () => {
    const res = await http
      .post(`/api/users/${userId}/temperament-test`)
      .set(tenantHeaders(tenantId, token))
      .send({ answers: [1, 1, 3, 4, 5, 6, 7].map(answer) })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('yalnız bir kez yanıtlanmalı');
  });
});
