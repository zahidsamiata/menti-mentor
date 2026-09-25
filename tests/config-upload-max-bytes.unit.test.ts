/**
 * GV-22 — yükleme boyutu ayarı yanlış yazılırsa sınır kalkmaz, varsayılana düşer.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

let parseUploadMaxBytes: (raw?: string) => number;
let DEFAULT_UPLOAD_MAX_BYTES: number;

describe('GV-22: UPLOAD_MAX_BYTES ayrıştırma', () => {
  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret-min-32-chars-for-testing-only!!');
    vi.resetModules();
    ({ parseUploadMaxBytes, DEFAULT_UPLOAD_MAX_BYTES } = await import('../src/config.js'));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('tanımsız ya da boşsa varsayılanı kullanır', () => {
    expect(parseUploadMaxBytes(undefined)).toBe(DEFAULT_UPLOAD_MAX_BYTES);
    expect(parseUploadMaxBytes('  ')).toBe(DEFAULT_UPLOAD_MAX_BYTES);
  });

  it('geçerli pozitif tam sayıyı olduğu gibi kullanır', () => {
    expect(parseUploadMaxBytes('1048576')).toBe(1048576);
  });

  it('negatif: yazım hatası sınırı kaldırmaz, varsayılana düşer ve uyarır', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['5MB', 'abc', '0', '-10', '1.5', 'Infinity', 'NaN']) {
      expect(parseUploadMaxBytes(bad)).toBe(DEFAULT_UPLOAD_MAX_BYTES);
    }
    expect(warn).toHaveBeenCalledTimes(7);
    warn.mockRestore();
  });
});
