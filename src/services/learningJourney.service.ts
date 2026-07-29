/**
 * Öğrenme Yolculuğu (Learning Journey) iş mantığı.
 *
 * KEŞİF motoru — "sınav" DEĞİL: puanlama / geçme-kalma / engelleme YOK.
 * Mekanik: durum → seçenekler → seçim → outcome (rozet) + feedback (öğreti).
 * Sertifikasyon (certification.service.ts) puanlama motorundan TAMAMEN ayrıdır;
 * ortak tablo/skor paylaşılmaz.
 *
 * Veri modeli Question/QuestionHide desenini aynalar:
 *   - LearningStage.tenantId = null  → global çekirdek aşama (KİLİTLİ)
 *   - LearningStage.tenantId = <id>  → tenant-özel aşama (düzenlenebilir)
 *   - LearningStageHide              → tenant, global aşamayı gizler (silmez)
 */

import { prisma } from '../db.js';
import type { LearningAudience } from '@prisma/client';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export type StageOutcome = 'correct' | 'warn' | 'wrong';

/** Bir aşamanın tek seçeneği (DB'de choices JSON dizisinin elemanı). PUAN YOK. */
export interface StageChoice {
  key: string;
  label: string;
  outcome: StageOutcome;
  feedback: string;
}

/** Oyuncuya (menti/mentör) gösterilen seçenek — cevap anahtarı (outcome/feedback) gizli. */
export interface PublicStageChoice {
  key: string;
  label: string;
}

/** Oyuncuya gösterilen aşama — seçenek etiketleri var, outcome/feedback yok. */
export interface PublicStage {
  id: string;
  order: number;
  title: string;
  situationText: string;
  learningGoal: string;
  isStkSpecific: boolean;
  choices: PublicStageChoice[];
}

/** Bir seçimin sonucu — keşif geri bildirimi. */
export interface ChoiceResult {
  key: string;
  outcome: StageOutcome;
  feedback: string;
}

// ─── Yolculuk çerçeve metinleri (UI: giriş + kapanış) ────────────────────────
// Kapanış metinleri içerik kaynağından birebir alınmıştır (uydurma yok).

export const LEARNING_JOURNEY_FRAME: Record<
  LearningAudience,
  { journeyTitle: string; intro: string; closing: string }
> = {
  MENTOR: {
    journeyTitle: 'İlk Mentinle Tanışma',
    intro:
      'Bu bir sınav değil, bir keşif. Burada doğru-yanlış yok; her seçim bir öğrenme anı. ' +
      'Zeynep’le tanışacak, mentörlüğün inceliklerini birlikte keşfedeceksin. Kendine en yakın olanı seç.',
    closing:
      'Zeynep’le ilk yolculuğunu tamamladın. Fark ettin mi — iyi bir mentör cevap veren değil, ' +
      'yol açandır. Yargılamadan dinler, sınırını korur, ve karşısındakinin kendi gücünü bulmasına ' +
      'yardım eder. Artık kendi mentinle bu yolculuğa hazırsın.',
  },
  MENTI: {
    journeyTitle: 'İlk Mentörünle Yolculuk',
    intro:
      'Bu bir sınav değil, bir keşif. Burada doğru-yanlış yok; her seçim bir öğrenme anı. ' +
      'Deniz’le tanışacak, iyi bir mentinin nasıl davrandığını birlikte keşfedeceksin. Kendine en yakın olanı seç.',
    closing:
      'Deniz’le yolculuğunu tamamladın. Gördün mü — iyi bir menti, rehberliği bekleyen değil, ' +
      'onu en iyi kullanan kişidir. Soru sorar, sahiplenir, saygı gösterir ve topluluğun parçası olur. ' +
      'Artık kendi mentorluk yolculuğuna hazırsın.',
  },
};

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

