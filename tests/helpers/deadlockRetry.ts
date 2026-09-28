/**
 * AJ-122 — Postgres kilitlenmesinde (40P01) yeniden deneme (yalnız test yardımcıları).
 *
 * NEDEN: bir testin bıraktığı arka plan işi (ör. OAuth kaydındaki yönetici bildirimi sorgusu:
 * TenantMembership → User kilit sırası) sonraki testin `cleanDb` TRUNCATE'iyle (User →
 * TenantMembership) ters sırada kilit alabiliyor. Postgres döngüyü ~1 sn sonra kırar ve
 * taraflardan birini kurban seçer; kurban TRUNCATE ise test rastgele kırmızı olur. Karşı taraf
 * kısa bir SELECT olduğu için ikinci deneme temiz geçer. Ürün koduna dokunmadan CI'ı kararlı kılar.
 */

export const DEADLOCK_RETRY_ATTEMPTS = 3;
const DEADLOCK_RETRY_DELAY_MS = 75;

/** Prisma ham sorgu hatası (P2010) ya da sürücü hatası içinde Postgres 40P01 var mı? */
export function isDeadlockError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  if (e.code === '40P01' || e.meta?.code === '40P01') return true;
  return typeof e.message === 'string' && e.message.includes('40P01');
}

/** `fn`'i yalnız kilitlenme hatasında en çok DEADLOCK_RETRY_ATTEMPTS kez dener; diğer hatalar hemen fırlar. */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= DEADLOCK_RETRY_ATTEMPTS) throw err;
      await sleep(DEADLOCK_RETRY_DELAY_MS * attempt);
    }
  }
}
