/** AN-26 — yanıtsız mentör hatırlatma aşama seçimi (saf fonksiyon, DB'siz). */
import { describe, expect, it } from 'vitest';
import {
  computeMentorReminderStage,
  type MentorReminderState,
} from '../src/services/cronScheduler.js';

const NOW = new Date(Date.UTC(2026, 8, 26, 12, 0, 0));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function state(ageDays: number, over: Partial<MentorReminderState> = {}): MentorReminderState {
  return {
    createdAt: ago(ageDays),
    mentorHasReplied: false,
    mentorReminder1SentAt: null,
    mentorReminder2SentAt: null,
    adminEscalatedAt: null,
    ...over,
  };
}

describe('AN-26 · computeMentorReminderStage', () => {
  it('3/7/10 gün sınırları: sınırın hemen öncesi bir önceki aşama, tam sınırda yeni aşama', () => {
    expect(computeMentorReminderStage(state(2.99), NOW)).toBe('none');
    expect(computeMentorReminderStage(state(3), NOW)).toBe('reminder1');
    expect(computeMentorReminderStage(state(6.99, { mentorReminder1SentAt: ago(3) }), NOW)).toBe('none');
    expect(computeMentorReminderStage(state(7, { mentorReminder1SentAt: ago(4) }), NOW)).toBe('reminder2');
    expect(computeMentorReminderStage(state(9.99, { mentorReminder1SentAt: ago(6), mentorReminder2SentAt: ago(2) }), NOW)).toBe('none');
    expect(computeMentorReminderStage(state(10, { mentorReminder1SentAt: ago(7), mentorReminder2SentAt: ago(3) }), NOW)).toBe('escalate');
  });

  it('mentör yanıtladıysa hiçbir aşama yok', () => {
    for (const d of [3, 7, 10, 12]) {
      expect(computeMentorReminderStage(state(d, { mentorHasReplied: true }), NOW)).toBe('none');
    }
  });

  it('zaten gönderilmiş aşama tekrar gönderilmez', () => {
    expect(computeMentorReminderStage(state(4, { mentorReminder1SentAt: ago(1) }), NOW)).toBe('none');
    expect(computeMentorReminderStage(state(8, { mentorReminder1SentAt: ago(5), mentorReminder2SentAt: ago(1) }), NOW)).toBe('none');
    expect(computeMentorReminderStage(state(11, { adminEscalatedAt: ago(1) }), NOW)).toBe('none');
  });

  it('atlanan gün: yalnız en geç vadesi gelen aşama gönderilir, erken aşama sonradan gelmez', () => {
    // Cron 3-7. günlerde hiç çalışmadı → 8. günde 1. hatırlatma DEĞİL, doğrudan 2.
    expect(computeMentorReminderStage(state(8), NOW)).toBe('reminder2');
    // Hiç hatırlatma gitmedi, 10. gün geçti → doğrudan eskalasyon.
    expect(computeMentorReminderStage(state(11), NOW)).toBe('escalate');
    // 2. hatırlatma gitti ama 1. hiç gitmedi → 1. geriye dönük gönderilmez.
    expect(computeMentorReminderStage(state(8, { mentorReminder2SentAt: ago(1) }), NOW)).toBe('none');
    // Eskalasyon yapıldıysa (erken aşamalar eksik olsa da) hiçbir şey gönderilmez.
    expect(computeMentorReminderStage(state(12, { adminEscalatedAt: ago(1) }), NOW)).toBe('none');
  });

  it('14 günden eski konuşmalara bakılmaz (yayın anında toplu e-posta yok)', () => {
    expect(computeMentorReminderStage(state(14), NOW)).toBe('escalate');
    expect(computeMentorReminderStage(state(14.01), NOW)).toBe('none');
    expect(computeMentorReminderStage(state(60), NOW)).toBe('none');
  });
});
