/**
 * AJ-89 — Mentilerin "şu an en çok neye ihtiyacın var?" (S1) cevaplarının KURUM-İÇİ TOPLU dağılımı.
 *
 * Görünürlük kuralı (PO kararı, değerlendirme tasarımı §10.3): kurum yöneticisi S1'i YALNIZ TOPLU
 * görür, kişiye inmez — kişi "yöneticim bunu okuyacak" kaygısı taşımadan dürüst cevap versin.
 * Bu yüzden:
 *   · Bu servisten kişi düzeyinde satır, ad, kimlik HİÇ dönmez; yalnız seçenek başına sayı/yüzde.
 *   · k-anonimlik (`applyKAnonymity`, eşik K_ANONYMITY_THRESHOLD): eşik altındaki seçenek hücresi
 *     gizlenir (sayı 0, yüzde null). Cevaplayan sayısı (payda) eşik altındaysa dağılımın TAMAMI
 *     gizlenir — üç kişiden az cevapta hiçbir oran gösterilmez.
 *   · Kurum sınırı üyelikten (`TenantMembership`, kurum-içi rol MENTI) — `User.role`/`User.tenantId`
 *     değil (CLAUDE.md "Veri Modeli"): başka kurumda menti olan kişi bu kurumun dağılımına girmez,
 *     bu kurumda menti olan misafir üye girer.
 *
 * S1 çoklu seçimdir (en fazla 2) → yüzdelerin toplamı %100'ü aşabilir; payda "S1'e en az bir cevap
 * veren menti" sayısıdır (boş bırakmak meşru — EK2, bu kişiler paydaya girmez).
 *
 * Mentöre görünürlük (§10.3 "eşleşme kurulduktan sonra") bu servisin konusu DEĞİL — ayrı ürün kararı.
 */

import { MentiNeed } from '@prisma/client';
import { prisma } from '../db.js';
import { applyKAnonymity, K_ANONYMITY_THRESHOLD } from './mask.js';

/** Tek seçeneğin toplu sayımı. `suppressed` iken sayı 0'a indirgenir, yüzde verilmez. */
export interface MentiNeedCell {
  need: MentiNeed;
  count: number;
  /** Cevaplayanların yüzde kaçı bu seçeneği işaretledi (tam sayıya yuvarlı). Gizliyse null. */
  percent: number | null;
  suppressed: boolean;
}

export interface MentiNeedsDistribution {
  /** S1'e en az bir cevap veren menti sayısı. Dağılım gizliyse 0 (gerçek sayı yanıta girmez). */
  respondentCount: number;
  /** Payda eşik altında → dağılımın tamamı gizli, `options` boş. */
  suppressed: boolean;
  /** Ekran "en az N kişi" metnini sabitten kurabilsin diye. */
  minGroupSize: number;
  options: MentiNeedCell[];
}

/** Seçenek sırası şemadaki enum sırası — ekran ve testler kararlı sırayla okur. */
const MENTI_NEED_ORDER: readonly MentiNeed[] = Object.values(MentiNeed);

/**
 * Kişi başı S1 cevap listelerinden toplu dağılımı üretir (saf — DB yok).
 * Girdi kişi düzeyindedir ama çıktıya yalnız sayım/yüzde geçer.
 */
export function buildMentiNeedsDistribution(
  answers: ReadonlyArray<ReadonlyArray<MentiNeed>>,
): MentiNeedsDistribution {
  // Aynı kişinin aynı seçeneği iki kez sayılmasın (şema dizi; doğrulama tekrarı engellemiyor).
  const respondents = answers.map((list) => new Set(list)).filter((set) => set.size > 0);

  const denominator = { count: respondents.length, suppressed: false }; // MUTASYON: k-anonimlik kaldırıldı
  if (denominator.suppressed) {
    return { respondentCount: 0, suppressed: true, minGroupSize: K_ANONYMITY_THRESHOLD, options: [] };
  }

  const options = MENTI_NEED_ORDER.map((need): MentiNeedCell => {
    const raw = respondents.filter((set) => set.has(need)).length;
    const cell = { count: raw, suppressed: false }; // MUTASYON: k-anonimlik kaldırıldı
    return {
      need,
      count: cell.count,
      percent: cell.suppressed ? null : Math.round((raw * 100) / respondents.length),
      suppressed: cell.suppressed,
    };
  });

  return {
    respondentCount: denominator.count,
    suppressed: false,
    minGroupSize: K_ANONYMITY_THRESHOLD,
    options,
  };
}

/** Kurumun aktif menti üyelerinin S1 cevaplarından toplu dağılım (kurum yalnız çağırandan gelir). */
export async function computeMentiNeedsDistribution(tenantId: string): Promise<MentiNeedsDistribution> {
  const memberships = await prisma.tenantMembership.findMany({
    where: { tenantId, role: 'MENTI', isActive: true, user: { isActive: true } },
    select: { user: { select: { mentiNeeds: true } } },
  });
  return buildMentiNeedsDistribution(memberships.map((m) => m.user.mentiNeeds));
}
