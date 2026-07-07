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
}): ScoreBreakdown {
  const sectorScore = computeSectorScore(args.mentiTags, args.mentorTags);
  const discScore = computeDiscScore(args.mentiDisc, args.mentorDisc, args.mentiVector);
  const totalScore = Math.round((sectorScore * 0.6 + discScore * 0.4) * 10) / 10;
  const confidence = args.mentiVector?.confidence ?? (args.mentiDisc ? 1 : 0.5);
  return { sectorScore, discScore, totalScore, confidence };
}

