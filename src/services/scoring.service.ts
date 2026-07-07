import type { UserProfile, UserRole } from '@prisma/client';
import { prisma } from '../db.js';
import { discToOcean, deriveArchetype, mergeWithSjt } from './disc-to-ocean.adapter.js';
import {
  type OceanVector,
  BLOCKED_PAIRS,
  COMPATIBILITY_MATRIX,
  NEUTRAL_SCORE,
  WEIGHTS,
} from './scoring.config.js';

export type MatchReason = 'OK' | 'HARD_CONSTRAINT_VIOLATION';

const MULTIPLIER_MIN = 0.7;
const MULTIPLIER_MAX = 1.15;
const clampMultiplier = (m: number): number =>
  Math.max(MULTIPLIER_MIN, Math.min(MULTIPLIER_MAX, m));

// Tenant-başına sertifikasyon verisi (TenantMembership'ten okunur).
export interface CertData {
  isCertified: boolean;
  qualityMultiplier: number;
}

export interface MatchResult {
  eligible: boolean;
  score: number | null;
  sectorScore: number;
  characterScore: number | null;
  mentorArchetype: string;
  mentiArchetype: string;
  reason: MatchReason;
}

export function isHardBlocked(mentorArchetype: string, mentiArchetype: string): boolean {
  return BLOCKED_PAIRS[mentorArchetype]?.includes(mentiArchetype) ?? false;
}

export function getCharacterScore(mentorArchetype: string, mentiArchetype: string): number {
  const key = `${mentorArchetype}_${mentiArchetype}`;
  return COMPATIBILITY_MATRIX[key] ?? NEUTRAL_SCORE;
}

/**
 * Final formül: (0.60 × sektörSkoru + 0.40 × karakterSkoru) × clamp(qualityMultiplier, 0.7–1.15)
 * Hard-gate: BLOCKED_PAIRS'teki çiftler için skor hesaplanmadan eligible=false döner.
 */
export function calculateMatchScore(
  mentorArchetype: string,
  mentiArchetype: string,
  sectorScore: number,
  qualityMultiplier = 1.0,
): MatchResult {
  if (isHardBlocked(mentorArchetype, mentiArchetype)) {
    return {
      eligible: false,
      score: null,
      sectorScore,
      characterScore: null,
      mentorArchetype,
      mentiArchetype,
      reason: 'HARD_CONSTRAINT_VIOLATION',
    };
  }

  const characterScore = getCharacterScore(mentorArchetype, mentiArchetype);
  const base  = WEIGHTS.SECTOR * sectorScore + WEIGHTS.CHARACTER * characterScore;
  const total = base * clampMultiplier(qualityMultiplier);

  return {
    eligible: true,
    score: Math.round(total * 100) / 100,
    sectorScore,
    characterScore,
    mentorArchetype,
    mentiArchetype,
    reason: 'OK',
  };
}

export async function computeAndStoreProfile(
  userId: string,
  role: UserRole,
  tenantId: string,
  sjtOverrides?: Partial<OceanVector>,
): Promise<UserProfile> {
  const profile = await prisma.userProfile.findFirst({
    where: { userId, user: { tenantId } },
  });
  if (!profile) throw new Error(`UserProfile bulunamadı: ${userId}`);

  const discDerived = discToOcean({
    d: profile.discD,
    i: profile.discI,
    s: profile.discS,
    c: profile.discC,
  });
  const ocean = sjtOverrides ? mergeWithSjt(discDerived, sjtOverrides) : discDerived;
  const archetype = deriveArchetype(ocean, role);
  const profileSource =
    sjtOverrides && Object.keys(sjtOverrides).length > 0 ? 'HYBRID' : 'DISC_DERIVED';

  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      oceanO: ocean.o,
      oceanC: ocean.c,
      oceanE: ocean.e,
      oceanA: ocean.a,
      oceanN: ocean.n,
      archetype,
      archetypeRole: role,
      profileSource,
    },
  });
}

export async function createMatchIfEligible(
  mentorProfile: UserProfile,
  mentiProfile: UserProfile,
  sectorScore: number,
  tenantId: string,
  qualityMultiplier = 1.0,  // TenantMembership'ten alınmalı
): Promise<MatchResult & { matchId?: string }> {
  if (!mentorProfile.archetype || !mentiProfile.archetype) {
    throw new Error('Arketipler eşleşme öncesinde hesaplanmış olmalıdır.');
  }

  const result = calculateMatchScore(
    mentorProfile.archetype,
    mentiProfile.archetype,
    sectorScore,
    qualityMultiplier,
  );
  if (!result.eligible) return result;

  const match = await prisma.match.create({
    data: {
      mentorId: mentorProfile.id,
      mentiId: mentiProfile.id,
      predictedScore: result.score!,
      sectorScore: result.sectorScore,
      characterScore: result.characterScore!,
      mentorArchetype: result.mentorArchetype,
      mentiArchetype: result.mentiArchetype,
      tenantId,
    },
  });

  return { ...result, matchId: match.id };
}

export interface RankedMentor extends MatchResult {
  mentorProfileId: string;
  mentorUserId: string;
}

/**
 * Mentörler için sıralama.
 *
 * certDataMap: userId → { isCertified, qualityMultiplier }
 *   TenantMembership'ten okunmalıdır — UserProfile'daki cert alanları kullanılmaz.
 *   Sertifikasız mentör (isCertified=false veya map'te yok) tamamen elenir.
 */
export function rankMentorsForMenti(
  menti: UserProfile,
  mentors: UserProfile[],
  sectorScoreResolver: (mentor: UserProfile, menti: UserProfile) => number,
  certDataMap: Map<string, CertData>,
): RankedMentor[] {
  const ranked: RankedMentor[] = [];

  for (const mentor of mentors) {
    if (!mentor.archetype || !menti.archetype) continue;

    const certData = certDataMap.get(mentor.userId);
    if (!certData?.isCertified) continue;      // sertifikasız → elenir

    const result = calculateMatchScore(
      mentor.archetype,
      menti.archetype,
      sectorScoreResolver(mentor, menti),
      certData.qualityMultiplier,              // TenantMembership'ten
    );

    if (result.eligible) {
      ranked.push({ ...result, mentorProfileId: mentor.id, mentorUserId: mentor.userId });
    }
  }

  return ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
