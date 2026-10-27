/**
 * U-12B — iptal kararı (saf). DB gerektirmez.
 */
import { describe, it, expect } from 'vitest';
import { isInvitationLinkUsable } from '../src/services/invitationToken.js';

describe('U-12B isInvitationLinkUsable', () => {
  it('lid yoksa (eski bağlantı) kayıt aranmaz, kullanılabilir', () => {
    expect(isInvitationLinkUsable({ tenantId: 't1' }, null)).toBe(true);
  });
  it('kayıt iptal edilmemiş ve aynı kurumsa kullanılabilir', () => {
    expect(isInvitationLinkUsable({ tenantId: 't1', lid: 'l1' }, { tenantId: 't1', revokedAt: null })).toBe(true);
  });
  it('NEGATİF: iptal edilmiş kayıt', () => {
    expect(isInvitationLinkUsable({ tenantId: 't1', lid: 'l1' }, { tenantId: 't1', revokedAt: new Date() })).toBe(false);
  });
  it('NEGATİF: kaydı olmayan lid', () => {
    expect(isInvitationLinkUsable({ tenantId: 't1', lid: 'l1' }, null)).toBe(false);
  });
  it('NEGATİF: başka kurumun kaydı', () => {
    expect(isInvitationLinkUsable({ tenantId: 't1', lid: 'l1' }, { tenantId: 't2', revokedAt: null })).toBe(false);
  });
});
