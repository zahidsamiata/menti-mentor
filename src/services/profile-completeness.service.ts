import { prisma } from '../db.js';

const CORE_BASE        = 60;
const CONTRIB_FOLLOWUP = 5;
const CONTRIB_FEEDBACK = 2;
const MAX_PERCENT      = 98;

function isCoreComplete(p: {
  archetype: string | null;
  industryCode: string | null;
  skillTags: string[];
}): boolean {
  return (
    !!p.archetype &&
    !!p.industryCode &&
    Array.isArray(p.skillTags) &&
    p.skillTags.length > 0
  );
}

export interface CompletenessResult {
  percent: number;
  coreComplete: boolean;
  followupCount: number;
  feedbackCount: number;
  remainingHint: string;
}

export async function computeProfileCompleteness(
  userId: string,
  tenantId: string,
): Promise<CompletenessResult> {
  // UserProfile'da doğrudan tenantId yoktur; user ilişkisi üzerinden izolasyon sağlanır.
  const profile = await prisma.userProfile.findFirst({
    where:  { userId, user: { tenantId } },
    select: { id: true, archetype: true, industryCode: true, skillTags: true, profileSource: true },
  });
  if (!profile) throw new Error(`UserProfile not found: ${userId}`);

  const coreComplete = isCoreComplete(profile);

  // SJT tabanlı derinleştirici soru yanıtı sayısı.
  // answeredFollowup tablosu henüz şemada yoksa profileSource'a göre tahmin yap.
  let realFollowupCount = 0;
  try {
    realFollowupCount =
      (await (prisma as any).answeredFollowup?.count({ where: { userId } })) || 0;
  } catch {
    realFollowupCount = profile.profileSource === 'HYBRID' ? 1 : 0;
  }

  const feedbackCount = await prisma.matchFeedback.count({ where: { fromUserId: userId } });

  let percent = coreComplete ? CORE_BASE : Math.round(CORE_BASE * 0.5);
  percent += realFollowupCount * CONTRIB_FOLLOWUP;
  percent += feedbackCount    * CONTRIB_FEEDBACK;
  percent = Math.min(MAX_PERCENT, Math.max(0, Math.round(percent)));

  let remainingHint: string;
  if (!coreComplete) {
    remainingHint = 'Temel profilini tamamla, eşleşmeye başla';
  } else if (percent < 80) {
    remainingHint = 'Birkaç kısa soru daha, eşleşmen keskinleşsin';
  } else if (percent < MAX_PERCENT) {
    remainingHint = 'Neredeyse tamam! Görüşmelerini değerlendir';
  } else {
    remainingHint = 'Profilin çok güçlü 💪';
  }

  return { percent, coreComplete, followupCount: realFollowupCount, feedbackCount, remainingHint };
}
