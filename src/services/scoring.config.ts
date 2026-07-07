// ============================================================
// Pilot veri biriktikçe SADECE bu dosyayı güncelleyeceksiniz.
// İş mantığı (adapter, servis) bu sabitlere bağımlıdır.
// ============================================================

export type OceanKey = 'o' | 'c' | 'e' | 'a' | 'n';

export interface DiscVector {
  d: number;
  i: number;
  s: number;
  c: number;
}

export interface OceanVector {
  o: number;
  c: number;
  e: number;
  a: number;
  n: number;
}

export const DISC_TO_OCEAN_WEIGHTS: Record<OceanKey, DiscVector> = {
  o: { d: 0.1,  i: 0.4,  s: -0.3, c: -0.2 },
  c: { d: 0.3,  i: -0.1, s: 0.1,  c: 0.6  },
  e: { d: 0.4,  i: 0.6,  s: -0.2, c: -0.3 },
  a: { d: -0.5, i: 0.2,  s: 0.5,  c: -0.1 },
  n: { d: -0.2, i: -0.1, s: -0.4, c: 0.1  },
};

export const ARCHETYPE_THRESHOLDS = { HIGH: 60, MID: 55, LOW: 45 } as const;

export const BLOCKED_PAIRS: Record<string, string[]> = {
  M4: ['m3'],
  M1: ['m4'],
};

export const COMPATIBILITY_MATRIX: Record<string, number> = {
  M1_m2: 100, M1_m3: 100, M2_m1: 100, M2_m4: 100,
  M3_m2: 100, M4_m1: 100, M4_m4: 100,
  M1_m1: 60,  M2_m2: 60,  M2_m3: 60,
  M3_m1: 60,  M3_m4: 60,  M4_m2: 60,
  M3_m3: 30,
};

export const NEUTRAL_SCORE = 50;

export const WEIGHTS = { SECTOR: 0.6, CHARACTER: 0.4 } as const;
