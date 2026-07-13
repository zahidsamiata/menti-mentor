import type { DiscType } from '@prisma/client';

export type ScoreBreakdown = {
  sectorScore: number;   // 0-100
  discScore: number;     // 0-100
  totalScore: number;    // 0-100
  confidence: number;    // 0-1: profil bütünlüğü (vektör varsa), 1=tam, 0.5=kısmi
};

// Kesirli DISC vektörü: progressive profiling'den türetilir.
// D+I+S+C toplamı 1'e normalize edilmeli. confidence: 0-1 (yanıt sayısı/hedef).
export type DiscVector = {
  D: number;
  I: number;
  S: number;
  C: number;
  confidence: number;
};

const ANTI_MATCH_RULES: Array<{ mentorDisc: DiscType; mentiDisc: DiscType }> = [
  { mentorDisc: 'D', mentiDisc: 'S' },
];

export function isAntiMatch(mentorDisc?: DiscType | null, mentiDisc?: DiscType | null): boolean {
  if (!mentorDisc || !mentiDisc) return false;
  return ANTI_MATCH_RULES.some(
    (r) => r.mentorDisc === mentorDisc && r.mentiDisc === mentiDisc,
  );
}

export function computeSectorScore(mentiTags: string[], mentorTags: string[]): number {
  // Menti etiketi yoksa uyum ölçülemez → 0 döndür (fallback katmanı bunu yakalar)
  if (!mentiTags.length) return 0;
  const mentiSet = new Set(mentiTags.map((t) => t.toLowerCase()));
  const mentorSet = new Set(mentorTags.map((t) => t.toLowerCase()));
  let matches = 0;
  for (const t of mentiSet) {
    if (mentorSet.has(t)) matches += 1;
  }
  return Math.round((matches / mentiSet.size) * 1000) / 10;
}

// DISC uyum matrisi: mentor satır, menti sütun
const DISC_COMPATIBILITY: Record<DiscType, Record<DiscType, number>> = {
  D: { D: 60, I: 75, S: 30, C: 85 },
  I: { D: 70, I: 60, S: 70, C: 80 },
  S: { D: 35, I: 70, S: 75, C: 65 },
  C: { D: 85, I: 75, S: 65, C: 60 },
};

// Vektör bazlı DISC skoru: menti'nin her boyuttaki ağırlıklı uyum ortalaması.
// Eksik profiller için matrisin her sütununu vektör bileşeniyle ağırlandırır.
function computeVectorDiscScore(mentiVector: DiscVector, mentorDisc: DiscType): number {
  const row = DISC_COMPATIBILITY[mentorDisc];
  return (
    mentiVector.D * row.D +
    mentiVector.I * row.I +
    mentiVector.S * row.S +
    mentiVector.C * row.C
  );
}

export function computeDiscScore(
  mentiDisc?: DiscType | null,
  mentorDisc?: DiscType | null,
  mentiVector?: DiscVector | null,
): number {
  if (!mentorDisc) return 50;

  // Eğer vektör mevcutsa: vektör skoru × confidence + matris skoru × (1-confidence)
  // Bu formül profil %100 tamamlanmamışken bile anlamlı bir skor üretir.
  if (mentiVector && mentiVector.confidence > 0) {
    const vectorScore = computeVectorDiscScore(mentiVector, mentorDisc);
    const matrixScore = mentiDisc ? DISC_COMPATIBILITY[mentorDisc][mentiDisc] : 50;
    const blended =
      mentiVector.confidence * vectorScore +
      (1 - mentiVector.confidence) * matrixScore;
    return Math.round(blended * 10) / 10;
  }

  // Fallback: klasik matris
  if (!mentiDisc) return 50;
  return DISC_COMPATIBILITY[mentorDisc][mentiDisc];
}

export function computeTotalScore(args: {
  mentiTags: string[];
  mentorTags: string[];
  mentiDisc?: DiscType | null;
  mentorDisc?: DiscType | null;
  mentiVector?: DiscVector | null;
  qualityMultiplier?: number;
}): ScoreBreakdown {
  const sectorScore = computeSectorScore(args.mentiTags, args.mentorTags);
  const discScore = computeDiscScore(args.mentiDisc, args.mentorDisc, args.mentiVector);
  const base = sectorScore * 0.6 + discScore * 0.4;
  const totalScore = Math.min(100, Math.round(base * (args.qualityMultiplier ?? 1.0) * 10) / 10);
  const confidence = args.mentiVector?.confidence ?? (args.mentiDisc ? 1 : 0.5);
  return { sectorScore, discScore, totalScore, confidence };
}

// ─── Mentor kalite katsayısı (feedback döngüsü) ──────────────────────────────

// Saf hesaplama — DB bağlantısı gerektirmez, birim testlerde kullanılır.
// avgScore: 1-5 arası ortalama; feedbackCount: en az 3 olmalı (az veriyle sert ceza yok).
export function applyQualityMultiplier(avgScore: number, feedbackCount: number): number {
  if (feedbackCount < 3) return 1.0;
  const raw = 1.0 + ((avgScore - 3.0) / 2.0) * 0.2;
  return Math.min(1.2, Math.max(0.8, Math.round(raw * 1000) / 1000));
}

// Mentorun son 10 görüşmesindeki menti → mentor geri bildirim ortalamasından
// kalite katsayısı hesaplar. Yeni mentor (< 3 görüşme) → 1.0 (nötr, ceza yok).
// guidanceScore + resourceSharingScore + trustScore ortalaması → ±%20 aralık.
export async function computeMentorQualityMultiplier(mentorId: string): Promise<number> {
  const { prisma } = await import('../db.js');
  const feedbacks = await prisma.feedback.findMany({
    where: {
      mentorId,
      OR: [
        { guidanceScore: { not: null } },
        { resourceSharingScore: { not: null } },
        { trustScore: { not: null } },
      ],
    },
    select: { guidanceScore: true, resourceSharingScore: true, trustScore: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  let total = 0;
  let count = 0;
  for (const fb of feedbacks) {
    if (fb.guidanceScore != null) { total += fb.guidanceScore; count++; }
    if (fb.resourceSharingScore != null) { total += fb.resourceSharingScore; count++; }
    if (fb.trustScore != null) { total += fb.trustScore; count++; }
  }

  const avgScore = count === 0 ? 3.0 : total / count;
  return applyQualityMultiplier(avgScore, feedbacks.length);
}

