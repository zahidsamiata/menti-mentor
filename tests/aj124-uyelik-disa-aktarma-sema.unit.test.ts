/**
 * AJ-124 — KVKK dışa aktarma: TenantMembership şema-kapsam bekçisi (DB'siz).
 *
 * schema.prisma'daki TenantMembership SKALER alanlarının her biri ya dışa aktarma izin listesinde
 * (MEMBERSHIP_EXPORT_SELECT) ya da gerekçeli hariç listesinde (MEMBERSHIP_EXPORT_EXCLUDED) olmalı.
 * Şemaya yeni üyelik alanı eklenip ikisine de yazılmazsa bu test KIRMIZI olur → "verilerimi indir"
 * çıktısı sessizce eksik kalmaz (ör. açık P-08 `learningJourneyStageIds`, I-08 `certDayAttempts` /
 * `certLastAttemptAt` merge edilince burada yakalanır).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MEMBERSHIP_EXPORT_SELECT,
  MEMBERSHIP_EXPORT_EXCLUDED,
} from '../src/services/gdprMembershipExport.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma');

/** TenantMembership modelinin skaler alan adları (ilişki alanları — tipi başka model olanlar — hariç). */
function tenantMembershipScalarFields(): string[] {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const block = /^model TenantMembership \{([\s\S]*?)^\}/m.exec(schema);
  if (!block) throw new Error('schema.prisma içinde TenantMembership modeli bulunamadı');

  const modelNames = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
  const fields: string[] = [];
  for (const raw of block[1]!.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@@')) continue;
    const m = /^(\w+)\s+(\w+)/.exec(line);
    if (!m) continue;
    const [, name, type] = m;
    if (modelNames.has(type!)) continue; // ilişki alanı (user, tenant)
    fields.push(name!);
  }
  return fields;
}

// Sır/kimlik bilgisi taşıyabilecek alan adları — dışa aktarmaya ASLA girmemeli.
const SECRET_NAME = /(password|hash|token|secret)/i;

describe('AJ-124 — üyelik dışa aktarma şema kapsamı', () => {
  const fields = tenantMembershipScalarFields();
  const exported = Object.keys(MEMBERSHIP_EXPORT_SELECT).filter((k) => k !== 'tenant');
  const excluded = Object.keys(MEMBERSHIP_EXPORT_EXCLUDED);

  it('şema ayrıştırması anlamlı (bilinen alanlar bulunuyor)', () => {
    expect(fields).toEqual(expect.arrayContaining(['role', 'certificationStatus', 'learningJourneyCompletedAt']));
  });

  it('her şema alanı ya dışa aktarılıyor ya da gerekçeyle hariç tutuluyor', () => {
    const uncovered = fields.filter((f) => !exported.includes(f) && !excluded.includes(f));
    expect(uncovered, `Yeni üyelik alanı — gdprMembershipExport.ts'de izin ya da hariç listesine ekle: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('izin/hariç listeleri şemada olmayan alan içermiyor ve çakışmıyor', () => {
    expect(exported.filter((f) => !fields.includes(f))).toEqual([]);
    expect(excluded.filter((f) => !fields.includes(f))).toEqual([]);
    expect(exported.filter((f) => excluded.includes(f))).toEqual([]);
  });

  it('hariç tutulan her alanın gerekçesi yazılı', () => {
    for (const reason of Object.values(MEMBERSHIP_EXPORT_EXCLUDED)) {
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('ölçüt alanları dışa aktarılıyor: rol, sertifika durumu/deneme/bekleme, yolculuk, katılım tarihi', () => {
    expect(exported).toEqual(
      expect.arrayContaining([
        'role', 'certificationStatus', 'certAttempts', 'cooldownUntil',
        'learningJourneyCompletedAt', 'createdAt',
      ]),
    );
  });

  it('sır/token/hash adlı alan dışa aktarılmıyor; kurum bağlamı yalnız ad + kısa ad', () => {
    expect(exported.filter((f) => SECRET_NAME.test(f))).toEqual([]);
    expect(MEMBERSHIP_EXPORT_SELECT.tenant).toEqual({ select: { name: true, slug: true } });
  });
});
