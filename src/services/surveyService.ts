/**
 * AN-52-2 — Ürün-içi otomatik geri bildirim anketi: pending sorgu + cevap/kapatma yazma.
 *
 * Kimlik OTURUMDAN alınır (controller req.auth.userId geçirir) — istek gövdesinden DEĞİL
 * (Komşu Uç Karşılaştırması, CLAUDE.md § Güvenlik). Tenant izolasyonu: her satır tenantId
 * taşır, ama gerçek erişim sınırı zaten userId (bir kullanıcı yalnız KENDİ cevabını yazar/görür).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import {
  getSurveyQuestionByContext,
  getSurveyQuestionByKey,
  type SurveyOption,
  type SurveyRole,
} from './surveyQuestions.js';

export class SurveyQuestionUnknownError extends Error {
  constructor() {
    super('Bilinmeyen anket sorusu');
    this.name = 'SurveyQuestionUnknownError';
  }
}

export class SurveyRoleNotEligibleError extends Error {
  constructor() {
    super('Bu rol bu soruyu cevaplayamaz');
    this.name = 'SurveyRoleNotEligibleError';
  }
}

export class SurveyInvalidAnswerError extends Error {
  constructor() {
    super('Geçersiz şık');
    this.name = 'SurveyInvalidAnswerError';
  }
}

/** "1 kez kuralı" (§2) ihlali — soru bu kullanıcı için zaten cevaplanmış ya da kapatılmış. */
export class SurveyAlreadyAnsweredError extends Error {
  constructor() {
    super('Bu soru daha önce cevaplandı ya da kapatıldı');
    this.name = 'SurveyAlreadyAnsweredError';
  }
}

export type PendingSurveyQuestion = {
  questionKey: string;
  text: string;
  options: readonly SurveyOption[];
};

function isEligibleRole(roles: readonly SurveyRole[], role: 'ADMIN' | 'MENTOR' | 'MENTI'): boolean {
  return (roles as readonly string[]).includes(role);
}

/**
 * Kullanıcının verilen tetikleyici bağlam (§2 tablosu) için görebileceği soruyu döner.
 * Eleme sırası: bağlam bilinmiyor → null · rol uygun değil → null · daha önce bu kullanıcı
 * için bir satır açılmış (cevaplanmış YA DA kapatılmış, ikisi de "gösterme" anlamına gelir) → null.
 */
export async function getPendingSurveyQuestion(
  userId: string,
  role: 'ADMIN' | 'MENTOR' | 'MENTI',
  triggerContext: string,
): Promise<PendingSurveyQuestion | null> {
  const question = getSurveyQuestionByContext(triggerContext);
  if (!question) return null;
  if (!isEligibleRole(question.roles, role)) return null;

  const existing = await prisma.productSurveyResponse.findUnique({
    where: { userId_questionKey: { userId, questionKey: question.questionKey } },
    select: { id: true },
  });
  if (existing) return null;

  return { questionKey: question.questionKey, text: question.text, options: question.options };
}

export type RespondToSurveyInput = {
  userId: string;
  tenantId: string;
  role: 'ADMIN' | 'MENTOR' | 'MENTI';
  questionKey: string;
  /** null/undefined = yalnız kapatıldı (X), cevaplanmadı. */
  answerKey: string | null;
};

export type SurveyResponseResult = {
  id: string;
  questionKey: string;
  answerKey: string | null;
  respondedAt: Date | null;
  dismissedAt: Date | null;
};

/** POST /api/surveys/:questionKey/respond iş mantığı — cevap YA DA kapatma yazar. */
export async function respondToSurvey(input: RespondToSurveyInput): Promise<SurveyResponseResult> {
  const question = getSurveyQuestionByKey(input.questionKey);
  if (!question) throw new SurveyQuestionUnknownError();
  if (!isEligibleRole(question.roles, input.role)) throw new SurveyRoleNotEligibleError();
  if (input.answerKey !== null && !question.options.some((o) => o.key === input.answerKey)) {
    throw new SurveyInvalidAnswerError();
  }

  const now = new Date();
  try {
    return await prisma.productSurveyResponse.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        questionKey: input.questionKey,
        answerKey: input.answerKey,
        respondedAt: input.answerKey !== null ? now : null,
        dismissedAt: input.answerKey === null ? now : null,
      },
      select: { id: true, questionKey: true, answerKey: true, respondedAt: true, dismissedAt: true },
    });
  } catch (err) {
    // @@unique([userId, questionKey]) ihlali → "1 kez kuralı" zaten uygulanmış
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SurveyAlreadyAnsweredError();
    }
    throw err;
  }
}
