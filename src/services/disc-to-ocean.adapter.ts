import type { UserRole } from '@prisma/client';
import {
  type DiscVector,
  type OceanKey,
  type OceanVector,
  ARCHETYPE_THRESHOLDS,
  DISC_TO_OCEAN_WEIGHTS,
} from './scoring.config.js';

const clamp = (x: number): number => Math.max(0, Math.min(100, x));

export function discToOcean(disc: DiscVector): OceanVector {
  const project = (key: OceanKey): number => {
    const w = DISC_TO_OCEAN_WEIGHTS[key];
    const raw = w.d * disc.d + w.i * disc.i + w.s * disc.s + w.c * disc.c;
    return clamp(50 + (50 * raw) / 100);
  };
  return {
    o: project('o'),
    c: project('c'),
    e: project('e'),
    a: project('a'),
    n: project('n'),
  };
}

export function deriveArchetype(ocean: OceanVector, role: UserRole): string {
  const { HIGH, MID, LOW } = ARCHETYPE_THRESHOLDS;

  if (role === 'MENTOR') {
    if (ocean.c > HIGH && ocean.o > HIGH) return 'M1';
    if (ocean.o > HIGH && ocean.e > HIGH) return 'M2';
    if (ocean.c > HIGH && ocean.a < LOW)  return 'M4';
    if (ocean.a > HIGH)                   return 'M3';
    return 'M1';
  }

  if (ocean.a > MID  && ocean.n > MID)  return 'm3';
  if (ocean.e > HIGH && ocean.a < LOW)  return 'm4';
  if (ocean.o > HIGH && ocean.c < LOW)  return 'm2';
  if (ocean.c > HIGH && ocean.o < MID)  return 'm1';
  return 'm1';
}

export function mergeWithSjt(
  discDerived: OceanVector,
  sjtOverrides: Partial<OceanVector>,
): OceanVector {
  return {
    o: sjtOverrides.o ?? discDerived.o,
    c: sjtOverrides.c ?? discDerived.c,
    e: sjtOverrides.e ?? discDerived.e,
    a: sjtOverrides.a ?? discDerived.a,
    n: sjtOverrides.n ?? discDerived.n,
  };
}
