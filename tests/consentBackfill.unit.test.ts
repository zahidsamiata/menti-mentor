/**
 * G1-07 — Backfill saf mantık birim testi (DB'siz).
 * `planBackfill` yalnız ACIK_RIZA üretir (AYDINLATMA yazmaz), idempotenttir ve
 * kvkkConsentAt boş özneleri atlar. Saf modül (src) — DB'ye bağlanmaz.
 */
import { describe, it, expect } from 'vitest';
import { planBackfill, LEGACY_VERSION } from '../src/services/consentBackfill.js';

const D = new Date('2024-01-01T00:00:00Z');

describe('planBackfill — saf backfill mantığı', () => {
  it('kvkkConsentAt dolu user/tenant için ACIK_RIZA satırı üretir', () => {
    const { rows } = planBackfill({
      users: [{ id: 'u1', kvkkConsentAt: D }],
      tenants: [{ id: 't1', kvkkConsentAt: D }],
      existing: [],
    });
    expect(rows).toHaveLength(2);
    const u = rows.find((r) => r.userId === 'u1');
    const t = rows.find((r) => r.tenantId === 't1');
    expect(u).toMatchObject({ userId: 'u1', tenantId: null, type: 'ACIK_RIZA', source: 'BACKFILL', version: LEGACY_VERSION, grantedAt: D });
    expect(t).toMatchObject({ tenantId: 't1', userId: null, type: 'ACIK_RIZA', source: 'BACKFILL', version: LEGACY_VERSION });
  });

  it('AYDINLATMA ASLA yazılmaz (yalnız ACIK_RIZA)', () => {
    const { rows } = planBackfill({
      users: [{ id: 'u1', kvkkConsentAt: D }, { id: 'u2', kvkkConsentAt: D }],
      tenants: [{ id: 't1', kvkkConsentAt: D }],
      existing: [],
    });
    expect(rows.every((r) => r.type === 'ACIK_RIZA')).toBe(true);
  });

  it('idempotent: özne zaten ACIK_RIZA taşıyorsa atlanır', () => {
    const { rows, missingUsers } = planBackfill({
      users: [{ id: 'u1', kvkkConsentAt: D }, { id: 'u2', kvkkConsentAt: D }],
      tenants: [],
      existing: [{ userId: 'u1', tenantId: null }], // u1 zaten var
    });
    expect(missingUsers.map((u) => u.id)).toEqual(['u2']);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('u2');
  });

  it('kvkkConsentAt boş (null) özne atlanır', () => {
    const { rows } = planBackfill({
      users: [{ id: 'u1', kvkkConsentAt: null }],
      tenants: [{ id: 't1', kvkkConsentAt: null }],
      existing: [],
    });
    expect(rows).toHaveLength(0);
  });

  it('ikinci çalıştırma (hepsi mevcut) 0 satır üretir', () => {
    const users = [{ id: 'u1', kvkkConsentAt: D }];
    const tenants = [{ id: 't1', kvkkConsentAt: D }];
    const existing = [
      { userId: 'u1', tenantId: null },
      { userId: null, tenantId: 't1' },
    ];
    const { rows } = planBackfill({ users, tenants, existing });
    expect(rows).toHaveLength(0);
  });
});