/** Rol → yolculuk audience'ı. ADMIN'in oynanacak yolculuğu yoktur. */
export function audienceForRole(role: string): LearningAudience | null {
  if (role === 'MENTOR') return 'MENTOR';
  if (role === 'MENTI') return 'MENTI';
  return null;
}

/**
 * choices JSON alanını güvenle StageChoice[]'e çevirir.
 * Bozuk/eksik veriyi düşürür — hata mesajı iç detay sızdırmaz.
 */
export function parseChoices(raw: unknown): StageChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: StageChoice[] = [];
  for (const c of raw) {
    if (
      c &&
      typeof c === 'object' &&
      typeof (c as StageChoice).key === 'string' &&
      typeof (c as StageChoice).label === 'string' &&
      typeof (c as StageChoice).feedback === 'string' &&
      ((c as StageChoice).outcome === 'correct' ||
        (c as StageChoice).outcome === 'warn' ||
        (c as StageChoice).outcome === 'wrong')
    ) {
      const v = c as StageChoice;
      out.push({ key: v.key, label: v.label, outcome: v.outcome, feedback: v.feedback });
    }
  }
  return out;
}

// ─── Aşama listesi (oyuncu) ──────────────────────────────────────────────────

/**
 * Bir audience için tenant'a görünür aşamaları sırayla döner.
 * Global (tenantId=null) + tenant-özel; tenant tarafından gizlenenler hariç.
 * Cevap anahtarı (outcome/feedback) oyuncuya DÖNMEZ — keşif akışı.
 */
export async function buildStageList(
  tenantId: string,
  audience: LearningAudience,
): Promise<PublicStage[]> {
  const hidden = await prisma.learningStageHide.findMany({
    where: { tenantId },
    select: { stageId: true },
  });
  const hiddenSet = new Set(hidden.map((h) => h.stageId));

  const stages = await prisma.learningStage.findMany({
    where: {
      audience,
      isActive: true,
      OR: [{ tenantId: null }, { tenantId }],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      order: true,
      title: true,
      situationText: true,
      learningGoal: true,
      isStkSpecific: true,
      choices: true,
    },
  });

  return stages
    .filter((s) => !hiddenSet.has(s.id))
    .map((s) => ({
      id: s.id,
      order: s.order,
      title: s.title,
      situationText: s.situationText,
      learningGoal: s.learningGoal,
      isStkSpecific: s.isStkSpecific,
      choices: parseChoices(s.choices).map((c) => ({ key: c.key, label: c.label })),
    }));
}

/**
 * Tek bir seçimin sonucunu döner (outcome + feedback). PUAN YOK.
 * Aşamanın bu tenant'a görünür ve doğru audience'ta olduğunu doğrular (IDOR/izolasyon).
 * @returns ChoiceResult veya null (aşama/seçenek bulunamadı ya da erişim yok)
 */
export async function resolveChoice(
  tenantId: string,
  audience: LearningAudience,
  stageId: string,
  choiceKey: string,
): Promise<ChoiceResult | null> {
  const stage = await prisma.learningStage.findFirst({
    where: {
      id: stageId,
      audience,
      isActive: true,
      OR: [{ tenantId: null }, { tenantId }],
    },
    select: { id: true, choices: true },
  });
  if (!stage) return null;

  // Tenant global aşamayı gizlemişse erişilemez
  const isHidden = await prisma.learningStageHide.findUnique({
    where: { stageId_tenantId: { stageId, tenantId } },
    select: { id: true },
  });
  if (isHidden) return null;

  const choice = parseChoices(stage.choices).find((c) => c.key === choiceKey);
  if (!choice) return null;

  return { key: choice.key, outcome: choice.outcome, feedback: choice.feedback };
}

// ─── Tamamlama & durum ───────────────────────────────────────────────────────

/**
 * Yolculuğu tamamlandı olarak işaretler (rol bazlı, TenantMembership üzerinde).
 * İdempotent: zaten tamamlanmışsa mevcut anı korur.
 */
