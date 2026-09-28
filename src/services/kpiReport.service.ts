/**
 * Kurum yöneticisi KPI metrikleri — TEK kaynak (F-18).
 *
 * Hem panel (`GET /api/admin/kpi`, JSON) hem dışa aktarım (`GET /api/admin/kpi/export`, CSV)
 * aynı `computeKpiStats` çıktısını kullanır: iki ayrı hesap yazılırsa ekrandaki sayı ile
 * indirilen rapordaki sayı zamanla ayrışır. k-anonimlik de burada, TEK noktada uygulanır
 * (`applyKAnonymity`, V-05) — dışa aktarım panelin göstermediği bir sayıyı gösteremez.
 *
 * Compliance: yalnızca TOPLU (aggregate) sayılar. Kişi düzeyinde satır, ad, e-posta,
 * kişi bazlı puan bu servisten hiçbir zaman dönmez.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { applyKAnonymity, K_ANONYMITY_THRESHOLD } from './mask.js';
import type { CsvCell } from './csv.js';

export interface KpiNpsPhase {
  phase: number;
  /** Eşik altı ise null (gizli). */
  avgNps: number | null;
  /** Eşik altı ise 0 (gizli) — `suppressed` ile gerçek 0'dan ayırt edilir. */
  sampleSize: number;
  suppressed: boolean;
}

/**
 * AJ-78: bir tamamlama oranı (pay/payda). k-anonimlik PAY ve PAYDA için ayrı ayrı uygulanır:
 * payda eşik altındaysa küçük grupta oran kişiyi ele verir; pay eşik altındaysa ("3 kişiden 1'i")
 * yine 1-2 kişinin durumu okunur. İkisinden biri eşik altında → sayılar 0, yüzde null.
 */
export interface KpiCompletionRate {
  /** Tamamlayan kişi sayısı. Gizliyse 0. */
  completed: number;
  /** Paydadaki kişi sayısı (kurumda aktif mentör + menti üyesi). Gizliyse 0. */
  eligible: number;
  /** Tam sayıya yuvarlı yüzde. Gizliyse null. */
  percent: number | null;
  suppressed: boolean;
}

export interface KpiCompletion {
  /** "Kaydını tamamlayan üye": onaylı (approvalStatus APPROVED) aktif katılımcı / aktif katılımcı. */
  registration: KpiCompletionRate;
  /** DISC değerlendirmesini bitiren (discType dolu) aktif katılımcı / aktif katılımcı. */
  disc: KpiCompletionRate;
  /** Kurumda COMPLETED durumundaki görüşme sayısı (kişi değil olay sayımı — aktif eşleşme gibi gizlenmez). */
  completedMeetings: number;
  /** Ekran "en az N kişi" metnini sabitten kurabilsin diye. */
  minGroupSize: number;
}

/**
 * Tamamlama oranlarının paydası: kurumdaki aktif MENTOR/MENTI üyelikleri (kurum-içi rol,
 * TenantMembership.role — CLAUDE.md "Veri Modeli"). Yönetici üyelikleri katılımcı değildir:
 * DISC ve kayıt akışını yaşamaz, paydaya girerse oranları anlamsız biçimde düşürür/yükseltir.
 */
const COMPLETION_PARTICIPANT_ROLES = ['MENTOR', 'MENTI'] as const;

/** Pay/paydadan k-anonim tamamlama oranı (saf — DB yok). */
export function buildCompletionRate(rawCompleted: number, rawEligible: number): KpiCompletionRate {
  const eligible = applyKAnonymity(rawEligible);
  const completed = applyKAnonymity(rawCompleted);
  if (eligible.suppressed || completed.suppressed) {
    return { completed: 0, eligible: 0, percent: null, suppressed: true };
  }
  return {
    completed: completed.count,
    eligible: eligible.count,
    percent: Math.round((completed.count * 100) / eligible.count),
    suppressed: false,
  };
}

