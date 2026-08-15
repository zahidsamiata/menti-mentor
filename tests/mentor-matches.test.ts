/**
 * Menti → Mentör uyum kartı endpoint testi (KARAR 5 güvenlik + IDOR regresyonu).
 *
 * GET /api/mentis/:mentiId/mentor-matches — menti kendisine uygun mentörleri uyum skoruyla
 * (yüzde) görür. GÜVENLİ YOL: mevcut skorlama motoru ters yönde okunur, canlı eşleştirme
 * (rankMentisForMentor) değişmez.
 *
 * Güvence altına alınan invariantlar:
 *  - KARAR 5: response mentörün discType'ını İÇERMEZ; compatibilityReason DISC harfi sızdırmaz.
 *  - Menti uyum skorunu (matchScore) GÖRÜR.
 *  - IDOR: bir menti başka menti'nin uyum listesine erişemez (requireSelfOrAdmin → 403).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('GET /mentis/:mentiId/mentor-matches — menti uyum kartı (KARAR 5 + IDOR)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('menti kendi listesini çeker: skor VAR, mentörün discType YOK, gerekçe DISC harfi sızdırmaz', async () => {
    const menti  = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji', 'finans'] });
    await createMentor(tenant.id, { discType: 'I', sectorTags: ['saglik'] });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .get(`/api/mentis/${menti.id}/mentor-matches`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: Array<Record<string, unknown>> }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // Menti uyum skorunu görür (yüzde).
      expect(typeof item['matchScore']).toBe('number');
      // KARAR 5: mentörün DISC tipi menti response'unda ASLA olmamalı.
      expect(item).not.toHaveProperty('discType');
      expect(item).not.toHaveProperty('discScore');
      // Gerekçe jenerik — tek başına D/I/S/C harfi (DISC tipi) sızdırmamalı.
      const reason = String(item['compatibilityReason'] ?? '');
      expect(reason).not.toMatch(/\b[DISC]\b/);
    }
  });

  it('IDOR: başka bir menti, bu menti\'nin uyum listesine erişemez (403)', async () => {
    const owner   = await createMenti(tenant.id);
    const other   = await createMenti(tenant.id);
    const tokens  = await loginAs(http, other.email, other.rawPassword);

    await http
      .get(`/api/mentis/${owner.id}/mentor-matches`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(403);
  });
});
