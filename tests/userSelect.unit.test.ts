/**
 * PII select sabitleri — statik/negatif testler (AJ-09).
 *
 * Bağlam: `USER_CONTACT_SELECT` / `USER_IDENTITY_SELECT` / `USER_APPROVAL_SELECT`
 * (`src/utils/userSelect.ts`) onlarca yerdeki BİREBİR aynı Prisma `select` tekrarını
 * tek yerden adlandırdı. NEGATİF test: bu sabitlere `password`/`passwordHash`/token gibi
 * hassas bir alan yanlışlıkla eklenmesin (Güvenlik Kuralları — "Veri döndürürken", CLAUDE.md).
 * DB gerektirmez — saf değer kontrolü.
 */

import { describe, it, expect } from 'vitest';
import {
  USER_CONTACT_SELECT,
  USER_IDENTITY_SELECT,
  USER_APPROVAL_SELECT,
} from '../src/utils/userSelect.js';

const FORBIDDEN_FIELDS = [
  'password',
  'passwordHash',
  'refreshToken',
  'resetToken',
  'accessToken',
  'token',
];

const ALL_SELECTS: Record<string, Record<string, unknown>> = {
  USER_CONTACT_SELECT,
  USER_IDENTITY_SELECT,
  USER_APPROVAL_SELECT,
};

describe('userSelect sabitleri — negatif test (hassas alan sızmasın)', () => {
  for (const [name, select] of Object.entries(ALL_SELECTS)) {
    it(`${name} hiçbir yasaklı alan içermez (password/token vb.)`, () => {
      const keys = Object.keys(select);
      for (const forbidden of FORBIDDEN_FIELDS) {
        expect(keys).not.toContain(forbidden);
      }
    });

    it(`${name} yalnız düz "true" değerli alanlar içerir (iç içe select/include yok)`, () => {
      for (const value of Object.values(select)) {
        expect(value).toBe(true);
      }
    });
  }

  it('USER_CONTACT_SELECT tam olarak email + fullName içerir (over-fetch yok)', () => {
    expect(USER_CONTACT_SELECT).toEqual({ email: true, fullName: true });
  });

  it('USER_IDENTITY_SELECT tam olarak id + fullName + email içerir (over-fetch yok)', () => {
    expect(USER_IDENTITY_SELECT).toEqual({ id: true, fullName: true, email: true });
  });

  it('USER_APPROVAL_SELECT tam olarak id + email + fullName + approvalStatus içerir (over-fetch yok)', () => {
    expect(USER_APPROVAL_SELECT).toEqual({
      id: true,
      email: true,
      fullName: true,
      approvalStatus: true,
    });
  });
});