export interface KpiStats {
  totalActiveUsers: number;
  usersByRole: Record<string, number>;
  matching: { activeMatches: number; pendingOptIns: number; rematchPriorityUsers: number };
  feedback: { totalFeedbackLogs: number; npsByPhase: KpiNpsPhase[]; successRate: number | null };
  activeJobListings: number;
  completion: KpiCompletion;
}

export async function computeKpiStats(tenantId: string): Promise<KpiStats> {
  const [
    totalUsers,
    usersByRole,
    activeMatches,
    pendingOptIns,
    totalFeedbackLogs,
    avgNpsByPhase,
    rematchUsers,
    activeJobListings,
    participants,
    approvedParticipants,
    discCompletedParticipants,
    completedMeetings,
  ] = await Promise.all([
    // AJ-01: kurum-içi sayım TenantMembership.role üzerinden (CLAUDE.md "Veri Modeli") —
    // User.role değil. Bir kullanıcı bu kurumda farklı, başka kurumda farklı rolde olabilir.
    // Toplam kullanıcı — bu kurumda aktif üyeliği olan, kendisi de aktif kişiler.
    prisma.tenantMembership.count({
      where: { tenantId, isActive: true, user: { isActive: true } },
    }),

    // Rol bazında dağılım (Analytical)
    prisma.tenantMembership.groupBy({
      by: ['role'],
      where: { tenantId, isActive: true, user: { isActive: true } },
      _count: { id: true },
    }),

    // Aktif eşleşmeler (APPROVED opt-in sayısı)
    prisma.visibilityOptIn.count({
      where: { tenantId, status: 'APPROVED' },
    }),

    // Bekleyen talep kuyruğu
    prisma.visibilityOptIn.count({
      where: { tenantId, status: 'PENDING' },
    }),

    // Toplam geri bildirim
    prisma.feedbackLog.count({ where: { tenantId } }),

    // Faz bazında ortalama NPS (Analytical)
    prisma.feedbackLog.groupBy({
      by: ['phase'],
      where: { tenantId, npsScore: { not: null } },
      _avg: { npsScore: true },
      _count: { id: true },
    }),

    // Rematch öncelikli kullanıcı sayısı
    prisma.user.count({ where: { tenantId, rematchPriority: true, isActive: true } }),

    // Aktif iş ilanları
    prisma.jobListing.count({ where: { tenantId, isActive: true } }),

    // AJ-78: tamamlama oranları — sorgular üyelikten başlar (AJ-40: db.ts RLS eklentisi üst düzey
    // `user` okumalarına ev kurumunu enjekte eder; misafir üye ancak üyelik tablosundan doğru sayılır).
    // Payda: aktif katılımcı üyeler.
    prisma.tenantMembership.count({ where: participantWhere(tenantId) }),
    // "Kaydını tamamlayan" = onaylı aktif (retentionMetrics.service.ts arz-talep sayımıyla aynı ölçüt).
    prisma.tenantMembership.count({ where: participantWhere(tenantId, { approvalStatus: 'APPROVED' }) }),
    // DISC tamamlama = baskın tip yazılmış (discType dolu): DISC'i bitiren her yol (onboardingController
    // submitDisc, adaptiveTestEngine, temperamentController) yazar; platform kurum analizi de aynı ölçüt.
    // `discAssessmentCompletedAt` KULLANILMAZ: yalnız onay bekleyen (PENDING) kullanıcıda, yönetici
    // bildirimi için dolar (questionController) — davetle onaylı gelen kullanıcıda hiç dolmaz.
    prisma.tenantMembership.count({ where: participantWhere(tenantId, { discType: { not: null } }) }),
    // Tamamlanan görüşme — kurum kapsamlı (görüşmenin kendi tenantId'si).
    prisma.meeting.count({ where: { tenantId, status: 'COMPLETED' } }),
  ]);

  // V-05 k-anonimlik: eşiğin altındaki yanıta dayanan ortalama gösterilmez (küçük kurumda
  // tek kişinin puanı ortalamadan okunmasın); örnek sayısı da eşik altında 0'a indirgenir.
  const npsByPhase: KpiNpsPhase[] = avgNpsByPhase
    .map((p) => {
      const sample = applyKAnonymity(p._count.id);
      return {
        phase: p.phase,
        avgNps: !sample.suppressed && p._avg.npsScore !== null ? Math.round(p._avg.npsScore) : null,
        sampleSize: sample.count,
        suppressed: sample.suppressed,
      };
    })
    .sort((a, b) => a.phase - b.phase);

  // ⚠️ KR-07: adı "successRate" olsa da bu bir ORAN DEĞİL — 3. ay ortalama NPS'idir (0-10 ölçeği,
  // yukarıdaki avgNps ile aynı değer). Eski yorum "NPS ≥ 70 olan eşleşmeler / toplam" diyordu; ne
  // öyle hesaplanıyor ne de 0-10 puanda 70 eşiği anlamlı. Alan adı frontend sözleşmesi
  // (admin/kpi/page.tsx) olduğundan burada değiştirilmedi; değer davranışı aynen korunuyor.
  const successRate = npsByPhase.find((p) => p.phase === 3)?.avgNps ?? null;

  return {
    totalActiveUsers: totalUsers,
    usersByRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count.id])),
    matching: { activeMatches, pendingOptIns, rematchPriorityUsers: rematchUsers },
    feedback: { totalFeedbackLogs, npsByPhase, successRate },
    activeJobListings,
    completion: {
      registration: buildCompletionRate(approvedParticipants, participants),
      disc: buildCompletionRate(discCompletedParticipants, participants),
      completedMeetings,
      minGroupSize: K_ANONYMITY_THRESHOLD,
    },
  };
}

