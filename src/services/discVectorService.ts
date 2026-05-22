import { prisma } from '../db.js';
import type { DiscVector } from './scoring.js';

// Kullanıcının confidence'ı 1.0'a ulaşması için gereken yanıt sayısı hedefi.
const CONFIDENCE_TARGET = 20;

// Boyuta göre yanıtları normalize edip ağırlıklı vektör üretir, DB'e yazar.
export async function recalcDiscVector(userId: string): Promise<DiscVector> {
  const responses = await prisma.userResponse.findMany({
    where: { userId },
    include: { question: { select: { discDimension: true } } },
  });

  const buckets: Record<'D' | 'I' | 'S' | 'C', number[]> = { D: [], I: [], S: [], C: [] };
  let dimensionalCount = 0;

  for (const r of responses) {
    const dim = r.question.discDimension;
    if (dim === 'GENERAL') continue;
    const normalized = (r.value - 1) / 4; // 1-5 → 0-1
    buckets[dim as 'D' | 'I' | 'S' | 'C'].push(normalized);
    dimensionalCount++;
  }

  // Boyut ortalamaları — veri yoksa eşit dağılım (0.25)
  const raw = {
    D: buckets.D.length > 0 ? avg(buckets.D) : 0.25,
    I: buckets.I.length > 0 ? avg(buckets.I) : 0.25,
    S: buckets.S.length > 0 ? avg(buckets.S) : 0.25,
    C: buckets.C.length > 0 ? avg(buckets.C) : 0.25,
  };

  // Toplamı 1'e normalize et
  const sum = raw.D + raw.I + raw.S + raw.C;
  const vector: DiscVector = {
    D: round(raw.D / sum),
    I: round(raw.I / sum),
    S: round(raw.S / sum),
    C: round(raw.C / sum),
    confidence: Math.min(1, round(dimensionalCount / CONFIDENCE_TARGET)),
  };

  await prisma.user.update({
    where: { id: userId },
    data: { discVector: vector as object },
  });

  return vector;
}

export async function getDiscVector(userId: string): Promise<DiscVector | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { discVector: true },
  });
  if (!user?.discVector) return null;
  return user.discVector as unknown as DiscVector;
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
