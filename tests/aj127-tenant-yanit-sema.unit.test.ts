/**
 * AJ-127 — platform kurum uçları (POST /api/tenants · GET/PATCH /api/tenants/:id) yanıt şema
 * kapsam bekçisi (DB'siz).
 *
 * schema.prisma'daki Tenant SKALER alanlarının her biri ya yanıt izin listesinde
 * (TENANT_ADMIN_RESPONSE_SELECT) ya da gerekçeli hariç listesinde (TENANT_ADMIN_RESPONSE_EXCLUDED)
 * olmalı. Şemaya yeni kurum kolonu eklenip ikisine de yazılmazsa bu test KIRMIZI olur → yeni
 * kolon (ör. AN-36 yasal kimlik alanları) yanıta girip girmeyeceği bilinçli karar verilmeden
 * birleştirilemez. (Açık select zaten yeni kolonu yanıta sokmaz; bu test kararın yazılı
 * kalmasını zorlar.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  TENANT_ADMIN_RESPONSE_SELECT,
  TENANT_ADMIN_RESPONSE_EXCLUDED,
} from '../src/controllers/tenantController.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma');

/** Tenant modelinin skaler alan adları (ilişki alanları — tipi başka model olanlar — hariç). */
function tenantScalarFields(): string[] {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const block = /^model Tenant \{([\s\S]*?)^\}/m.exec(schema);
  if (!block) throw new Error('schema.prisma içinde Tenant modeli bulunamadı');

  const modelNames = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
  const fields: string[] = [];
  for (const raw of block[1]!.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@@')) continue;
    const m = /^(\w+)\s+(\w+)/.exec(line);
    if (!m) continue;
    const [, name, type] = m;
    if (modelNames.has(type!)) continue; // ilişki alanı (users, memberships …)
    fields.push(name!);
  }
  return fields;
}

// Sır/kimlik bilgisi taşıyabilecek alan adları — yanıta ASLA girmemeli.
const SECRET_NAME = /(password|hash|token|secret)/i;

describe('AJ-127 — platform kurum uçları yanıt şema kapsamı', () => {
  const fields = tenantScalarFields();
  const included = Object.keys(TENANT_ADMIN_RESPONSE_SELECT);
  const excluded = Object.keys(TENANT_ADMIN_RESPONSE_EXCLUDED);

  it('şema ayrıştırması anlamlı (bilinen alanlar bulunuyor, ilişkiler dışarıda)', () => {
    expect(fields).toEqual(expect.arrayContaining(['name', 'slug', 'unsubscribeToken', 'verificationNote']));
    expect(fields).not.toContain('users');
    expect(fields).not.toContain('memberships');
  });

  it('her Tenant alanı ya yanıtta ya da gerekçeyle hariç', () => {
    const uncovered = fields.filter((f) => !included.includes(f) && !excluded.includes(f));
    expect(
      uncovered,
      `Yeni Tenant alanı — tenantController.ts'de TENANT_ADMIN_RESPONSE_SELECT ya da _EXCLUDED'a ekle: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('izin/hariç listeleri şemada olmayan alan içermiyor ve çakışmıyor', () => {
    expect(included.filter((f) => !fields.includes(f))).toEqual([]);
    expect(excluded.filter((f) => !fields.includes(f))).toEqual([]);
    expect(included.filter((f) => excluded.includes(f))).toEqual([]);
  });

  it('hariç tutulan her alanın gerekçesi yazılı', () => {
    for (const reason of Object.values(TENANT_ADMIN_RESPONSE_EXCLUDED)) {
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('sır/token adlı alan yanıta girmiyor; iç doğrulama izleri hariç', () => {
    expect(included.filter((f) => SECRET_NAME.test(f))).toEqual([]);
    for (const f of ['unsubscribeToken', 'verificationNote', 'verifiedBy', 'blockedPairs', 'kvkkConsentAt']) {
      expect(included).not.toContain(f);
    }
  });
});
