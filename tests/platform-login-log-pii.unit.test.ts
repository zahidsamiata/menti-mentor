/**
 * GV-07 — negatif test: başarısız platform girişinde yazılan günlük kaydı girilen e-postayı İÇERMEZ.
 *
 * prisma mock'lanır; `logger` gerçek hâliyle çalışır ve SystemLog'a yazacağı veri yakalanır.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../src/db.js', () => ({
  prisma: { systemLog: { create: vi.fn().mockResolvedValue({}) } },
  tenantStorage: { getStore: () => undefined },
}));

import { prisma } from '../src/db.js';
import { platformLogin } from '../src/controllers/platformController.js';

const createLog = prisma.systemLog.create as unknown as ReturnType<typeof vi.fn>;

describe('platformLogin — başarısız giriş günlüğü', () => {
  it('SystemLog meta\'sında girilen e-posta yok; IP izi korunur', async () => {
    const typedEmail = 'yanlis-kutu@kisisel.example.com';
    const req = { body: { email: typedEmail, password: 'yanlis' }, ip: '203.0.113.7' } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await platformLogin(req, res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toHaveBeenCalledWith(401);
    expect(createLog).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(createLog.mock.calls[0]?.[0]);
    expect(written).not.toContain('yanlis-kutu');
    expect(written).not.toContain('kisisel.example.com');
    expect(written).toContain('203.0.113.7');
    expect(written).toContain('"emailProvided":true');
  });
});
