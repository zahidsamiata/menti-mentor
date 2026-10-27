/**
 * Y1-B8 (KARAR-101 B genişletilmiş + EK) — onay bekleyen kullanıcı kapısının izin listesi ve
 * isimsiz mentör özeti. Saf mantık — DB gerektirmez.
 *
 * Ölçüt: kayıt süreci / kendi verisi uçları açık; eşleşme · mentör listesi/profili · mesaj · talep ·
 * randevu · anlaşma uçları KAPALI (varsayılan kapalı); alan özeti küçük grupları göstermez.
 */
import { describe, it, expect } from 'vitest';
import { isPendingAllowedRequest } from '../src/middleware/pendingApprovalGate.js';
import { decideMembershipAccess } from '../src/middleware/membershipAccess.js';
import { summarizeSectorsKAnonymous, K_ANONYMITY_THRESHOLD } from '../src/services/mask.js';

describe('Y1-B8 izin listesi — açık uçlar', () => {
  it.each([
    ['GET', '/api/auth/me'],
    ['POST', '/api/users/profile/complete'],
    ['GET', '/api/users/disc/questions'],
    ['POST', '/api/users/disc/submit'],
    ['PATCH', '/api/users/me/profile'],
    ['GET', '/api/users/u1/adaptive-test/next'],
    ['POST', '/api/users/u1/adaptive-test/answer'],
    ['GET', '/api/questions'],
    ['POST', '/api/questions/q1/respond'],
    ['GET', '/api/users/mentor-count'],
    ['GET', '/api/meetings/weekly-limit'],
    ['GET', '/api/me/data-export'],
    ['POST', '/api/me/delete-account'],
    ['GET', '/api/users/mentor-count?x=1'],
    ['GET', '/API/Auth/Me/'],
  ])('%s %s açık', (method, url) => {
    expect(isPendingAllowedRequest(method, url)).toBe(true);
  });
});

describe('Y1-B8 izin listesi — NEGATİF: kapalı uçlar', () => {
  it.each([
    ['GET', '/api/users'],
    ['GET', '/api/mentis/m1/mentor-matches'],
    ['GET', '/api/mentors/m1/candidates'],
    ['POST', '/api/mentors/m1/visibility-optin'],
    ['GET', '/api/requests'],
    ['POST', '/api/requests'],
    ['GET', '/api/conversations'],
    ['POST', '/api/conversations'],
    ['POST', '/api/conversations/c1/messages'],
    ['GET', '/api/conversations/unread-count'],
    ['POST', '/api/meetings/book'],
    ['POST', '/api/meetings'],
    ['GET', '/api/meetings'],
    ['GET', '/api/meetings/availability'],
    ['GET', '/api/agreements/active'],
    ['POST', '/api/agreements'],
    ['POST', '/api/scoring/rank-mentors'],
    ['GET', '/api/clubs'],
    ['GET', '/api/job-listings'],
    ['GET', '/api/feedback-logs'],
    // yöntem farkı: aynı yolun izinli olmayan yöntemi kapalı
    ['DELETE', '/api/auth/me'],
    // izinli bir yolun alt yolu kapalı
    ['GET', '/api/users/u1/clubs'],
    ['GET', '/api/users/mentor-count/extra'],
    // 7b notu: parça (#) ile izin desenine uydurma denemesi
    ['GET', '/api/users/#x'],
    ['GET', '/api/users#/x'],
  ])('%s %s kapalı', (method, url) => {
    expect(isPendingAllowedRequest(method, url)).toBe(false);
  });
});

describe('Y1-B8 üyelik kararı onay durumunu taşır', () => {
  const row = (approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED') => ({
    isActive: true,
    role: 'MENTI' as const,
    user: { isActive: true, approvalStatus },
  });
  it('PENDING erişimi kesmez ama durumu döner (kapı 4c bunu okur)', () => {
    expect(decideMembershipAccess(row('PENDING'))).toEqual({ ok: true, role: 'MENTI', approvalStatus: 'PENDING' });
  });
  it('REJECTED yine kapalı', () => {
    expect(decideMembershipAccess(row('REJECTED')).ok).toBe(false);
  });
});

describe('Y1-B8 isimsiz mentör alan özeti (k-anonim)', () => {
  const k = K_ANONYMITY_THRESHOLD;
  it('eşik ve üstü alanlar sayıyla, büyükten küçüğe', () => {
    const mentors = [
      ...Array.from({ length: 4 }, () => ['Yazılım']),
      ...Array.from({ length: k }, () => ['pazarlama', 'yazılım']),
    ];
    expect(summarizeSectorsKAnonymous(mentors, false)).toEqual([
      { sector: 'yazılım', count: 4 + k },
      { sector: 'pazarlama', count: k },
    ]);
  });
  it('NEGATİF: eşik altındaki alan HİÇ görünmez (adı da sayısı da)', () => {
    const mentors = [...Array.from({ length: k }, () => ['hukuk']), ['tasarım']];
    const out = summarizeSectorsKAnonymous(mentors, false);
    expect(out.map((s) => s.sector)).toEqual(['hukuk']);
  });
  it('NEGATİF: toplam gizliyse liste boş', () => {
    expect(summarizeSectorsKAnonymous([['a'], ['a'], ['a']], true)).toEqual([]);
  });
});