export async function markJourneyCompleted(
  userId: string,
  tenantId: string,
): Promise<{ completedAt: Date }> {
  const existing = await prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { learningJourneyCompletedAt: true },
  });

  if (existing?.learningJourneyCompletedAt) {
    return { completedAt: existing.learningJourneyCompletedAt };
  }

  const now = new Date();
  await prisma.tenantMembership.update({
    where: { userId_tenantId: { userId, tenantId } },
    data: { learningJourneyCompletedAt: now },
  });
  return { completedAt: now };
}

// ─── Yönetici (STK) CRUD ─────────────────────────────────────────────────────
// Kopya-üzerine-düzenle modeli (Question/QuestionHide ile aynı):
//   - Global (tenantId=null) aşamalar KİLİTLİ: düzenlenemez/silinemez, yalnızca
//     gizlenir ya da klonlanarak özelleştirilir.
//   - Tenant kendi aşamalarını (klon ya da sıfırdan) düzenler/siler/sıralar.

export interface AdminStageView {
  id: string;
  tenantId: string | null;
  audience: LearningAudience;
  order: number;
  title: string;
  situationText: string;
  learningGoal: string;
  authoringGuide: string | null;
  isStkSpecific: boolean;
  choices: StageChoice[];
  isActive: boolean;
  clonedFromId: string | null;
  /** Bu global aşama tenant tarafından gizlenmiş mi (yalnızca global kayıtlar için anlamlı). */
  isHidden: boolean;
}

export interface StageWriteInput {
  audience: LearningAudience;
  title: string;
  situationText: string;
  learningGoal: string;
  authoringGuide?: string | null;
  isStkSpecific?: boolean;
  order?: number;
  isActive?: boolean;
  choices: StageChoice[];
}

/**
 * Yöneticiye global + tenant-özel aşamaları (tam içerik + gizleme durumu) döner.
 * learningGoal ve authoringGuide UI'da öne çıkarılır.
 */
