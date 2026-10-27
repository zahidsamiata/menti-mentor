/**
 * U-12 (KARAR-82 A) — toplu davet bağlantısı 7 gün geçerli.
 *
 * Neden: sızan bir davet bağlantısıyla yabancı biri kuruma kalıcı üye olabiliyordu ve bağlantı 30 gün açıktı.
 * Ölçüt: 7 günü geçmiş davet (30 günlük `exp` taşıyan ESKİ bağlantı dahil) doğrulamadan geçmez.
 *
 * Saf mantık — DB gerektirmez: npx vitest run tests/u12-davet-7-gun.unit.test.ts
 */

import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import {
  INVITATION_EXPIRES_IN,
  INVITATION_TTL_SECONDS,
  isInvitationTooOld,
  verifyInvitationToken,
} from '../src/services/invitationToken.js';

const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

/** Eski (30 günlük) davetleri taklit eder: iat geçmişte, exp hâlâ ileride. */
function legacyInvite(ageSeconds: number): string {
  const iat = now() - ageSeconds;
  return jwt.sign(
    { tenantId: 't1', role: 'MENTI', type: 'invitation', typ: 'invitation', iat, exp: iat + 30 * DAY },
    config.jwt.secret,
  );
}

describe('U-12 davet bağlantısı 7 gün', () => {
  it('yeni bağlantının süresi 7 gün', () => {
    expect(INVITATION_EXPIRES_IN).toBe('7d');
    expect(INVITATION_TTL_SECONDS).toBe(7 * DAY);
  });

  it('6 günlük davet geçerli', () => {
    expect(verifyInvitationToken(legacyInvite(6 * DAY))?.tenantId).toBe('t1');
  });

  it('NEGATİF: 8 günlük davet — exp henüz dolmamış olsa da — reddedilir', () => {
    expect(verifyInvitationToken(legacyInvite(8 * DAY))).toBeNull();
  });

  it('NEGATİF: iat taşımayan davet reddedilir', () => {
    expect(isInvitationTooOld(undefined)).toBe(true);
  });

  it('sınır: tam 7 gün geçerli, 7 gün + 1 sn değil', () => {
    const t = 1_000_000_000;
    expect(isInvitationTooOld(t - INVITATION_TTL_SECONDS, t)).toBe(false);
    expect(isInvitationTooOld(t - INVITATION_TTL_SECONDS - 1, t)).toBe(true);
  });
});
