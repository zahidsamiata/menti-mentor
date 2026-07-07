import { prisma } from '../db.js';

// Adım sayısı (LCA'ya uzaklık) → yakınlık skoru
// 0 = aynı düğüm, 1 = kardeş (ortak ebeveyn), 2 = kuzen (ortak büyükebeveyn)
const PROXIMITY: readonly number[] = [1.0, 0.75, 0.40];

// IndustryNode öz-referanslı model olduğundan Prisma tipi çıkarsaması başarısız olur.
// Açık tip anotasyonu bu sorunu giderir.
type NodeRow = { code: string; parent: { code: string } | null };

/**
 * Bir koddan başlayarak kök düğüme kadar ata zincirini döndürür.
 * Dönen dizi: [self, parent, grandparent, ...]
 * Her çağrı en fazla `depth` adet DB sorgusu yapar (tipik 3-4 seviye).
 */
async function buildAncestorChain(code: string): Promise<string[]> {
  const chain: string[] = [];
  let current: string | null = code;

  while (current !== null) {
    const node: NodeRow | null = await prisma.industryNode.findUnique({
      where: { code: current },
      select: { code: true, parent: { select: { code: true } } },
    });
    if (!node) break;
    chain.push(node.code);
    current = node.parent?.code ?? null;
  }

  return chain;
}

/**
 * İki sektör kodunun hiyerarşik yakınlığını hesaplar.
 *
 * Kural tablosu (daha derin tarafın LCA'ya adım sayısına göre):
 *   Aynı düğüm → 1.00
 *   Kardeş      → 0.75
 *   Kuzen       → 0.40
 *   Daha uzak   → 0.00
 *
 * Null/eksik kod durumunda 0 döner (adil null toleransı).
 */
export async function computeTaxonomyProximity(
  codeA: string | null | undefined,
  codeB: string | null | undefined,
): Promise<number> {
  if (!codeA || !codeB) return 0;
  if (codeA === codeB) return 1.0;

  const [chainA, chainB] = await Promise.all([
    buildAncestorChain(codeA),
    buildAncestorChain(codeB),
  ]);

  // chainA'daki her kod → zincirdeki index (LCA'ya adım mesafesi)
  const indexMapA = new Map(chainA.map((c, i) => [c, i]));

  for (let idxB = 0; idxB < chainB.length; idxB++) {
    const idxA = indexMapA.get(chainB[idxB]!);
    if (idxA !== undefined) {
      // LCA'dan daha uzak olan tarafın mesafesi puanı belirler
      return PROXIMITY[Math.max(idxA, idxB)] ?? 0;
    }
  }

  return 0;
}
