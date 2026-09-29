/**
 * AN-29 / KARAR-34 SORU 1 — topluluk tipi kurum (DB'siz birim testleri).
 *
 * KARAR-34 CEVAP (PO, 2026-09-23): "Lider bir TALEP oluşturur → PO yalnız LİDERİ onaylar (üyeler PO
 * onayına DÜŞMEZ) → lider kendi ekosistemini açar, üyelerini KENDİSİ davet eder (topluluk = yöneticisi
 * bir kişi olan kurum, mevcut kurum akışıyla aynı iskelet)."
 *
 * Ölçülen: topluluk başvurusu e-posta alan adından bağımsız HER ZAMAN platform onayına düşer; kurum
 * kaydının (tür gönderilmeyen / ORGANIZATION) mevcut alan adı davranışı değişmez; platform onay
 * listesinin satırı türü taşır; şema/migration eklemeli + boş bırakılabilir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initialVerificationStatus, TENANT_KINDS } from '../src/controllers/selfServeController.js';
import { maskPendingTenantRow } from '../src/controllers/platformController.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('AN-29 — başlangıç doğrulama durumu (kurum / topluluk)', () => {
  it('topluluk: kurumsal alan adlı e-postayla bile platform onayına düşer (PO yalnız lideri onaylar)', () => {
    expect(initialVerificationStatus('lider@topluluk-ornek.org', 'COMMUNITY')).toBe('PENDING_REVIEW');
    expect(initialVerificationStatus('lider@gmail.com', 'COMMUNITY')).toBe('PENDING_REVIEW');
    expect(initialVerificationStatus('lider@kulup.istanbul.edu.tr', 'COMMUNITY')).toBe('PENDING_REVIEW');
  });

  it('kurum: mevcut alan adı davranışı değişmedi (tür gönderilmese de, ORGANIZATION da)', () => {
    for (const kind of [undefined, 'ORGANIZATION'] as const) {
      expect(initialVerificationStatus('admin@dernekadi.org', kind)).toBe('AUTO_APPROVED');
      expect(initialVerificationStatus('baskan@kulup.istanbul.edu.tr', kind)).toBe('PENDING_REVIEW');
      expect(initialVerificationStatus('admin@gmail.com', kind)).toBe('PENDING_REVIEW');
    }
  });

  it('kayıtta seçilebilen türler yalnız ORGANIZATION ve COMMUNITY (Zod izin listesi kaynağı)', () => {
    expect([...TENANT_KINDS]).toEqual(['ORGANIZATION', 'COMMUNITY']);
  });
});

describe('AN-29 — platform onay listesi satırı türü taşır', () => {
  const row = {
    id: 't1', name: 'Örnek Topluluk', displayName: null, slug: 'ornek-topluluk', isActive: true,
    verificationStatus: 'PENDING_REVIEW', verificationNote: null,
    createdAt: new Date('2026-09-29T00:00:00Z'),
    users: [{ fullName: 'Lider Kişi', email: 'lider@gmail.com' }],
  };

  it('COMMUNITY maskelemeden sonra da görünür; eski kayıt (NULL) NULL kalır', () => {
    expect(maskPendingTenantRow({ ...row, kind: 'COMMUNITY' }).kind).toBe('COMMUNITY');
    expect(maskPendingTenantRow({ ...row, kind: null }).kind).toBeNull();
  });
});

describe('AN-29 — şema + migration eklemeli ve boş bırakılabilir', () => {
  const schema = readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf8');
  const tenantBlock = /^model Tenant \{([\s\S]*?)^\}/m.exec(schema)![1]!;

  it('Tenant.kind nullable ve varsayılansız (mevcut kurumlar NULL = kurum gibi davranır)', () => {
    expect(tenantBlock).toMatch(/^\s*kind\s+TenantKind\?\s*$/m);
    expect(schema).toMatch(/enum TenantKind \{[^}]*ORGANIZATION[^}]*COMMUNITY[^}]*\}/);
  });

  it('migration idempotent ve veri değiştirmiyor (UPDATE/DELETE/DROP yok)', () => {
    const sql = readFileSync(resolve(ROOT, 'prisma/migrations/20260929140000_add_tenant_kind/migration.sql'), 'utf8');
    const code = sql.replace(/--.*$/gm, '');
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS "kind" "TenantKind"/);
    expect(code).toMatch(/duplicate_object/);
    expect(code).not.toMatch(/\b(UPDATE|DELETE|DROP|NOT NULL|DEFAULT)\b/i);
  });
});
