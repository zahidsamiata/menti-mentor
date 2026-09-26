/**
 * GV-10 — kurum-içi erişim kararı (saf fonksiyon, DB'siz).
 * Kural: üyelik aktif + hesap açık (isActive, REJECTED değil) → erişim; rol ÜYELİKTEN gelir.
 */
import { describe, it, expect } from 'vitest';
import { decideMembershipAccess, type MembershipAccessRow } from '../src/middleware/membershipAccess.js';

type RowOverrides = Partial<Omit<MembershipAccessRow, 'user'>> & { user?: Partial<MembershipAccessRow['user']> };

function row(overrides: RowOverrides = {}): MembershipAccessRow {
  return {
    isActive: overrides.isActive ?? true,
    role:     overrides.role ?? 'MENTOR',
    user:     { isActive: true, approvalStatus: 'APPROVED', ...overrides.user },
  };
}

describe('decideMembershipAccess (GV-10)', () => {
  it('aktif üyelik + açık hesap → erişim, rol üyelikten', () => {
    expect(decideMembershipAccess(row({ role: 'ADMIN' }))).toEqual({ ok: true, role: 'ADMIN' });
    expect(decideMembershipAccess(row({ role: 'MENTOR' }))).toEqual({ ok: true, role: 'MENTOR' });
  });

  it('üyelik yok → NO_ACTIVE_MEMBERSHIP', () => {
    expect(decideMembershipAccess(null)).toEqual({ ok: false, reason: 'NO_ACTIVE_MEMBERSHIP' });
  });

  it('üyelik pasif → NO_ACTIVE_MEMBERSHIP', () => {
    expect(decideMembershipAccess(row({ isActive: false }))).toEqual({ ok: false, reason: 'NO_ACTIVE_MEMBERSHIP' });
  });

  it('hesap pasif → ACCOUNT_INACTIVE', () => {
    expect(decideMembershipAccess(row({ user: { isActive: false } }))).toEqual({ ok: false, reason: 'ACCOUNT_INACTIVE' });
  });

  it('reddedilmiş hesap (isActive true kalsa bile) → ACCOUNT_INACTIVE', () => {
    expect(decideMembershipAccess(row({ user: { approvalStatus: 'REJECTED' } }))).toEqual({ ok: false, reason: 'ACCOUNT_INACTIVE' });
  });

  it('onay bekleyen (PENDING) hesap engellenmez — bekleme ekranı uçları çalışmaya devam eder', () => {
    expect(decideMembershipAccess(row({ role: 'MENTI', user: { approvalStatus: 'PENDING' } }))).toEqual({ ok: true, role: 'MENTI' });
  });
});
