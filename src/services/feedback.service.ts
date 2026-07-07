import type { Checkpoint, UserRole } from '@prisma/client';
import { prisma } from '../db.js';

export interface FeedbackInput {
  matchId: string;
  tenantId: string;        // Zorunlu: eşleşmenin tenant sahipliğini doğrulamak için
  checkpoint: Checkpoint;
  fromUserId: string;
  role: UserRole;
  progressScore?: number;
  rapportScore?: number;
  earlyExit?: boolean;
  comment?: string;
}

function isValidScore(score: number | undefined): boolean {
  return score === undefined || (score >= 1 && score <= 5);
}

export async function submitFeedback(input: FeedbackInput) {
  if (!isValidScore(input.progressScore) || !isValidScore(input.rapportScore)) {
    throw new Error('Puanlar 1 ile 5 arasında olmalıdır.');
  }

  // Eşleşmenin bu tenant'a ait olduğunu doğrula (MatchFeedback'te doğrudan tenantId yok)
  const match = await prisma.match.findFirst({
    where: { id: input.matchId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!match) {
    throw new Error('Eşleşme bulunamadı veya bu tenant\'a ait değil.');
  }

  const feedback = await prisma.matchFeedback.upsert({
    where: {
      matchId_checkpoint_fromUserId: {
        matchId: input.matchId,
        checkpoint: input.checkpoint,
        fromUserId: input.fromUserId,
      },
    },
    update: {
      progressScore: input.progressScore,
      rapportScore:  input.rapportScore,
      earlyExit:     input.earlyExit ?? false,
      comment:       input.comment,
    },
    create: {
      matchId:       input.matchId,
      checkpoint:    input.checkpoint,
      fromUserId:    input.fromUserId,
      role:          input.role,
      progressScore: input.progressScore,
      rapportScore:  input.rapportScore,
      earlyExit:     input.earlyExit ?? false,
      comment:       input.comment,
    },
  });

  if (input.earlyExit) {
    // updateMany: tenantId filtresi ile — update tekil PK'dan daha güvenli
    await prisma.match.updateMany({
      where: { id: input.matchId, tenantId: input.tenantId },
      data:  { status: 'EARLY_EXIT' },
    });
  }

  return feedback;
}

export async function findMatchesDueForCheckpoint(checkpoint: Checkpoint) {
  // Bu fonksiyon cron job tarafından çağrılır — istek bağlamı yoktur.
  // Tüm tenant'ları kapsar (runWithTenant dışında, RLS uygulanmaz — kasıtlı tasarım).
  const dayOffset: Record<Checkpoint, number> = {
    DAY_3:  3,
    DAY_14: 14,
    DAY_30: 30,
  };

  const offset = dayOffset[checkpoint];
  const upperBound = new Date();
  upperBound.setDate(upperBound.getDate() - offset);

  const lowerBound = new Date(upperBound);
  lowerBound.setDate(lowerBound.getDate() - 1);

  return prisma.match.findMany({
    where: {
      status: 'ACTIVE',
      createdAt: { gte: lowerBound, lte: upperBound },
      feedbacks: { none: { checkpoint } },
    },
    include: {
      mentor: true,
      menti:  true,
    },
  });
}
