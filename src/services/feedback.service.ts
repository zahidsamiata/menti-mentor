import type { Checkpoint, UserRole } from '@prisma/client';
import { prisma } from '../db.js';

/** Geri bildirim yetki hatası — controller HTTP durumuna map'ler (CertTopicError deseni). */
export class FeedbackAuthError extends Error {
  constructor(
    public code: 'MATCH_NOT_FOUND' | 'NOT_MATCH_PARTY',
    message: string,
  ) {
    super(message);
    this.name = 'FeedbackAuthError';
  }
}

export interface FeedbackInput {
  matchId: string;
  tenantId: string;        // Zorunlu: eşleşmenin tenant sahipliğini doğrulamak için
  checkpoint: Checkpoint;
  fromUserId: string;      // Zorunlu: OTURUMDAN (req.auth.userId) — istek gövdesinden ALINMAZ
  role: UserRole;          // Zorunlu: TenantMembership.role — istek gövdesinden ALINMAZ
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

  // Eşleşmenin bu tenant'a ait olduğunu doğrula (MatchFeedback'te doğrudan tenantId yok).
  // Match.mentorId/mentiId UserProfile.id tutar (scoring.service.ts), kimlik karşılaştırması
  // User.id üzerinden yapılmalı → ilişki üzerinden userId seçilir.
  const match = await prisma.match.findFirst({
    where: { id: input.matchId, tenantId: input.tenantId },
    select: {
      id: true,
      mentor: { select: { userId: true } },
      menti:  { select: { userId: true } },
    },
  });
  if (!match) {
    throw new FeedbackAuthError(
      'MATCH_NOT_FOUND',
      'Eşleşme bulunamadı veya bu tenant\'a ait değil.',
    );
  }

  // SAHİPLİK (güvenlik): tenant kontrolü tek başına YETMEZ — aynı kurumdaki herhangi biri
  // tanımadığı iki kişinin eşleşmesine geri bildirim yazabiliyor, gerçek geri bildirimin
  // üzerine basabiliyor ve earlyExit ile ilişkiyi bitirebiliyordu. Yalnız eşleşmenin TARAFI.
  const isParty =
    match.mentor.userId === input.fromUserId || match.menti.userId === input.fromUserId;
  if (!isParty) {
    throw new FeedbackAuthError(
      'NOT_MATCH_PARTY',
      'Yalnızca eşleşmenin tarafı bu eşleşme için geri bildirim verebilir.',
    );
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
