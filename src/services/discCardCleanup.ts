/**
 * AJ-50 (KVKK — psikometrik veri): eski `User.discResultCard` kayıtlarından ham DISC alanlarının
 * (`discVector`, `rawScores`) TEK SEFERLİK temizliği — saf mantık + DB adımları.
 *
 * Neden: onboarding'in AJ-21 öncesi sürümü karta ham vektörü ve ham puanları da gömüyordu.
 * AJ-21 ile yeni yazımlar temiz ve okuma yolu (`toPublicDiscResultCard`) peer yanıtında süzüyor;
 * bu modül yalnız DB'de kalan fazlalığı kaldırır. Ham vektörün meşru tek kaynağı `User.discVector`.
 *
 * Güvenlik sırası (apply): (0) yedek tablo VAR MI → varsa DUR · (1) tarihli yedek (id + kart) ·
 * (2) yedek sayısı = etkilenecek sayı mı → değilse geri al · (3) tek JSON güncellemesi ·
 * (4) güncellenen = yedek mi → değilse geri al · (5) kalan 0 mı. Hepsi TEK transaction'da.
 * Yedek tablo IF NOT EXISTS ile AÇILMAZ: eski bir tablo sessizce yedek sanılmasın
 * (bkz. scripts/cleanup-orphan-agreements-2026-08-30.sql, PO düzeltme 1).
 *
 * Çalıştırıcı (CLI + env + onay): scripts/cleanup-disc-card-raw-keys.ts. Varsayılan KURU ÇALIŞMA.
 */
import { DISC_CARD_RAW_KEYS, toPublicDiscResultCard } from './discVisibility.js';

/** Hedef satır koşulu — sayım, yedek ve güncelleme BİREBİR aynı koşulu kullanır. */
export const DIRTY_CARD_WHERE =
  `"discResultCard" IS NOT NULL AND jsonb_typeof("discResultCard") = 'object' ` +
  `AND "discResultCard" ?| ARRAY['${DISC_CARD_RAW_KEYS.join("','")}']`;

/** Tek JSON güncellemesi: yalnız ham anahtarlar düşer, kart alanları aynen kalır. */
export const STRIP_EXPRESSION =
  `"discResultCard"${DISC_CARD_RAW_KEYS.map((k) => ` - '${k}'`).join('')}`;

/** Kart ham anahtar taşıyor mu? (DIRTY_CARD_WHERE'nin JS karşılığı) */
export function hasRawDiscKeys(card: unknown): boolean {
  if (card === null || typeof card !== 'object' || Array.isArray(card)) return false;
  return DISC_CARD_RAW_KEYS.some((k) => Object.prototype.hasOwnProperty.call(card, k));
}

/** Kart → temiz kart (STRIP_EXPRESSION'ın JS karşılığı). Girdiyi değiştirmez. */
export function stripRawDiscKeys<T>(card: T): T {
  return toPublicDiscResultCard(card);
}

/** Tarihli yedek tablo adı: "User_discResultCard_yedek_YYYYMMDD" (UTC). */
export function backupTableName(now: Date): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `User_discResultCard_yedek_${ymd}`;
}

/** Kimliği loga maskeli yaz: ilk 4 + son 2 karakter. */
export function maskId(id: string): string {
  if (id.length <= 6) return '***';
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}

export function hostOf(url: string): string {
  return (url.split('@')[1] || '').split('/')[0].split('?')[0] || '(bilinmiyor)';
}

/** Gerçek DB'ye yazmak için beklenen onay metni — host'u açıkça içerir. */
export function requiredConfirmation(host: string): string {
  return `TEMIZLE ${host}`;
}

/**
 * Yazmaya izin var mı? Hedef TEST_DATABASE_URL'in host'u ise onay istenmez; başka her host
 * (gerçek DB) için `--onay` metni `TEMIZLE <host>` ile birebir eşleşmeli.
 */
export function checkApplyAllowed(input: {
  targetUrl: string;
  testUrl: string | undefined;
  confirmation: string | undefined;
}): { ok: true } | { ok: false; reason: string } {
  const host = hostOf(input.targetUrl);
  if (host === '(bilinmiyor)') return { ok: false, reason: 'hedef DB host okunamadı' };
  if (input.testUrl && hostOf(input.testUrl) === host) return { ok: true };
  const expected = requiredConfirmation(host);
  if (input.confirmation !== expected) {
    return { ok: false, reason: `gerçek DB (${host}) için onay metni gerekli: --onay="${expected}"` };
  }
  return { ok: true };
}

/** Çalıştırıcının ihtiyaç duyduğu DB yüzeyi (PrismaClient bunu karşılar; testte mock). */
export interface CleanupTx {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}
export interface CleanupDb extends CleanupTx {
  $transaction<R>(fn: (tx: CleanupTx) => Promise<R>): Promise<R>;
}

export type CleanupReport = {
  mode: 'KURU' | 'UYGULA';
  affected: number;
  sampleMaskedIds: string[];
  backupTable: string;
  backedUp?: number;
  updated?: number;
  remaining?: number;
};

const SAMPLE_SIZE = 5;

async function countDirty(db: CleanupTx): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT COUNT(*) AS n FROM "User" WHERE ${DIRTY_CARD_WHERE}`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function runDiscCardCleanup(
  db: CleanupDb,
  opts: { apply: boolean; now: Date },
): Promise<CleanupReport> {
  const backupTable = backupTableName(opts.now);
  const affected = await countDirty(db);
  const sample = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "User" WHERE ${DIRTY_CARD_WHERE} ORDER BY id LIMIT ${SAMPLE_SIZE}`,
  );
  const report: CleanupReport = {
    mode: opts.apply ? 'UYGULA' : 'KURU',
    affected,
    sampleMaskedIds: sample.map((r) => maskId(r.id)),
    backupTable,
  };
  if (!opts.apply || affected === 0) return report;

  return db.$transaction(async (tx) => {
    const exists = await tx.$queryRawUnsafe<{ t: string | null }[]>(
      `SELECT to_regclass('public."${backupTable}"')::text AS t`,
    );
    if (exists[0]?.t) throw new Error(`yedek tablo zaten var: ${backupTable} — DUR (üzerine yazılmaz)`);

    await tx.$executeRawUnsafe(
      `CREATE TABLE "${backupTable}" AS SELECT id, "discResultCard" FROM "User" WHERE ${DIRTY_CARD_WHERE}`,
    );
    const backedRows = await tx.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM "${backupTable}"`,
    );
    const backedUp = Number(backedRows[0]?.n ?? 0);
    if (backedUp !== affected) throw new Error(`yedek sayısı (${backedUp}) ≠ etkilenecek (${affected}) — geri alındı`);

    const updated = await tx.$executeRawUnsafe(
      `UPDATE "User" SET "discResultCard" = ${STRIP_EXPRESSION} WHERE ${DIRTY_CARD_WHERE}`,
    );
    if (updated !== backedUp) throw new Error(`güncellenen (${updated}) ≠ yedek (${backedUp}) — geri alındı`);

    const remaining = await countDirty(tx);
    if (remaining !== 0) throw new Error(`temizlik sonrası kalan ${remaining} — geri alındı`);

    return { ...report, backedUp, updated, remaining };
  });
}