/** Kurumdaki aktif katılımcı üyelikleri; `user` koşulu ek süzgeçle (onay, DISC) daraltılabilir. */
function participantWhere(tenantId: string, userFilter: Prisma.UserWhereInput = {}): Prisma.TenantMembershipWhereInput {
  return {
    tenantId,
    isActive: true,
    role: { in: [...COMPLETION_PARTICIPANT_ROLES] },
    user: { isActive: true, ...userFilter },
  };
}

// ─── CSV rapor satırları ──────────────────────────────────────────────────────

/** k-anonimlik ile gizlenen hücrenin CSV'deki işareti — 0 ile karışmasın diye açık metin. */
export const SUPPRESSED_CELL_TEXT = `gizli (<${K_ANONYMITY_THRESHOLD})`;
const SUPPRESSED_NOTE =
  `Gizlilik için en az ${K_ANONYMITY_THRESHOLD} yanıt gerekir; kişilerin puanı tek tek okunamasın diye gösterilmiyor.`;

const SUPPRESSED_GROUP_NOTE =
  `Gizlilik için hem grupta hem tamamlayanlarda en az ${K_ANONYMITY_THRESHOLD} kişi gerekir; kişilerin durumu tek tek okunamasın diye gösterilmiyor.`;
const REGISTRATION_DEFINITION = 'Aktif mentör ve mentilerden hesabı onaylanmış olanlar (onay kullanıcı düzeyindedir, kuruma özel değildir).';
const DISC_DEFINITION = 'Aktif mentör ve mentilerden DISC değerlendirmesini bitirenler.';

export const KPI_CSV_HEADER = ['Bölüm', 'Metrik', 'Değer', 'Açıklama'] as const;

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Yönetici', MENTOR: 'Mentör', MENTI: 'Menti' };
const ROLE_ORDER = ['ADMIN', 'MENTOR', 'MENTI'];

export interface KpiReportMeta {
  tenantName: string;
  generatedAt: Date;
}

/**
 * KPI istatistiklerini rapor satırlarına çevirir (saf — DB yok).
 * Yalnız toplu metrikler; kişi düzeyinde satır YOK.
 */
