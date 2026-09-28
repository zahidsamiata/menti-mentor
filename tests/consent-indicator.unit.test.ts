/**
 * AJ-88 — Platform "KVKK rızası Var/Yok" göstergesinin saf kaynağı (DB'siz).
 * Gösterge yalnız AKTİF (revokedAt=null) ACIK_RIZA satırından beslenir; eski kvkkConsentAt okunmaz.
 */
import { describe, it, expect } from 'vitest';
import {
  ACTIVE_KVKK_CONSENT_SELECT,
  KVKK_INDICATOR_CONSENT_TYPE,
  hasActiveKvkkConsent,
} from '../src/services/consentIndicator.js';

describe('AJ-88: consentIndicator', () => {
  it('sorgu yalnız geri çekilmemiş (revokedAt=null) satırları getirir', () => {
    expect(ACTIVE_KVKK_CONSENT_SELECT.where).toHaveProperty('revokedAt', null);
  });

  it('sorgu yalnız ACIK_RIZA türüne bakar (AYDINLATMA rıza değil, geri çekilmez)', () => {
    expect(KVKK_INDICATOR_CONSENT_TYPE).toBe('ACIK_RIZA');
    expect(ACTIVE_KVKK_CONSENT_SELECT.where.type).toBe('ACIK_RIZA');
  });

  it('veri minimizasyonu: yalnız id seçilir, en fazla 1 satır', () => {
    expect(ACTIVE_KVKK_CONSENT_SELECT.select).toEqual({ id: true });
    expect(ACTIVE_KVKK_CONSENT_SELECT.take).toBe(1);
  });

  it('aktif rıza satırı yoksa → false (Yok)', () => {
    expect(hasActiveKvkkConsent([])).toBe(false);
  });

  it('aktif rıza satırı varsa → true (Var)', () => {
    expect(hasActiveKvkkConsent([{ id: 'c1' }])).toBe(true);
  });
});
