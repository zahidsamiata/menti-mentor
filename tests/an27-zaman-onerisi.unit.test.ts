/**
 * AN-27 — "Zaman önerisi" mesaj tipi: saf kurallar (DB'siz).
 * KARAR-53 ②④: menti NEDEN görüşmek istediğini + bir ZAMAN talep eder; mentör ayırt eder.
 */
import { describe, it, expect } from 'vitest';
import {
  MESSAGE_KIND,
  TIME_PROPOSAL_CONFIG,
  canSendKind,
  checkProposalWindow,
  previewPrefix,
  timeProposalIssues,
} from '../src/services/timeProposal.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const REASON = 'Kariyer geçişim hakkında danışmak istiyorum.';

describe('AN-27 · canSendKind — zaman önerisini yalnız menti tarafı gönderir', () => {
  it('sıradan mesaj: iki taraf da gönderir', () => {
    expect(canSendKind('mentor', null)).toBe(true);
    expect(canSendKind('menti', undefined)).toBe(true);
  });
  it('zaman önerisi: menti gönderir, mentör GÖNDEREMEZ', () => {
    expect(canSendKind('menti', MESSAGE_KIND.TIME_PROPOSAL)).toBe(true);
    expect(canSendKind('mentor', MESSAGE_KIND.TIME_PROPOSAL)).toBe(false);
  });
});

describe('AN-27 · checkProposalWindow — ileri ve makul aralık', () => {
  it('geçmiş ve şimdi → PAST', () => {
    expect(checkProposalWindow(new Date(NOW.getTime() - 60_000), NOW)).toBe('PAST');
    expect(checkProposalWindow(NOW, NOW)).toBe('PAST');
  });
  it('yarın → geçerli; üst sınır günü → geçerli; bir gün fazlası → TOO_FAR', () => {
    expect(checkProposalWindow(new Date(NOW.getTime() + DAY), NOW)).toBeNull();
    expect(checkProposalWindow(new Date(NOW.getTime() + TIME_PROPOSAL_CONFIG.maxDaysAhead * DAY), NOW)).toBeNull();
    expect(checkProposalWindow(new Date(NOW.getTime() + (TIME_PROPOSAL_CONFIG.maxDaysAhead + 1) * DAY), NOW)).toBe('TOO_FAR');
  });
  it('geçersiz tarih → PAST (kabul edilmez)', () => {
    expect(checkProposalWindow(new Date('geçersiz'), NOW)).toBe('PAST');
  });
});

describe('AN-27 · timeProposalIssues — gövde kuralları', () => {
  it('sıradan mesaj (kind yok, tarih yok) → hata yok (davranış değişmedi)', () => {
    expect(timeProposalIssues({ message: 'Merhaba' }, NOW)).toEqual([]);
  });
  it('sıradan mesaja tarih eklenemez', () => {
    expect(timeProposalIssues({ message: 'Merhaba', proposedStartAt: iso(DAY) }, NOW).map((i) => i.path))
      .toEqual(['proposedStartAt']);
  });
  it('geçerli zaman önerisi → hata yok', () => {
    expect(timeProposalIssues({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: iso(2 * DAY) }, NOW)).toEqual([]);
  });
  it('geçmiş tarih → hata', () => {
    const issues = timeProposalIssues({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: iso(-DAY) }, NOW);
    expect(issues).toEqual([{ path: 'proposedStartAt', message: 'Önerilen zaman ileri bir tarih olmalıdır.' }]);
  });
  it('tarih yok → hata', () => {
    expect(timeProposalIssues({ message: REASON, kind: 'TIME_PROPOSAL' }, NOW).map((i) => i.path)).toEqual(['proposedStartAt']);
  });
  it('gerekçe çok kısa / çok uzun → hata', () => {
    expect(timeProposalIssues({ message: 'kısa', kind: 'TIME_PROPOSAL', proposedStartAt: iso(DAY) }, NOW).map((i) => i.path))
      .toEqual(['message']);
    const long = 'a'.repeat(TIME_PROPOSAL_CONFIG.reasonMax + 1);
    expect(timeProposalIssues({ message: long, kind: 'TIME_PROPOSAL', proposedStartAt: iso(DAY) }, NOW).map((i) => i.path))
      .toEqual(['message']);
  });
});

describe('AN-27 · previewPrefix — gelen kutusunda ayırt edilir', () => {
  it('zaman önerisi önekli, sıradan mesaj öneksiz', () => {
    expect(previewPrefix('TIME_PROPOSAL')).toBe('Zaman önerisi · ');
    expect(previewPrefix(null)).toBe('');
  });
});
