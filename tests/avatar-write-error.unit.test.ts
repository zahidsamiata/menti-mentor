/**
 * K-04 — avatar diske yazılamazsa kullanıcı anlaşılır mesaj görür (jenerik 500 değil).
 *
 * Kalıcı disk yok / uid 1001 yazma izni yoksa writeAvatarFile EACCES fırlatır.
 * Handler bunu yakalayıp 503 + anlaşılır mesaj döndürmeli; iç detay (EACCES/yol) sızmamalı.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/avatarStorage.js', () => ({
  detectImageType: () => ({ ext: 'jpg', mime: 'image/jpeg' }),
  buildAvatarFilename: () => 'user_x.jpg',
  buildAvatarUrl: (f: string) => `http://backend/uploads/${f}`,
  writeAvatarFile: vi.fn().mockRejectedValue(new Error('EACCES: permission denied, open /app/uploads/user_x.jpg')),
  deleteLocalAvatar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/imageSanitize.js', () => ({
  sanitizeImage: (buf: Buffer) => ({ size: { width: 10, height: 10 }, clean: buf }),
  isWithinAvatarLimits: () => true,
  AVATAR_IMAGE_LIMITS: { maxSide: 8000, maxPixels: 40_000_000 },
}));

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'u1', avatarUrl: null }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../src/services/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { uploadMyAvatar } from '../src/controllers/avatarController.js';

function mockRes() {
  const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

describe('uploadMyAvatar — disk yazma hatası (K-04)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('yazma başarısızsa 503 + anlaşılır mesaj döner, iç detay sızmaz', async () => {
    const req = {
      auth: { userId: 'u1' },
      tenant: { tenantId: 't1' },
      file: { buffer: Buffer.from('fake') },
    } as never;
    const res = mockRes();

    await uploadMyAvatar(req, res as never);

    expect(res.statusCode).toBe(503);
    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AVATAR_YAZILAMADI');
    expect(body.message).toMatch(/kaydedilemedi/);
    // İç detay (EACCES / dosya yolu) client'a SIZMAMALI.
    expect(JSON.stringify(body)).not.toMatch(/EACCES|\/app\/uploads/);
  });
});