export async function listStagesForAdmin(
  tenantId: string,
  audience?: LearningAudience,
): Promise<AdminStageView[]> {
  const [stages, hides] = await Promise.all([
    prisma.learningStage.findMany({
      where: {
        isActive: true,
        ...(audience ? { audience } : {}),
        OR: [{ tenantId: null }, { tenantId }],
      },
      orderBy: [{ audience: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.learningStageHide.findMany({ where: { tenantId }, select: { stageId: true } }),
  ]);
  const hiddenSet = new Set(hides.map((h) => h.stageId));

  return stages.map((s) => ({
    id: s.id,
    tenantId: s.tenantId,
    audience: s.audience,
    order: s.order,
    title: s.title,
    situationText: s.situationText,
    learningGoal: s.learningGoal,
    authoringGuide: s.authoringGuide,
    isStkSpecific: s.isStkSpecific,
    choices: parseChoices(s.choices),
    isActive: s.isActive,
    clonedFromId: s.clonedFromId,
    isHidden: s.tenantId === null && hiddenSet.has(s.id),
  }));
}

/** Bir audience için tenant+global en yüksek order + 1 (yeni aşamayı sona ekler). */
async function nextOrder(tenantId: string, audience: LearningAudience): Promise<number> {
  const top = await prisma.learningStage.findFirst({
    where: { audience, OR: [{ tenantId: null }, { tenantId }] },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return (top?.order ?? -1) + 1;
}

/** Tenant'a ait yeni aşama oluşturur (sıfırdan). */
export async function createTenantStage(
  tenantId: string,
  input: StageWriteInput,
): Promise<AdminStageView> {
  const order = input.order ?? (await nextOrder(tenantId, input.audience));
  const created = await prisma.learningStage.create({
    data: {
      tenantId,
      audience: input.audience,
      order,
      title: input.title,
      situationText: input.situationText,
      learningGoal: input.learningGoal,
      authoringGuide: input.authoringGuide ?? null,
      isStkSpecific: input.isStkSpecific ?? false,
      choices: input.choices,
      isActive: input.isActive ?? true,
    },
  });
  return toAdminView(created);
}

/** Aşamanın tenant'a ait ve düzenlenebilir olduğunu doğrular. */
async function assertTenantOwned(
  tenantId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'GLOBAL_LOCKED' | 'FORBIDDEN' }> {
  const stage = await prisma.learningStage.findUnique({
    where: { id: stageId },
    select: { tenantId: true },
  });
  if (!stage) return { ok: false, code: 'NOT_FOUND' };
  if (stage.tenantId === null) return { ok: false, code: 'GLOBAL_LOCKED' };
  if (stage.tenantId !== tenantId) return { ok: false, code: 'FORBIDDEN' };
  return { ok: true };
}

/** Tenant kendi aşamasını günceller. Global aşamalar kilitlidir. */
export async function updateTenantStage(
  tenantId: string,
  stageId: string,
  patch: Partial<StageWriteInput>,
): Promise<{ ok: true; stage: AdminStageView } | { ok: false; code: 'NOT_FOUND' | 'GLOBAL_LOCKED' | 'FORBIDDEN' }> {
  const guard = await assertTenantOwned(tenantId, stageId);
  if (!guard.ok) return guard;

  const updated = await prisma.learningStage.update({
    where: { id: stageId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.situationText !== undefined ? { situationText: patch.situationText } : {}),
      ...(patch.learningGoal !== undefined ? { learningGoal: patch.learningGoal } : {}),
      ...(patch.authoringGuide !== undefined ? { authoringGuide: patch.authoringGuide } : {}),
      ...(patch.isStkSpecific !== undefined ? { isStkSpecific: patch.isStkSpecific } : {}),
      ...(patch.order !== undefined ? { order: patch.order } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.choices !== undefined ? { choices: patch.choices } : {}),
    },
  });
  return { ok: true, stage: toAdminView(updated) };
}

/**
 * Tenant kendi aşamasını siler. Aşama bir global klonuysa (clonedFromId dolu),
 * kaynak globalin gizlemesi de kaldırılır → "varsayılana dön".
 */
export async function deleteTenantStage(
  tenantId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'GLOBAL_LOCKED' | 'FORBIDDEN' }> {
  const stage = await prisma.learningStage.findUnique({
    where: { id: stageId },
    select: { tenantId: true, clonedFromId: true },
  });
  if (!stage) return { ok: false, code: 'NOT_FOUND' };
  if (stage.tenantId === null) return { ok: false, code: 'GLOBAL_LOCKED' };
  if (stage.tenantId !== tenantId) return { ok: false, code: 'FORBIDDEN' };

  await prisma.$transaction(async (tx) => {
    await tx.learningStage.delete({ where: { id: stageId } });
    if (stage.clonedFromId) {
      // Varsayılana dön: kaynak global aşamanın gizlemesini kaldır
      await tx.learningStageHide.deleteMany({
        where: { stageId: stage.clonedFromId, tenantId },
      });
    }
  });
  return { ok: true };
}

/**
 * Global bir aşamayı bu tenant'a klonlayarak özelleştirir + globali gizler.
 * İdempotent değil: zaten özelleştirilmişse 409 döner.
 */
export async function customizeGlobalStage(
  tenantId: string,
  stageId: string,
): Promise<
  | { ok: true; stage: AdminStageView }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_GLOBAL' | 'ALREADY_CUSTOMIZED' }
> {
  const global = await prisma.learningStage.findUnique({ where: { id: stageId } });
  if (!global) return { ok: false, code: 'NOT_FOUND' };
  if (global.tenantId !== null) return { ok: false, code: 'NOT_GLOBAL' };

  const alreadyHidden = await prisma.learningStageHide.findUnique({
    where: { stageId_tenantId: { stageId, tenantId } },
    select: { id: true },
  });
  if (alreadyHidden) return { ok: false, code: 'ALREADY_CUSTOMIZED' };

  const clone = await prisma.$transaction(async (tx) => {
    const created = await tx.learningStage.create({
      data: {
        tenantId,
        audience: global.audience,
        order: global.order,
        title: global.title,
        situationText: global.situationText,
        learningGoal: global.learningGoal,
        authoringGuide: global.authoringGuide,
        isStkSpecific: global.isStkSpecific,
        choices: global.choices as object,
        isActive: true,
        clonedFromId: global.id,
      },
    });
    await tx.learningStageHide.create({ data: { stageId, tenantId } });
    return created;
  });

  return { ok: true, stage: toAdminView(clone) };
}

/** Global aşamayı gizler (silmez). Yalnızca global aşamalar. */
export async function hideGlobalStage(
  tenantId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'NOT_GLOBAL' }> {
  const stage = await prisma.learningStage.findUnique({
    where: { id: stageId },
    select: { tenantId: true },
  });
  if (!stage) return { ok: false, code: 'NOT_FOUND' };
  if (stage.tenantId !== null) return { ok: false, code: 'NOT_GLOBAL' };

  await prisma.learningStageHide.upsert({
    where: { stageId_tenantId: { stageId, tenantId } },
    create: { stageId, tenantId },
    update: {},
  });
  return { ok: true };
}

/** Gizlenen global aşamayı yeniden gösterir. */
export async function unhideGlobalStage(tenantId: string, stageId: string): Promise<void> {
  await prisma.learningStageHide.deleteMany({ where: { stageId, tenantId } });
}

/**
 * Tenant'ın kendi aşamalarını yeniden sıralar (order = dizideki konum).
 * Global aşamalar paylaşımlı ve kilitlidir; sırası buradan değiştirilemez —
 * bir global aşamayı yeniden sıralamak için önce "özelleştir" gerekir.
 */
export async function reorderTenantStages(
  tenantId: string,
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; code: 'FORBIDDEN' }> {
  if (orderedIds.length === 0) return { ok: true };

  const owned = await prisma.learningStage.findMany({
    where: { id: { in: orderedIds }, tenantId },
    select: { id: true },
  });
  if (owned.length !== orderedIds.length) return { ok: false, code: 'FORBIDDEN' };

  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.learningStage.update({ where: { id }, data: { order: idx } }),
    ),
  );
  return { ok: true };
}

// LearningStage kaydını AdminStageView'e çevirir (isHidden global-only; klonlar/tenant için false).
function toAdminView(s: {
  id: string;
  tenantId: string | null;
  audience: LearningAudience;
  order: number;
  title: string;
  situationText: string;
  learningGoal: string;
  authoringGuide: string | null;
  isStkSpecific: boolean;
  choices: unknown;
  isActive: boolean;
  clonedFromId: string | null;
}): AdminStageView {
  return {
    id: s.id,
    tenantId: s.tenantId,
    audience: s.audience,
    order: s.order,
    title: s.title,
    situationText: s.situationText,
    learningGoal: s.learningGoal,
    authoringGuide: s.authoringGuide,
    isStkSpecific: s.isStkSpecific,
    choices: parseChoices(s.choices),
    isActive: s.isActive,
    clonedFromId: s.clonedFromId,
    isHidden: false,
  };
}

/** Kullanıcının yolculuk durumunu (tamamlandı mı, kaç aşama) döner. */
export async function getJourneyStatus(
  userId: string,
  tenantId: string,
  audience: LearningAudience,
): Promise<{
  audience: LearningAudience;
  completed: boolean;
  completedAt: Date | null;
  totalStages: number;
}> {
  const [membership, stages] = await Promise.all([
    prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { learningJourneyCompletedAt: true },
    }),
    buildStageList(tenantId, audience),
  ]);

  return {
    audience,
    completed: Boolean(membership?.learningJourneyCompletedAt),
    completedAt: membership?.learningJourneyCompletedAt ?? null,
    totalStages: stages.length,
  };
}
