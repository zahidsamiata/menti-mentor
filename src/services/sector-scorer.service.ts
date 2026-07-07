import type { UserProfile } from '@prisma/client';
import { computeTaxonomyProximity } from './taxonomy.service.js';
import type { RankedMentor, CertData } from './scoring.service.js';
import { rankMentorsForMenti } from './scoring.service.js';

// Bileşen ağırlıkları (toplam = 1.00)
const W = { A: 0.30, B: 0.25, C: 0.25, D: 0.15, E: 0.05 } as const;

// ── Bileşen B: Asimetrik Beceri Kapsama ─────────────────────────────────────
// Payda = mentiSkills.length (menti ne öğrenmek istiyor)
// Mentor etiketleri ne kadar mentiyi "karşılıyor"?
function componentB(mentorSkills: string[], mentiSkills: string[]): number {
  if (mentiSkills.length === 0) return 0;
  const mentorSet = new Set(mentorSkills.map(s => s.toLowerCase()));
  return mentiSkills.filter(s => mentorSet.has(s.toLowerCase())).length / mentiSkills.length;
}

// ── Bileşen C: Hedef-Uzmanlık Uyumu ─────────────────────────────────────────
// Menti'nin hedef etiketleri, mentorun beceri setine ne kadar düşüyor?
function componentC(mentorSkills: string[], mentiGoals: string[]): number {
  if (mentiGoals.length === 0) return 0;
  const mentorSet = new Set(mentorSkills.map(s => s.toLowerCase()));
  return mentiGoals.filter(g => mentorSet.has(g.toLowerCase())).length / mentiGoals.length;
}

// ── Bileşen D: Kıdem Çan Eğrisi ──────────────────────────────────────────────
// Tatlı nokta: 3-8 yıl, Gaussian μ=5.5 yıl, σ=3.0
// yearsExp=null → medyan varsayımı 0.5 (adil null toleransı)
function componentD(mentorYearsExp: number | null): number {
  if (mentorYearsExp === null) return 0.5;
  const mu = 5.5;
  const sigma = 3.0;
  return Math.exp(-((mentorYearsExp - mu) ** 2) / (2 * sigma ** 2));
}

// ── Bileşen E: Bağlam Bonusu ─────────────────────────────────────────────────
// Ortak okul (%40) + ortak şirket (%35) + ortak topluluk (%25)
// Payda = menti listesi uzunluğu (asimetrik — mentiyi ön planda tut)
function componentE(
  mentorSchools: string[], mentiSchools: string[],
  mentorCompanies: string[], mentiCompanies: string[],
  mentorCommunities: string[], mentiCommunities: string[],
): number {
  const overlap = (a: string[], b: string[]): number => {
    if (b.length === 0) return 0;
    const set = new Set(a.map(x => x.toLowerCase()));
    return b.filter(x => set.has(x.toLowerCase())).length / b.length;
  };
  return Math.min(
    1,
    overlap(mentorSchools, mentiSchools) * 0.40 +
    overlap(mentorCompanies, mentiCompanies) * 0.35 +
    overlap(mentorCommunities, mentiCommunities) * 0.25,
  );
}

/**
 * Nihai sektör skoru (0-100 ölçeği).
 * scoring.service.ts içindeki sectorScore sözleşmesiyle uyumludur.
 *
 * A (taksonomi yakınlığı) × 0.30
 * B (beceri kapsama)      × 0.25
 * C (hedef-uzmanlık)      × 0.25
 * D (kıdem çan eğrisi)    × 0.15
 * E (bağlam bonusu)       × 0.05
 */
export async function resolveSectorScore(
  mentor: UserProfile,
  menti: UserProfile,
): Promise<number> {
  const [a, b, c, d, e] = await Promise.all([
    computeTaxonomyProximity(mentor.industryCode, menti.industryCode),
    Promise.resolve(componentB(mentor.skillTags, menti.skillTags)),
    Promise.resolve(componentC(mentor.skillTags, menti.goalTags)),
    Promise.resolve(componentD(mentor.yearsExp)),
    Promise.resolve(componentE(
      mentor.schools,      menti.schools,
      mentor.companies,    menti.companies,
      mentor.communities,  menti.communities,
    )),
  ]);

  const raw = W.A * a + W.B * b + W.C * c + W.D * d + W.E * e;
  return Math.round(raw * 1000) / 10; // 0-100, 1 ondalık hassasiyet
}

// ── Plug-and-play entegrasyon fonksiyonu ─────────────────────────────────────
//
// rankMentorsForMenti'nin sectorScoreResolver parametresi senkron olduğundan,
// async taksonomi sorguları önce toplu (paralel) hesaplanır, ardından Map
// üzerinden senkron resolver'a dönüştürülür.
//
// Kullanım (controller veya matching servisi içinde):
//
//   import { rankMentorsWithSectorScore } from './sector-scorer.service.js';
//
//   const ranked = await rankMentorsWithSectorScore(mentiProfile, mentorProfiles);

export async function rankMentorsWithSectorScore(
  menti: UserProfile,
  mentors: UserProfile[],
  certDataMap: Map<string, CertData>,
): Promise<RankedMentor[]> {
  const scores = new Map<string, number>();
  await Promise.all(
    mentors.map(async (m) => {
      scores.set(m.id, await resolveSectorScore(m, menti));
    }),
  );
  return rankMentorsForMenti(menti, mentors, (mentor) => scores.get(mentor.id) ?? 0, certDataMap);
}
