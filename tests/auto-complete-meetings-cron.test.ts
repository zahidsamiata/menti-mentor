/**
 * runAutoCompleteMeetingsCron — U-01 (ÇIKIŞ BLOKERİ).
 *
 * KARAR-80/M11: bitiş saati geçen SCHEDULED toplantılar kimse tıklamadan otomatik
 * COMPLETED'a döner. Bu olmadan check-in + feedback akışı (status==='COMPLETED' şartı)
 * hiçbir toplantı için açılmıyordu.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';

const { runAutoCompleteMeetingsCron } = await import('../src/services/cronScheduler.js');

const minutesFromNow = (n: number) => new Date(Date.now() + n * 60 * 1000);

async function makeMeeting(opts: {
  tenantId: string; mentorUserId: string; mentiUserId: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'PENDING';
  startsAt: Date; endsAt: Date;
}) {
  return testPrisma.meeting.create({
    data: {
      tenantId: opts.tenantId,
      mentorUserId: opts.mentorUserId,
      mentiUserId: opts.mentiUserId,
      status: opts.status,
      format: 'ONLINE',
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
    },
  });
}

describe('runAutoCompleteMeetingsCron', () => {
  let tenantId: string;
  let mentorId: string;
  let mentiId: string;

  beforeEach(async () => {
    await cleanDb();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentorId = (await createMentor(tenantId)).id;
    mentiId = (await createMenti(tenantId)).id;
  });

  it('bitiş saati GEÇMİŞ SCHEDULED toplantı otomatik COMPLETED olur', async () => {
    const meeting = await makeMeeting({
      tenantId, mentorUserId: mentorId, mentiUserId: mentiId,
      status: 'SCHEDULED',
      startsAt: minutesFromNow(-90),
      endsAt: minutesFromNow(-30),
    });

    const res = await runAutoCompleteMeetingsCron();

    expect(res.completed).toBe(1);
    const updated = await testPrisma.meeting.findUnique({ where: { id: meeting.id } });
    expect(updated?.status).toBe('COMPLETED');
  });

  it('bitiş saati henüz GELMEMİŞ SCHEDULED toplantı DOKUNULMAZ', async () => {
    const meeting = await makeMeeting({
      tenantId, mentorUserId: mentorId, mentiUserId: mentiId,
      status: 'SCHEDULED',
      startsAt: minutesFromNow(30),
      endsAt: minutesFromNow(90),
    });

    const res = await runAutoCompleteMeetingsCron();

    expect(res.completed).toBe(0);
    const updated = await testPrisma.meeting.findUnique({ where: { id: meeting.id } });
    expect(updated?.status).toBe('SCHEDULED');
  });

  it('SCHEDULED dışındaki statüler (ör. PENDING süresi geçmiş) DOKUNULMAZ', async () => {
    const meeting = await makeMeeting({
      tenantId, mentorUserId: mentorId, mentiUserId: mentiId,
      status: 'PENDING',
      startsAt: minutesFromNow(-90),
      endsAt: minutesFromNow(-30),
    });

    const res = await runAutoCompleteMeetingsCron();

    expect(res.completed).toBe(0);
    const updated = await testPrisma.meeting.findUnique({ where: { id: meeting.id } });
    expect(updated?.status).toBe('PENDING');
  });
});