export function buildKpiReportRows(stats: KpiStats, meta: KpiReportMeta): CsvCell[][] {
  const rows: CsvCell[][] = [[...KPI_CSV_HEADER]];
  const add = (section: string, metric: string, value: CsvCell, note = '') => rows.push([section, metric, value, note]);

  add('Rapor', 'Kurum', meta.tenantName);
  add('Rapor', 'Oluşturulma zamanı (UTC)', meta.generatedAt.toISOString());
  add('Rapor', 'Kapsam', 'Yalnız toplu (aggregate) metrikler', 'Kişi düzeyinde veri içermez.');

  add('Kullanıcılar', 'Toplam aktif kullanıcı', stats.totalActiveUsers);
  const roles = [
    ...ROLE_ORDER.filter((r) => r in stats.usersByRole),
    ...Object.keys(stats.usersByRole).filter((r) => !ROLE_ORDER.includes(r)).sort(),
  ];
  for (const role of roles) {
    add('Kullanıcılar', `Aktif ${ROLE_LABELS[role] ?? role} sayısı`, stats.usersByRole[role] ?? 0);
  }

  add('Eşleşme', 'Aktif eşleşme', stats.matching.activeMatches);
  add('Eşleşme', 'Bekleyen eşleşme talebi', stats.matching.pendingOptIns);
  add('Eşleşme', 'Yeniden eşleşme öncelikli kullanıcı', stats.matching.rematchPriorityUsers);

  add('Geri bildirim', 'Toplam geri bildirim', stats.feedback.totalFeedbackLogs);
  for (const p of stats.feedback.npsByPhase) {
    if (p.suppressed) {
      add('Geri bildirim', `${p.phase}. ay NPS ortalaması (0-10)`, SUPPRESSED_CELL_TEXT, SUPPRESSED_NOTE);
      add('Geri bildirim', `${p.phase}. ay yanıt sayısı`, SUPPRESSED_CELL_TEXT, SUPPRESSED_NOTE);
    } else {
      add('Geri bildirim', `${p.phase}. ay NPS ortalaması (0-10)`, p.avgNps ?? '', 'Yuvarlanmış ortalama.');
      add('Geri bildirim', `${p.phase}. ay yanıt sayısı`, p.sampleSize);
    }
  }
  const phase3 = stats.feedback.npsByPhase.find((p) => p.phase === 3);
  add(
    'Geri bildirim',
    '3. ay başarı (NPS ortalaması)',
    phase3?.suppressed ? SUPPRESSED_CELL_TEXT : (stats.feedback.successRate ?? ''),
    phase3?.suppressed
      ? SUPPRESSED_NOTE
      : stats.feedback.successRate === null ? 'Henüz 3. ay değerlendirmesi yok.' : '',
  );

  add('İş ilanları', 'Aktif iş ilanı', stats.activeJobListings);

  // AJ-78: tamamlama oranları — gizli hücre NPS'teki gibi açık "gizli" metniyle (0 ile karışmasın).
  const addRate = (metric: string, rate: KpiCompletionRate, definition: string) => {
    if (rate.suppressed) {
      add('Tamamlama', metric, SUPPRESSED_CELL_TEXT, SUPPRESSED_GROUP_NOTE);
    } else {
      add('Tamamlama', metric, rate.percent ?? '', `${rate.completed}/${rate.eligible} kişi. ${definition}`);
    }
  };
  addRate('Kaydını tamamlayan üye (%)', stats.completion.registration, REGISTRATION_DEFINITION);
  addRate('DISC tamamlama (%)', stats.completion.disc, DISC_DEFINITION);
  add('Tamamlama', 'Tamamlanan görüşme', stats.completion.completedMeetings);
  return rows;
}

/** `kpi-raporu-<kurum-slug>-<YYYY-MM-DD>.csv` — slug başlığa güvenle girsin diye süzülür. */
export function kpiReportFileName(tenantSlug: string, date: Date): string {
  const safeSlug = tenantSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'kurum';
  return `kpi-raporu-${safeSlug}-${date.toISOString().slice(0, 10)}.csv`;
}
