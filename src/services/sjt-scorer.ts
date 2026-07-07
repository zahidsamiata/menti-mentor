import { prisma } from '../db.js';
import type { OceanKey, OceanVector } from './scoring.config.js';

export interface SjtAnswer {
  questionCode: string;
  optionKey?: string;   // SINGLE format
  mostKey?: string;     // MOST_LEAST format
  leastKey?: string;    // MOST_LEAST format
}

type WeightMap = Partial<Record<OceanKey, number>>;

const OCEAN_KEYS: OceanKey[] = ['o', 'c', 'e', 'a', 'n'];

function parseWeights(raw: unknown): WeightMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: WeightMap = {};
  for (const key of OCEAN_KEYS) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === 'number') out[key] = val;
  }
  return out;
}

function accumulate(
  weights: WeightMap,
  coefficient: number,
  sum: Record<OceanKey, number>,
  hits: Record<OceanKey, number>,
): void {
  for (const key of OCEAN_KEYS) {
    const val = weights[key];
    if (typeof val === 'number' && val !== 0) {
      sum[key] += coefficient * val;
      hits[key] += 1;
    }
  }
}

/**
 * SJT yanıtlarını OCEAN kalibrasyon vektörüne dönüştürür.
 * Yalnızca yanıtlanan boyutlar için değer döner — eksik boyutlar mevcut DISC verisini korur.
 */
export async function scoreSjtAnswers(answers: SjtAnswer[]): Promise<Partial<OceanVector>> {
  if (!Array.isArray(answers) || answers.length === 0) return {};

  const codes = [...new Set(answers.map((a) => a.questionCode))];
  const questions = await prisma.sjtQuestion.findMany({
    where: { code: { in: codes }, isActive: true },
    include: { options: true },
  });

  const byCode = new Map(questions.map((q) => [q.code, q]));
  const sum: Record<OceanKey, number> = { o: 0, c: 0, e: 0, a: 0, n: 0 };
  const hits: Record<OceanKey, number> = { o: 0, c: 0, e: 0, a: 0, n: 0 };

  for (const ans of answers) {
    const q = byCode.get(ans.questionCode);
    if (!q) continue;

    const findOption = (key?: string) => q.options.find((o) => o.key === key);

    if (q.answerFormat === 'SINGLE') {
      const opt = findOption(ans.optionKey);
      if (opt) accumulate(parseWeights(opt.weights), 1.0, sum, hits);
    } else {
      const mostOpt = findOption(ans.mostKey);
      if (mostOpt) accumulate(parseWeights(mostOpt.weights), 1.0, sum, hits);

      if (ans.leastKey && ans.leastKey !== ans.mostKey) {
        const leastOpt = findOption(ans.leastKey);
        if (leastOpt) accumulate(parseWeights(leastOpt.weights), -0.5, sum, hits);
      }
    }
  }

  const result: Partial<OceanVector> = {};
  for (const key of OCEAN_KEYS) {
    if (hits[key] === 0) continue;
    const raw = 50 + ((sum[key] / hits[key]) / 3) * 50;
    result[key] = Math.max(0, Math.min(100, Math.round(raw * 100) / 100));
  }
  return result;
}
