/**
 * AJ-122 — cleanDb kilitlenme (40P01) yeniden denemesi. Saf yardımcı; DB'ye bağlanmaz.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEADLOCK_RETRY_ATTEMPTS, isDeadlockError, withDeadlockRetry } from './helpers/deadlockRetry.js';

const deadlock = () => Object.assign(new Error('Raw query failed. Code: `40P01`. Message: `deadlock detected`'), {
  code: 'P2010',
  meta: { code: '40P01' },
});
const noSleep = () => Promise.resolve();

describe('AJ-122 · withDeadlockRetry', () => {
  it('40P01 → yeniden dener ve başarılı sonucu döner', async () => {
    const fn = vi.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce(7);
    await expect(withDeadlockRetry(fn, noSleep)).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('başka hata → yeniden denemeden fırlar', async () => {
    const other = Object.assign(new Error('unique violation'), { code: 'P2002' });
    const fn = vi.fn().mockRejectedValue(other);
    await expect(withDeadlockRetry(fn, noSleep)).rejects.toBe(other);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sürekli 40P01 → en çok DEADLOCK_RETRY_ATTEMPTS kez dener, sonra fırlar', async () => {
    const fn = vi.fn().mockRejectedValue(deadlock());
    await expect(withDeadlockRetry(fn, noSleep)).rejects.toMatchObject({ meta: { code: '40P01' } });
    expect(fn).toHaveBeenCalledTimes(DEADLOCK_RETRY_ATTEMPTS);
  });

  it('isDeadlockError: meta.code, code ve mesaj içi 40P01 tanınır; diğerleri hayır', () => {
    expect(isDeadlockError(deadlock())).toBe(true);
    expect(isDeadlockError({ code: '40P01' })).toBe(true);
    expect(isDeadlockError(new Error('x 40P01 y'))).toBe(true);
    expect(isDeadlockError(new Error('timeout'))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
  });
});
