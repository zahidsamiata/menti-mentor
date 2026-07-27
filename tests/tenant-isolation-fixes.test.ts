/**
 * Tenant izolasyonu / IDOR düzeltmeleri (güvenlik denetimi sonrası).
 *
 * 1. getMentorFilter: başka tenant'ın mentör filtresi OKUNAMAZ (cross-tenant IDOR).
 * 2. createMatchRequest: talep sahibi body'den DEĞİL req.auth'tan alınır (spoof engellenir).
 * 3. createMatchRequest: paylaşımsız cross-tenant hedefe talep 403.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('Tenant izolasyonu düzeltmeleri', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('getMentorFilter: başka tenant mentörünün filtresi okunamaz (404), kendi 200', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const mentorA = await createMentor(tenantA.id);
    const mentorB = await createMentor(tenantB.id);
    const { accessToken } = await loginAs(http, mentorA.email, mentorA.rawPassword);

    // Cross-tenant: A'nın token'ıyla B'nin mentör filtresi → 404 (izolasyon)
    await http
      .get(`/api/mentors/${mentorB.id}/filter`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(404);

    // Kendi tenant'ındaki mentör → 200
    await http
      .get(`/api/mentors/${mentorA.id}/filter`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(200);
  });

  it('createMatchRequest: requesterUserId body\'den spoof edilemez (req.auth kullanılır)', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);
    const mentor = await createMentor(tenant.id);
    const other = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .post('/api/requests')
      .set(tenantHeaders(tenant.id, accessToken))
      .send({
        requesterUserId: other.id,   // SPOOF denemesi — yok sayılmalı
        targetType: 'USER',
        targetId: mentor.id,
        requestMessage: 'Merhaba, görüşebilir miyiz?',
      })
      .expect(201);

    // Talep sahibi giriş yapan menti olmalı, body'deki 'other' değil.
    expect(res.body.requesterUserId).toBe(menti.id);
    expect(res.body.requesterUserId).not.toBe(other.id);
  });

  it('createMatchRequest: paylaşımsız cross-tenant hedefe 403', async () => {
    const tenantA = await createTenant({ isSharedPoolActive: false });
    const tenantB = await createTenant({ isSharedPoolActive: false });
    const menti = await createMenti(tenantA.id);
    const mentorB = await createMentor(tenantB.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    await http
      .post('/api/requests')
      .set(tenantHeaders(tenantA.id, accessToken))
      .send({ targetType: 'USER', targetId: mentorB.id, requestMessage: 'Selam' })
      .expect(403);
  });
});
