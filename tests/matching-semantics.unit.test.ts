/**
 * PS-07 · Eşleştirmenin ANLAMI — saf skor fonksiyonları (DB'siz birim testi).
 *
 * Bu dosya "skor şu sayıya eşit mi" diye DEĞİL, "iki aday arasında hangisi önde olmalı"
 * diye sorar. İddialar kodun bugünkü çıktısından değil ÜRÜN NİYETİNDEN türetilmiştir:
 *   - Sektör ağırlığı karakterden büyük (varsayılan %60 / %40 — scoring.ts DEFAULT_*_WEIGHT).
 *   - DISC matrisi mentor satırı × menti sütunu; D→S "anti-match" (scoring.ts ANTI_MATCH_RULES).
 *   - DISC bilinmiyorsa nötr (50) — ne ödüllendirilir ne cezalandırılır.
 *   - Kötü geri bildirim alan mentorun adaylara skoru düşer, iyi alanınki artar.
 * Formül bozulur ya da ağırlıklar yanlışlıkla ters çevrilirse bu testler kırılır.
 *
 * Kapsam dışı (bilinçli): kesin skor değerleri → tests/scoring.unit.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { DiscType } from '@prisma/client';
import { computeTotalScore, isAntiMatch } from '../src/services/scoring.js';

const DISC_TYPES: DiscType[] = ['D', 'I', 'S', 'C'];

type Candidate = { id: string; tags: string[]; disc: DiscType | null };

/** Motorun kullandığı saf skor fonksiyonuyla adayları azalan skora göre sıralar. */
function rank(
  mentor: { tags: string[]; disc: DiscType | null },
  candidates: Candidate[],
  opts: { sectorWeight?: number; discWeight?: number; qualityMultiplier?: number } = {},
): string[] {
  return candidates
    .map((c) => ({
      id: c.id,
      score: computeTotalScore({
        mentiTags: c.tags,
        mentorTags: mentor.tags,
        mentiDisc: c.disc,
        mentorDisc: mentor.disc,
        ...opts,
      }).totalScore,
    }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id);
}

describe('PS-07 · Sektör uyumu sıralamayı belirler', () => {
  it('aynı sektör etiketini paylaşan aday, hiç paylaşmayandan önde (DISC eşit)', () => {
    for (const mentorDisc of DISC_TYPES) {
      for (const mentiDisc of DISC_TYPES) {
        const order = rank({ tags: ['teknoloji'], disc: mentorDisc }, [
          { id: 'paylasmayan', tags: ['saglik'], disc: mentiDisc },
          { id: 'paylasan', tags: ['teknoloji'], disc: mentiDisc },
        ]);
        expect(order, `mentor ${mentorDisc} / menti ${mentiDisc}`).toEqual(['paylasan', 'paylasmayan']);
      }
    }
  });

  it('daha çok ilgi alanı örtüşen aday daha az örtüşenden önde', () => {
    const mentor = { tags: ['teknoloji', 'finans', 'girisim'], disc: 'C' as const };
    const order = rank(mentor, [
      { id: 'hic', tags: ['saglik', 'sanat'], disc: 'D' },
      { id: 'yarim', tags: ['teknoloji', 'sanat'], disc: 'D' },
      { id: 'tam', tags: ['teknoloji', 'finans'], disc: 'D' },
    ]);
    expect(order).toEqual(['tam', 'yarim', 'hic']);
  });

  it('etiketin büyük/küçük harfle yazılması uyumu değiştirmez', () => {
    const a = computeTotalScore({ mentiTags: ['teknoloji'], mentorTags: ['Teknoloji'], mentiDisc: 'D', mentorDisc: 'C' });
    const b = computeTotalScore({ mentiTags: ['FINANS'], mentorTags: ['finans'], mentiDisc: 'D', mentorDisc: 'C' });
    expect(a.totalScore).toBe(b.totalScore);
    expect(a.sectorScore).toBe(100);
  });

  it('varsayılan ağırlıkta sektör karakterden baskın: tam sektör + en kötü DISC > sıfır sektör + en iyi DISC', () => {
    // Ürün niyeti: sektör %60, karakter %40 → sektör örtüşmesi DISC uyumundan daha belirleyici.
    for (const mentorDisc of DISC_TYPES) {
      const scores = DISC_TYPES.map((d) =>
        computeTotalScore({ mentiTags: ['x'], mentorTags: ['x'], mentiDisc: d, mentorDisc }).discScore,
      );
      const worst = DISC_TYPES[scores.indexOf(Math.min(...scores))]!;
      const best = DISC_TYPES[scores.indexOf(Math.max(...scores))]!;
      const order = rank({ tags: ['teknoloji'], disc: mentorDisc }, [
        { id: 'disc-iyi-sektor-yok', tags: ['saglik'], disc: best },
        { id: 'sektor-tam-disc-kotu', tags: ['teknoloji'], disc: worst },
      ]);
      expect(order, `mentor ${mentorDisc}`).toEqual(['sektor-tam-disc-kotu', 'disc-iyi-sektor-yok']);
    }
  });

  it('kurum ağırlığı DISC lehine çevrilirse DISC uyumu sektörü geçebilir (ağırlık gerçekten etkili)', () => {
    // sektör %10 / DISC %90: yarım sektör + en iyi DISC, tam sektör + en kötü DISC'i geçmeli.
    const order = rank(
      { tags: ['teknoloji', 'finans'], disc: 'D' },
      [
        { id: 'sektor-tam-disc-kotu', tags: ['teknoloji'], disc: 'S' },
        { id: 'sektor-yarim-disc-iyi', tags: ['teknoloji', 'sanat'], disc: 'C' },
      ],
      { sectorWeight: 0.1, discWeight: 0.9 },
    );
    expect(order).toEqual(['sektor-yarim-disc-iyi', 'sektor-tam-disc-kotu']);
  });
});

describe('PS-07 · Karakter (DISC) uyumu, sektör eşitken sıralamayı belirler', () => {
  it('sektör eşitken DISC uyumu yüksek olan aday önde (C mentor: D > S)', () => {
    const order = rank({ tags: ['teknoloji'], disc: 'C' }, [
      { id: 'S', tags: ['teknoloji'], disc: 'S' },
      { id: 'D', tags: ['teknoloji'], disc: 'D' },
    ]);
    expect(order).toEqual(['D', 'S']);
  });

  it('anti-match çifti (D mentor → S menti), o mentorun satırındaki en düşük DISC skorudur', () => {
    expect(isAntiMatch('D', 'S')).toBe(true);
    const disc = (m: DiscType) =>
      computeTotalScore({ mentiTags: ['x'], mentorTags: ['x'], mentiDisc: m, mentorDisc: 'D' }).discScore;
    for (const other of DISC_TYPES.filter((t) => t !== 'S')) {
      expect(disc('S'), `D→S, D→${other}'den düşük olmalı`).toBeLessThan(disc(other));
    }
  });

  it('DISC bilinmeyen aday nötrdür: uyumlu tipten geride, anti-match tipinden önde', () => {
    const order = rank({ tags: ['teknoloji'], disc: 'D' }, [
      { id: 'anti-match-S', tags: ['teknoloji'], disc: 'S' },
      { id: 'bilinmiyor', tags: ['teknoloji'], disc: null },
      { id: 'uyumlu-C', tags: ['teknoloji'], disc: 'C' },
    ]);
    expect(order).toEqual(['uyumlu-C', 'bilinmiyor', 'anti-match-S']);
  });

  it('mentorun DISC tipi bilinmiyorsa DISC adaylar arasında fark yaratmaz', () => {
    const scores = DISC_TYPES.map(
      (d) => computeTotalScore({ mentiTags: ['teknoloji'], mentorTags: ['teknoloji'], mentiDisc: d, mentorDisc: null }).totalScore,
    );
    expect(new Set(scores).size).toBe(1);
  });
});

describe('PS-07 · Mentor kalite katsayısı aynı adayı farklı sıralar', () => {
  it('aynı aday için iyi puanlı mentorun skoru, kötü puanlınınkinden yüksek', () => {
    const args = { mentiTags: ['teknoloji'], mentorTags: ['teknoloji'], mentiDisc: 'D' as const, mentorDisc: 'C' as const };
    const good = computeTotalScore({ ...args, qualityMultiplier: 1.2 }).totalScore;
    const neutral = computeTotalScore({ ...args, qualityMultiplier: 1.0 }).totalScore;
    const bad = computeTotalScore({ ...args, qualityMultiplier: 0.8 }).totalScore;
    expect(good).toBeGreaterThanOrEqual(neutral);
    expect(neutral).toBeGreaterThan(bad);
  });

  it('kalite katsayısı bir mentorun KENDİ aday sıralamasını değiştirmez (hepsine aynı çarpan)', () => {
    const mentor = { tags: ['teknoloji', 'finans'], disc: 'C' as const };
    const candidates: Candidate[] = [
      { id: 'a', tags: ['teknoloji'], disc: 'S' },
      { id: 'b', tags: ['finans', 'sanat'], disc: 'D' },
      { id: 'c', tags: ['saglik'], disc: 'D' },
    ];
    expect(rank(mentor, candidates, { qualityMultiplier: 0.8 })).toEqual(rank(mentor, candidates));
  });
});
