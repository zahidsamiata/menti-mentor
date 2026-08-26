/**
 * Madde 93 — TAM anonimleştirme kapsamı (KVKK saklama-imha vaadinin kanıtı).
 *
 * Kapsam (2026-08-26, PO onaylı (c)+(iii)+(2) yolu, migration YOK):
 *  1. User PII alanları (avatarUrl/linkedinUrl/... — regresyon).
 *  2. Bağlı tablolardaki SERBEST-METİN: Message.content (iki-taraflı: A'nınki '[silindi]',
 *     B'ninki KORUNUR) · Meeting.notes/phoneNumber/requestMessage/locationText ·
 *     MeetingCheckIn.openNote/nextTopicNote · Feedback serbest metinleri · MatchRequest ·
 *     VisibilityOptIn · UserReport.description · MentorshipAgreement.mentiGoal.
 *  3. Oturum/token iptali: TenantMembership.isActive=false + RefreshToken silinir; eski
 *     access token'la işlem yapılamaz (HTTP).
 *  4. hardDeleteUser → anonimleştirmeye yönlendirir (madde 39; kullanıcı satırı SİLİNMEZ).
 *
 * DÜRÜST SINIR: userId (rastgele cuid, kişisel bilgi içermez) bağlı kayıtlarda kalır —
 * "tam geri-döndürülemez anonim" vaadi VERİLMEZ (H-9 hukukçu sorusu, KVKK 05-saklama).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders } from './helpers/request.js';
import { anonymizeUser, hardDeleteUser } from '../src/services/gdprService.js';

describe('anonymizeUser → User PII alanları temizlenir', () => {
  let userId: string;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const user = await createUser({ tenantId, role: 'MENTOR' });
    userId = user.id;
    // Anonimleştirme öncesi PII doldur
    await testPrisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl: 'https://cdn.example/uploads/foto.jpg',
        linkedinUrl: 'https://linkedin.com/in/ornek-profil',
        instagramUrl: 'https://instagram.com/ornek',
        enneagramWing: '3w4',
        discResultCard: { archetype: 'Test' },
        discVector: { D: 0.5, I: 0.2, S: 0.2, C: 0.1 },
      },
    });
  });

  it('sosyal linkler + avatar + kişilik kartı anonimleştirme sonrası boş', async () => {
    await anonymizeUser(userId, tenantId);

    const u = await testPrisma.user.findUnique({ where: { id: userId } });
    expect(u).not.toBeNull();
    // Yeni kapsam (madde 93)
    expect(u!.avatarUrl).toBeNull();
    expect(u!.linkedinUrl).toBeNull();
    expect(u!.instagramUrl).toBeNull();
    expect(u!.enneagramWing).toBeNull();
    expect(u!.discResultCard).toBeNull();
    // Mevcut kapsam (regresyon)
    expect(u!.discVector).toBeNull();
    expect(u!.discType).toBeNull();
    expect(u!.email).toContain('@anon.invalid'); // gerçek e-posta değil, anonim
    expect(u!.email).not.toContain('ornek'); // orijinal PII izi yok
    expect(u!.isActive).toBe(false);
  });
});

describe('anonymizeUser → bağlı serbest-metin PII temizlenir (madde 93)', () => {
  let tenantId: string;
  let userA: string; // anonimleşen
  let userB: string; // karşı taraf (korunur)
  let meetingId: string;

  const SECRET = 'GIZLI-PII-METIN-abc'; // orijinal metinlerde arayacağımız iz

  beforeEach(async () => {
    await cleanDb();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const a = await createUser({ tenantId, role: 'MENTOR' });
    const b = await createUser({ tenantId, role: 'MENTI' });
    userA = a.id;
    userB = b.id;

    const conversation = await testPrisma.conversation.create({
      data: { tenantId, mentorUserId: userA, mentiUserId: userB },
    });
    await testPrisma.message.create({
      data: { conversationId: conversation.id, senderUserId: userA, content: `A yazdı ${SECRET}` },
    });
    await testPrisma.message.create({
      data: { conversationId: conversation.id, senderUserId: userB, content: `B yazdı ${SECRET}` },
    });

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId, mentorUserId: userA, mentiUserId: userB,
        startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000),
        notes: `görüşme notu ${SECRET}`, requestMessage: `talep ${SECRET}`,
        phoneNumber: '+90 555 111 22 33', locationText: `adres ${SECRET}`,
      },
    });
    meetingId = meeting.id;
    await testPrisma.meetingCheckIn.create({
      data: {
        meetingId, tenantId, userId: userA, role: 'MENTOR',
        overallRating: 5, progressRating: 4, continueIntent: 'EVET',
        openNote: `serbest not ${SECRET}`, nextTopicNote: `sonraki ${SECRET}`,
      },
    });
    await testPrisma.feedback.create({
      data: {
        meetingId, tenantId, mentorId: userA, mentiId: userB,
        keyLearnings: `öğrenim ${SECRET}`, specificComments: `yorum ${SECRET}`,
        periodicCareerGrowth: `kariyer ${SECRET}`,
      },
    });
    await testPrisma.matchRequest.create({
      data: { tenantId, requesterUserId: userA, targetType: 'USER', targetId: userB, requestMessage: `talep ${SECRET}` },
    });
    await testPrisma.visibilityOptIn.create({
      data: { tenantId, mentorId: userA, mentiId: userB, iceBreaker: `buz ${SECRET}`, requestMessage: `opt ${SECRET}` },
    });
    await testPrisma.userReport.create({
      data: { tenantId, reporterUserId: userA, targetUserId: userB, reason: 'OTHER', description: `şikayet ${SECRET}` },
    });
    // mentiGoal MENTİ'nin verisidir → A'yı MENTİ olarak kur (mentiGoal A'ya ait, anonimleşince temizlenir).
    await testPrisma.mentorshipAgreement.create({
      data: {
        tenantId, mentorId: userB, mentiId: userA,
        meetingFrequency: 'WEEKLY', communicationChannel: 'ONLINE',
        durationWeeks: 12, targetMeetings: 12, mentiGoal: `hedef ${SECRET}`,
      },
    });
  });

  it('A\'nın yazdığı mesaj [silindi]; B\'nin mesajı KORUNUR (iki-taraflı)', async () => {
    await anonymizeUser(userA, tenantId);

    const msgA = await testPrisma.message.findFirst({ where: { senderUserId: userA } });
    const msgB = await testPrisma.message.findFirst({ where: { senderUserId: userB } });
    expect(msgA!.content).toBe('[silindi]');
    expect(msgB!.content).toContain(SECRET); // B'nin verisi dokunulmadı
  });

  it('tüm bağlı serbest-metin alanları temizlenir; MentorshipAgreement.mentiGoal placeholder', async () => {
    await anonymizeUser(userA, tenantId);

    const meeting = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(meeting!.notes).toBeNull();
    expect(meeting!.requestMessage).toBeNull();
    expect(meeting!.phoneNumber).toBeNull();
    expect(meeting!.locationText).toBeNull();

    const checkIn = await testPrisma.meetingCheckIn.findFirst({ where: { userId: userA } });
    expect(checkIn!.openNote).toBeNull();
    expect(checkIn!.nextTopicNote).toBeNull();

    const feedback = await testPrisma.feedback.findFirst({ where: { mentorId: userA } });
    expect(feedback!.keyLearnings).toBeNull();
    expect(feedback!.specificComments).toBeNull();
    expect(feedback!.periodicCareerGrowth).toBeNull();

    const matchReq = await testPrisma.matchRequest.findFirst({ where: { requesterUserId: userA } });
    expect(matchReq!.requestMessage).toBeNull();

    const optIn = await testPrisma.visibilityOptIn.findFirst({ where: { mentorId: userA } });
    expect(optIn!.iceBreaker).toBeNull();
    expect(optIn!.requestMessage).toBeNull();

    const report = await testPrisma.userReport.findFirst({ where: { reporterUserId: userA } });
    expect(report!.description).toBeNull();

    const agreement = await testPrisma.mentorshipAgreement.findFirst({ where: { mentiId: userA } });
    expect(agreement!.mentiGoal).toBe('[kaldırıldı]'); // NOT NULL → placeholder

    // Analitik alan korunur (skor silinmez) — regresyon
    const checkInScore = await testPrisma.meetingCheckIn.findFirst({ where: { userId: userA } });
    expect(checkInScore!.overallRating).toBe(5);
  });

  it('YENİDEN-TANIMLAMA: A\'ya ait hiçbir kayıtta orijinal serbest-metin izi kalmaz', async () => {
    await anonymizeUser(userA, tenantId);

    // A'nın yazdığı/hakkında olan tüm serbest metinleri topla, SECRET aranmaz olmalı.
    const [msgs, meeting, checkIn, feedback, matchReq, optIn, report, agreement] = await Promise.all([
      testPrisma.message.findMany({ where: { senderUserId: userA } }),
      testPrisma.meeting.findUnique({ where: { id: meetingId } }),
      testPrisma.meetingCheckIn.findFirst({ where: { userId: userA } }),
      testPrisma.feedback.findFirst({ where: { mentorId: userA } }),
      testPrisma.matchRequest.findFirst({ where: { requesterUserId: userA } }),
      testPrisma.visibilityOptIn.findFirst({ where: { mentorId: userA } }),
      testPrisma.userReport.findFirst({ where: { reporterUserId: userA } }),
      testPrisma.mentorshipAgreement.findFirst({ where: { mentiId: userA } }),
    ]);
    const blob = JSON.stringify({ msgs, meeting, checkIn, feedback, matchReq, optIn, report, agreement });
    expect(blob).not.toContain(SECRET);
  });
});

describe('anonymizeUser → oturum/token iptali (madde 39)', () => {
  it('TenantMembership.isActive=false + RefreshToken silinir', async () => {
    await cleanDb();
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    await testPrisma.refreshToken.create({
      data: { token: `tok-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await anonymizeUser(user.id, tenant.id);

    const membership = await testPrisma.tenantMembership.findFirst({ where: { userId: user.id } });
    expect(membership!.isActive).toBe(false);
    const tokens = await testPrisma.refreshToken.count({ where: { userId: user.id } });
    expect(tokens).toBe(0);
  });

  it('HTTP: anonimleştirilen kullanıcı ESKİ access token ile işlem yapamaz (403)', async () => {
    await cleanDb();
    const http = agent();
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    // Token geçerliyken erişebiliyor (kontrol)
    await http.get('/api/users/mentor-count').set(tenantHeaders(tenant.id, accessToken)).expect(200);

    // Anonimleştir → membership pasif → aynı token artık reddedilmeli
    await anonymizeUser(user.id, tenant.id);
    const res = await http.get('/api/users/mentor-count').set(tenantHeaders(tenant.id, accessToken));
    expect(res.status).toBe(403);
  });
});

describe('hardDeleteUser → anonimleştirmeye yönlendirir (madde 39)', () => {
  it('kullanıcı satırı SİLİNMEZ, anonimleştirilir (anonymizedInstead=true)', async () => {
    await cleanDb();
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR' });

    const result = await hardDeleteUser(user.id, tenant.id);
    expect(result.anonymizedInstead).toBe(true);

    // Satır hâlâ var (silinmedi) ama anonim + pasif
    const u = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(u).not.toBeNull();
    expect(u!.isActive).toBe(false);
    expect(u!.email).toContain('@anon.invalid');
    expect(u!.fullName).toBe('[Silinmiş Kullanıcı]');
  });
});
