import { prisma } from '../db.js';

// Faz 1 (1. ay): Hafif sinyal — erken geri bildirim henüz tam veriye sahip değil.
// Faz 3 (3. ay): Güçlü sinyal — program tamamlandı, uzun vadeli uyum belli oldu.
const DELTA: Record<number, { reward: number; penalty: number }> = {
  1: { reward: 3,  penalty: -5  },
  3: { reward: 8,  penalty: -12 },
};

// Kombine skoru [-100, 100] aralığında tutar.
const SCORE_MIN = -100;
const SCORE_MAX = 100;

function clamp(value: number): number {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, value));
}

/**
 * Eşleşme geri bildirimine göre DISC kombinasyon skorunu günceller.
 * starRating >= 4 → ödül, starRating <= 2 → ceza, 3 → nötr (değişmez).
 * Skoru MatchCombinationScore tablosuna yazar; yoksa oluşturur.
 */
export async function applyFeedbackSignal(args: {
  tenantId: string;
  mentorDiscType: string | null | undefined;
  mentiDiscType: string | null | undefined;
  starRating: number;
  phase: number;
}): Promise<void> {
  const { tenantId, mentorDiscType, mentiDiscType, starRating, phase } = args;

  // DISC tipi bilinmiyorsa sinyal uygulanamaz
  if (!mentorDiscType || !mentiDiscType) return;

  const deltas = DELTA[phase] ?? DELTA[1];
  let delta = 0;

  if (starRating >= 4) {
    delta = deltas.reward;
  } else if (starRating <= 2) {
    delta = deltas.penalty;
  } else {
    // starRating == 3 → nötr, kayıt güncellenmez
    return;
  }

  const discCombination = `${mentorDiscType}_${mentiDiscType}`;

  // Mevcut skoru al; yoksa 0'dan başla
  const existing = await prisma.matchCombinationScore.findUnique({
    where: { tenantId_discCombination: { tenantId, discCombination } },
    select: { score: true },
  });

  const currentScore = existing?.score ?? 0;
  const newScore = clamp(currentScore + delta);

  await prisma.matchCombinationScore.upsert({
    where: { tenantId_discCombination: { tenantId, discCombination } },
    update: { score: newScore },
    create: { tenantId, discCombination, score: newScore },
  });
}

/**
 * Bir tenant'ın tüm DISC kombinasyon skorlarını döner.
 * Eşleşme algoritması bu değerleri kullanarak dinamik bonus/ceza uygulayabilir.
 */
export async function getCombinationScores(tenantId: string): Promise<Map<string, number>> {
  const rows = await prisma.matchCombinationScore.findMany({
    where: { tenantId },
    select: { discCombination: true, score: true },
  });
  return new Map(rows.map((r) => [r.discCombination, r.score]));
}
