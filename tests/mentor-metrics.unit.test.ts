/**
 * Mentör panel metrikleri — saf eşleme birim testi (DB gerektirmez).
 *
 * Kapsam:
 *  - P-11: totalMentoringHours = dakika toplamı / 60, yuvarlanmış; veri yoksa 0.
 *  - P-12: isCertified — üyelik yoksa false.
 *  - P-13: activeMentis sayısı ≡ activeMentees liste uzunluğu (sayı ↔ liste tutarlı).
 *
 * Tek başına koşum: npx vitest run tests/mentor-metrics.unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import { buildMentorMetricsResponse } from '../src/controllers/mentorMetricsController.js';

const base = {
  pendingRequests: 0,
  completedMeetings: 0,
  activeMentees: [] as { id: string; fullName: string }[],
  avgNpsRaw: null as number | null,
  totalDurationMin: null as number | null,
  isCertified: false,
};

describe('buildMentorMetricsResponse — P-11 mentörlük saati', () => {
  it('dakika toplamını saate yuvarlar (150 dk → 3 saat)', () => {
    expect(buildMentorMetricsResponse({ ...base, totalDurationMin: 150 }).totalMentoringHours).toBe(3);
  });

  it('tam olmayan saati yuvarlar (100 dk → 2 saat)', () => {
    expect(buildMentorMetricsResponse({ ...base, totalDurationMin: 100 }).totalMentoringHours).toBe(2);
  });

  it('veri yoksa (null) 0 saat', () => {
    expect(buildMentorMetricsResponse({ ...base, totalDurationMin: null }).totalMentoringHours).toBe(0);
  });
});

describe('buildMentorMetricsResponse — P-12 sertifika durumu', () => {
  it('üyelik yoksa/sertifikasız false', () => {
    expect(buildMentorMetricsResponse({ ...base, isCertified: false }).isCertified).toBe(false);
  });

  it('sertifikalıysa true', () => {
    expect(buildMentorMetricsResponse({ ...base, isCertified: true }).isCertified).toBe(true);
  });
});

describe('buildMentorMetricsResponse — P-13 aktif menti listesi', () => {
  it('activeMentis sayısı liste uzunluğuna eşit (sayı ↔ liste tutarlı)', () => {
    const mentees = [
      { id: 'a', fullName: 'Ada' },
      { id: 'b', fullName: 'Bora' },
    ];
    const out = buildMentorMetricsResponse({ ...base, activeMentees: mentees });
    expect(out.activeMentis).toBe(2);
    expect(out.activeMentees).toEqual(mentees);
  });

  it('boş listede sayı 0', () => {
    const out = buildMentorMetricsResponse({ ...base, activeMentees: [] });
    expect(out.activeMentis).toBe(0);
    expect(out.activeMentees).toEqual([]);
  });
});

describe('buildMentorMetricsResponse — mevcut alanlar korunur', () => {
  it('avgNps yuvarlanır, null geçer', () => {
    expect(buildMentorMetricsResponse({ ...base, avgNpsRaw: 7.6 }).avgNps).toBe(8);
    expect(buildMentorMetricsResponse({ ...base, avgNpsRaw: null }).avgNps).toBeNull();
  });

  it('pendingRequests/completedMeetings düz geçer', () => {
    const out = buildMentorMetricsResponse({ ...base, pendingRequests: 3, completedMeetings: 5 });
    expect(out.pendingRequests).toBe(3);
    expect(out.completedMeetings).toBe(5);
  });
});
