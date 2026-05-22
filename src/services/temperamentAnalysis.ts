export type QuestionAnswer = {
  questionId: number; // 1-7
  selectedDisc: 'D' | 'I' | 'S' | 'C'; // hidden label of chosen option
  selectedEnneagram?: string; // optional e.g. "8w7", "6w5"
};

export type TemperamentResult = {
  dominantDisc: 'D' | 'I' | 'S' | 'C';
  scores: Record<'D' | 'I' | 'S' | 'C', number>; // raw count per type (0-7)
  percentages: Record<'D' | 'I' | 'S' | 'C', number>; // percentage (0-100)
  enneagramWing: string | null; // most frequent enneagram label, or null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'; // HIGH: dominant >= 4, MEDIUM: 3, LOW: tie
};

// Tiebreak order: most assertive wins (D > I > C > S)
const DISC_PRIORITY: Array<'D' | 'I' | 'S' | 'C'> = ['D', 'I', 'C', 'S'];

export function analyzeTemperament(answers: QuestionAnswer[]): TemperamentResult {
  const total = answers.length;

  // Count raw DISC scores
  const scores: Record<'D' | 'I' | 'S' | 'C', number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const answer of answers) {
    scores[answer.selectedDisc] += 1;
  }

  // Determine dominant type with tiebreak: D > I > C > S
  const maxScore = Math.max(scores.D, scores.I, scores.S, scores.C);
  const dominantDisc = DISC_PRIORITY.find((disc) => scores[disc] === maxScore) as
    | 'D'
    | 'I'
    | 'S'
    | 'C';

  // Compute percentages (rounded to 1 decimal, based on total answers)
  const percentages: Record<'D' | 'I' | 'S' | 'C', number> = {
    D: total > 0 ? Math.round((scores.D / total) * 1000) / 10 : 0,
    I: total > 0 ? Math.round((scores.I / total) * 1000) / 10 : 0,
    S: total > 0 ? Math.round((scores.S / total) * 1000) / 10 : 0,
    C: total > 0 ? Math.round((scores.C / total) * 1000) / 10 : 0,
  };

  // Confidence: HIGH >= 4, MEDIUM == 3, LOW <= 2
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (maxScore >= 4) {
    confidence = 'HIGH';
  } else if (maxScore === 3) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  // Enneagram wing: most frequent label among provided values
  const enneagramCounts = new Map<string, number>();
  for (const answer of answers) {
    if (answer.selectedEnneagram) {
      enneagramCounts.set(
        answer.selectedEnneagram,
        (enneagramCounts.get(answer.selectedEnneagram) ?? 0) + 1,
      );
    }
  }

  let enneagramWing: string | null = null;
  if (enneagramCounts.size > 0) {
    let maxCount = 0;
    for (const [label, count] of enneagramCounts) {
      if (count > maxCount) {
        maxCount = count;
        enneagramWing = label;
      }
    }
  }

  return {
    dominantDisc,
    scores,
    percentages,
    enneagramWing,
    confidence,
  };
}

export function areTimeCommitmentsCompatible(a: string, b: string): boolean {
  // Implements the compatibility matrix from design doc
  // a and b are TimeCommitment enum values: AYDA_1 | AYDA_2_3 | HAFTADA_1 | HAFTADA_2_PLUS
  const matrix: Record<string, string[]> = {
    AYDA_1:        ['AYDA_1'],
    AYDA_2_3:      ['AYDA_2_3', 'HAFTADA_1'],
    HAFTADA_1:     ['AYDA_2_3', 'HAFTADA_1', 'HAFTADA_2_PLUS'],
    HAFTADA_2_PLUS:['HAFTADA_1', 'HAFTADA_2_PLUS'],
  };
  return matrix[a]?.includes(b) ?? false;
}
