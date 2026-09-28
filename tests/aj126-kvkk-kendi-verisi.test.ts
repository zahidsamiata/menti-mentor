/**
 * AJ-126 (a) — KVKK "verilerimi indir" çıktısında kişinin KENDİ ürettiği / kendisine ait veri
 * (entegrasyon).
 *
 * NEDEN: KVKK Md.11 erişim hakkı — önceki dışa aktarma profilden yalnız 13 alan, mesajdan yalnız
 * sayı veriyordu; mizaç sonucu, sosyal hesaplar, müsaitlik, kulüp, önerilen etiket, görüşme
 * talebi/check-in/değerlendirme, şikâyet, anlaşma, konuşma ve gönderilen mesaj içerikleri yoktu.
 * Kaynak: 7b #298 (a)/(b) ayrımı, 00-KUYRUK AJ-126.
 *
 * Ölçüt:
 *  - kişinin iki kurumdaki (ev + misafir) kendi kayıtları kendi dışa aktarımında VAR;
 *  - başka kişinin satırı / karşı tarafın kişisel verisi (ad, e-posta, id) YOK;
 *  - (b) ayağı — başkasının kişi hakkında yazdıkları (red gerekçesi, görüşme notu, karşı tarafın
 *    değerlendirmesi, alınan mesaj, şikâyet incelemesi) YOK (KARAR-138 bekliyor);
 *  - parola/hash ve oturum izi YOK (negatif);
 *  - kurum yöneticisi dışa aktarınca yalnız KENDİ kurumundaki kayıtlar.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser, createUserProfile } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { signToken } from '../src/middleware/jwtAuth.js';

type Row = Record<string, unknown>;
type ExportBody = {
  userId: string;
  profile: Row;
  userProfile: Row | null;
  mentorFilter: Row | null;
  availabilityBlocks: Row[];
  clubMemberships: Array<Row & { club: { name: string } }>;
  suggestedTags: Row[];
  visibilityRequests: Row[];
  meetings: Row[];
  meetingCheckIns: Row[];
  meetingFeedbacks: Row[];
  matchFeedbacks: Row[];
  reportsMade: Row[];
  agreements: Row[];
  conversations: Row[];
  messagesSent: Row[];
  feedbackLogs: Row[];
  matchRequests: Row[];
};

// Kişinin KENDİ verisi — kurum A (ev) ve kurum B (misafir).
const OWN_A = {
  tag: 'aj126-etiket-a',
  meetingRequest: 'aj126-talep-kendi',
  phone: '5550001126',
  checkIn: 'aj126-checkin-kendi',
  menteeFeedbackMarker: 5, // guidanceScore — mentinin mentöre verdiği puan (kendi yazdığı)
  matchFeedback: 'aj126-eslesme-a-kendi',
  agreementGoal: 'aj126-hedef-kendi-uzun-metin',
  message: 'aj126-mesaj-kendi-a',
  requestMessage: 'aj126-istek-mesaj-kendi',
};
const OWN_B = {
  tag: 'aj126-etiket-b',
  locationUrl: 'https://aj126.example/kendi-baglanti',
  feedbackComment: 'aj126-kendi-yorum-mentor',
  matchFeedback: 'aj126-eslesme-b-kendi',
  report: 'aj126-sikayet-kendi',
  iceBreaker: 'aj126-buz-kendi',
  message: 'aj126-mesaj-kendi-b',
  goalAchieved: 'aj126-hedef-ulasti-kendi',
};
const OWN_GLOBAL = {
  linkedin: 'https://linkedin.example/aj126-kendi',
  temperament: 'aj126-mizac-kendi',
  school: 'aj126-okul-kendi',
};
// (b) ayağı / karşı taraf / başka kişi — HİÇBİR çıktıda olmamalı.
const FORBIDDEN = [
  'aj126-red-gerekcesi-GIZLI',
  'aj126-not-GIZLI',
  'aj126-not-b-GIZLI',
  'aj126-mentor-yorumu-GIZLI',
  'aj126-checkin-yabanci',
  'aj126-eslesme-yabanci',
  'aj126-sikayet-hakkinda-GIZLI',
  'aj126-inceleme-GIZLI',
  'aj126-hedef-karsi-GIZLI',
  'aj126-mesaj-alinan-GIZLI',
  'aj126-hedef-hakkinda-GIZLI',
  'aj126-talep-karsi-GIZLI',
  'aj126-buz-yabanci',
  'aj126-etiket-yabanci',
  'aj126-talep-yabanci',
];

function keysDeep(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, acc));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      keysDeep(v, acc);
    }
  }
  return acc;
}

describe('AJ-126 — dışa aktarmada kişinin kendi verisi', () => {
  let http: TestAgent;
  let tenantA: { id: string };
  let tenantB: { id: string };
  let person: Awaited<ReturnType<typeof createUser>>;
  let mentorA: Awaited<ReturnType<typeof createUser>>;
  let mentiB: Awaited<ReturnType<typeof createUser>>;
  let adminA: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant({ name: 'Kurum Alfa AJ126' });
    tenantB = await createTenant({ name: 'Kurum Beta AJ126' });

    person = await createUser({ tenantId: tenantA.id, role: 'MENTI' });
    await testPrisma.tenantMembership.create({
      data: { userId: person.id, tenantId: tenantB.id, role: 'MENTOR', isActive: true },
    });
    mentorA = await createUser({ tenantId: tenantA.id, role: 'MENTOR' });
    mentiB = await createUser({ tenantId: tenantB.id, role: 'MENTI' });
    adminA = await createUser({ tenantId: tenantA.id, role: 'ADMIN' });

    // Profil: kendi alanları + (b) alanları + oturum izi.
    await testPrisma.user.update({
      where: { id: person.id },
      data: {
        linkedinUrl: OWN_GLOBAL.linkedin,
        temperamentJson: { note: OWN_GLOBAL.temperament },
        rejectionReason: 'aj126-red-gerekcesi-GIZLI',
        approvedBy: adminA.id,
        lastLoginAt: new Date(),
      },
    });
    const personProfile = await createUserProfile(person.id, { schools: [OWN_GLOBAL.school] });
    await testPrisma.userProfile.update({ where: { id: personProfile.id }, data: { qualityMultiplier: 0.77 } });
    const mentorAProfile = await createUserProfile(mentorA.id, { archetypeRole: 'MENTOR' });
    const mentiBProfile = await createUserProfile(mentiB.id);
    await testPrisma.mentorFilter.create({ data: { mentorId: person.id, minCompatibilityScore: 42 } });

    await testPrisma.availabilityBlock.createMany({
      data: [
        { userId: person.id, tenantId: tenantA.id, weekday: 'MON', startTime: '09:00', endTime: '10:00' },
        { userId: person.id, tenantId: tenantB.id, weekday: 'TUE', startTime: '11:00', endTime: '12:00' },
        { userId: mentiB.id, tenantId: tenantB.id, weekday: 'WED', startTime: '13:00', endTime: '14:00' },
      ],
    });

    const clubA = await testPrisma.club.create({ data: { tenantId: tenantA.id, name: 'Kulüp A AJ126', slug: 'aj126-a', type: 'AKADEMIK' } });
    const clubB = await testPrisma.club.create({ data: { tenantId: tenantB.id, name: 'Kulüp B AJ126', slug: 'aj126-b', type: 'SOSYAL' } });
    await testPrisma.clubMembership.createMany({
      data: [
        { tenantId: tenantA.id, clubId: clubA.id, userId: person.id },
        { tenantId: tenantB.id, clubId: clubB.id, userId: person.id },
        { tenantId: tenantB.id, clubId: clubB.id, userId: mentiB.id },
      ],
    });

    await testPrisma.pendingTag.createMany({
      data: [
        { tenantId: tenantA.id, value: OWN_A.tag, submittedBy: person.id },
        { tenantId: tenantB.id, value: OWN_B.tag, submittedBy: person.id },
        { tenantId: tenantB.id, value: 'aj126-etiket-yabanci', submittedBy: mentiB.id },
      ],
    });

    await testPrisma.visibilityOptIn.createMany({
      data: [
        // Kişi MENTÖR ve başlatan (kendi yazdığı) — B kurumunda.
        { tenantId: tenantB.id, mentorId: person.id, mentiId: mentiB.id, initiatedBy: 'MENTOR', iceBreaker: OWN_B.iceBreaker },
        // Kişi MENTİ, başlatan karşı taraf (mentör) → kişinin yazdığı değil.
        { tenantId: tenantA.id, mentorId: mentorA.id, mentiId: person.id, initiatedBy: 'MENTOR', iceBreaker: 'aj126-buz-yabanci' },
      ],
    });

    const startsAt = new Date('2026-10-01T10:00:00Z');
    const endsAt = new Date('2026-10-01T11:00:00Z');
    // A: kişi MENTİ (talebi kendisi yazdı), mentörün notu (b).
    const meetingA = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA.id, mentorUserId: mentorA.id, mentiUserId: person.id, startsAt, endsAt,
        format: 'PHONE', status: 'COMPLETED',
        requestMessage: OWN_A.meetingRequest, phoneNumber: OWN_A.phone, notes: 'aj126-not-GIZLI',
      },
    });
    // B: kişi MENTÖR (bağlantıyı kendisi girdi); talep mesajı karşı tarafın.
    const meetingB = await testPrisma.meeting.create({
      data: {
        tenantId: tenantB.id, mentorUserId: person.id, mentiUserId: mentiB.id, startsAt, endsAt,
        format: 'ONLINE', status: 'COMPLETED',
        requestMessage: 'aj126-talep-karsi-GIZLI', locationUrl: OWN_B.locationUrl, notes: 'aj126-not-b-GIZLI',
      },
    });
    // Kişinin taraf olmadığı görüşme.
    await testPrisma.meeting.create({
      data: {
        tenantId: tenantB.id, mentorUserId: mentorA.id, mentiUserId: mentiB.id, startsAt, endsAt,
        requestMessage: 'aj126-talep-yabanci',
      },
    });

    await testPrisma.feedback.createMany({
      data: [
        // A: kişi menti → kendi yazdığı guidanceScore; mentörün kişi hakkında yazdıkları (b).
        {
          meetingId: meetingA.id, tenantId: tenantA.id, mentorId: mentorA.id, mentiId: person.id,
          guidanceScore: OWN_A.menteeFeedbackMarker, preparednessScore: 1, keyLearnings: 'aj126-mentor-yorumu-GIZLI',
        },
        // B: kişi mentör → kendi yorumu; mentinin kişi hakkında verdiği güven puanı (b).
        {
          meetingId: meetingB.id, tenantId: tenantB.id, mentorId: person.id, mentiId: mentiB.id,
          keyLearnings: OWN_B.feedbackComment, trustScore: 2,
        },
      ],
    });

    await testPrisma.meetingCheckIn.createMany({
      data: [
        { meetingId: meetingA.id, tenantId: tenantA.id, userId: person.id, role: 'MENTI', overallRating: 4, progressRating: 3, continueIntent: 'EVET', openNote: OWN_A.checkIn },
        { meetingId: meetingA.id, tenantId: tenantA.id, userId: mentorA.id, role: 'MENTOR', overallRating: 2, progressRating: 2, continueIntent: 'HAYIR', openNote: 'aj126-checkin-yabanci' },
      ],
    });

    const matchA = await testPrisma.match.create({
      data: {
        tenantId: tenantA.id, mentorId: mentorAProfile.id, mentiId: personProfile.id,
        predictedScore: 0.5, sectorScore: 0.5, characterScore: 0.5, mentorArchetype: 'x', mentiArchetype: 'y',
      },
    });
    const matchB = await testPrisma.match.create({
      data: {
        tenantId: tenantB.id, mentorId: personProfile.id, mentiId: mentiBProfile.id,
        predictedScore: 0.5, sectorScore: 0.5, characterScore: 0.5, mentorArchetype: 'x', mentiArchetype: 'y',
      },
    });
    await testPrisma.matchFeedback.createMany({
      data: [
        { matchId: matchA.id, checkpoint: 'DAY_3', fromUserId: person.id, role: 'MENTI', comment: OWN_A.matchFeedback },
        { matchId: matchB.id, checkpoint: 'DAY_3', fromUserId: person.id, role: 'MENTOR', comment: OWN_B.matchFeedback },
        { matchId: matchA.id, checkpoint: 'DAY_3', fromUserId: mentorA.id, role: 'MENTOR', comment: 'aj126-eslesme-yabanci' },
      ],
    });

    await testPrisma.userReport.createMany({
      data: [
        { tenantId: tenantB.id, reporterUserId: person.id, targetUserId: mentiB.id, reason: 'SPAM', description: OWN_B.report, reviewNote: 'aj126-inceleme-GIZLI', reviewedBy: adminA.id },
        { tenantId: tenantA.id, reporterUserId: mentorA.id, targetUserId: person.id, reason: 'OTHER', description: 'aj126-sikayet-hakkinda-GIZLI' },
      ],
    });

    const agreementBase = { meetingFrequency: 'WEEKLY', communicationChannel: 'ONLINE', durationWeeks: 12, targetMeetings: 6 };
    await testPrisma.mentorshipAgreement.createMany({
      data: [
        { ...agreementBase, tenantId: tenantA.id, mentorId: mentorA.id, mentiId: person.id, mentiGoal: OWN_A.agreementGoal, mentorConfirmedAt: new Date() },
        { ...agreementBase, tenantId: tenantB.id, mentorId: person.id, mentiId: mentiB.id, mentiGoal: 'aj126-hedef-karsi-GIZLI' },
      ],
    });

    const convA = await testPrisma.conversation.create({
      data: { tenantId: tenantA.id, mentorUserId: mentorA.id, mentiUserId: person.id, mentiLastReadAt: new Date() },
    });
    const convB = await testPrisma.conversation.create({
      data: { tenantId: tenantB.id, mentorUserId: person.id, mentiUserId: mentiB.id },
    });
    await testPrisma.message.createMany({
      data: [
        { conversationId: convA.id, senderUserId: person.id, content: OWN_A.message },
        { conversationId: convB.id, senderUserId: person.id, content: OWN_B.message },
        { conversationId: convA.id, senderUserId: mentorA.id, content: 'aj126-mesaj-alinan-GIZLI' },
      ],
    });

    await testPrisma.feedbackLog.createMany({
      data: [
        { tenantId: tenantB.id, mentorId: person.id, mentiId: mentiB.id, phase: 1, starRating: 5, goalAchieved: OWN_B.goalAchieved },
        { tenantId: tenantA.id, mentorId: mentorA.id, mentiId: person.id, phase: 1, starRating: 3, goalAchieved: 'aj126-hedef-hakkinda-GIZLI' },
      ],
    });
    await testPrisma.matchRequest.create({
      data: { tenantId: tenantA.id, requesterUserId: person.id, targetType: 'JOB_LISTING', targetId: 'aj126-ilan', requestMessage: OWN_A.requestMessage },
    });
  });

  async function assertNoSecretsOrOthers(body: ExportBody) {
    const blob = JSON.stringify(body);
    for (const marker of FORBIDDEN) expect(blob, `yasak veri sızdı: ${marker}`).not.toContain(marker);
    // Karşı tarafın / başka kişinin kimliği ve kişisel verisi yok.
    for (const other of [mentorA, mentiB, adminA]) {
      expect(blob).not.toContain(other.id);
      expect(blob).not.toContain(other.email);
      expect(blob).not.toContain(other.fullName);
    }
    // Negatif: parola / hash / oturum izi / (b) profil alanları hiçbir düzeyde yok.
    const keys = keysDeep(body);
    for (const k of ['password', 'lastLoginAt', 'rejectionReason', 'approvedBy', 'rejectedBy', 'qualityMultiplier', 'notes', 'reviewNote', 'targetUserId']) {
      expect(keys.has(k), `yasak alan: ${k}`).toBe(false);
    }
    const stored = await testPrisma.user.findUnique({ where: { id: person.id }, select: { password: true } });
    expect(stored?.password).toBeTruthy();
    expect(blob).not.toContain(stored!.password!);
    expect(blob).not.toContain(person.rawPassword);
  }

  async function assertAllOwnData(body: ExportBody) {
    expect(body.userId).toBe(person.id);
    // Profil + kişi-genel kayıtlar.
    expect(body.profile.linkedinUrl).toBe(OWN_GLOBAL.linkedin);
    expect(body.profile.temperamentJson).toEqual({ note: OWN_GLOBAL.temperament });
    expect(body.userProfile?.schools).toEqual([OWN_GLOBAL.school]);
    expect(body.mentorFilter?.minCompatibilityScore).toBe(42);
    // İki kurumdaki kendi kayıtları.
    expect(body.availabilityBlocks.map((b) => b.tenantId).sort()).toEqual([tenantA.id, tenantB.id].sort());
    expect(body.clubMemberships.map((c) => c.club.name).sort()).toEqual(['Kulüp A AJ126', 'Kulüp B AJ126']);
    expect(body.suggestedTags.map((t) => t.value).sort()).toEqual([OWN_A.tag, OWN_B.tag]);
    expect(body.visibilityRequests).toHaveLength(1);
    expect(body.visibilityRequests[0]!.iceBreaker).toBe(OWN_B.iceBreaker);

    expect(body.meetings).toHaveLength(2);
    const asMenti = body.meetings.find((m) => m.side === 'MENTI')!;
    const asMentor = body.meetings.find((m) => m.side === 'MENTOR')!;
    expect(asMenti.requestMessage).toBe(OWN_A.meetingRequest);
    expect(asMenti.phoneNumber).toBe(OWN_A.phone);
    expect(asMenti).not.toHaveProperty('locationUrl');
    expect(asMentor.locationUrl).toBe(OWN_B.locationUrl);
    expect(asMentor).not.toHaveProperty('requestMessage');

    expect(body.meetingFeedbacks).toHaveLength(2);
    const fbMenti = body.meetingFeedbacks.find((f) => f.side === 'MENTI')!;
    const fbMentor = body.meetingFeedbacks.find((f) => f.side === 'MENTOR')!;
    expect(fbMenti.guidanceScore).toBe(OWN_A.menteeFeedbackMarker);
    expect(fbMenti).not.toHaveProperty('preparednessScore');
    expect(fbMentor.keyLearnings).toBe(OWN_B.feedbackComment);
    expect(fbMentor).not.toHaveProperty('trustScore');

    expect(body.meetingCheckIns.map((c) => c.openNote)).toEqual([OWN_A.checkIn]);
    expect(body.matchFeedbacks.map((f) => f.comment).sort()).toEqual([OWN_A.matchFeedback, OWN_B.matchFeedback].sort());
    expect(body.reportsMade).toEqual([
      expect.objectContaining({ description: OWN_B.report, reason: 'SPAM', tenantId: tenantB.id }),
    ]);

    expect(body.agreements).toHaveLength(2);
    const agMenti = body.agreements.find((a) => a.side === 'MENTI')!;
    const agMentor = body.agreements.find((a) => a.side === 'MENTOR')!;
    expect(agMenti.mentiGoal).toBe(OWN_A.agreementGoal);
    expect(agMenti).not.toHaveProperty('mentorConfirmedAt');
    expect(agMentor).not.toHaveProperty('mentiGoal');

    expect(body.conversations).toHaveLength(2);
    const convMenti = body.conversations.find((c) => c.side === 'MENTI')!;
    expect(convMenti.lastReadAt).toBeTruthy();
    for (const c of body.conversations) {
      expect(Object.keys(c).sort()).toEqual(['createdAt', 'id', 'lastMessageAt', 'lastReadAt', 'side', 'tenantId', 'updatedAt']);
    }
    expect(body.messagesSent.map((m) => m.content).sort()).toEqual([OWN_A.message, OWN_B.message]);

    const mentorLog = body.feedbackLogs.find((f) => f.goalAchieved !== undefined);
    expect(mentorLog?.goalAchieved).toBe(OWN_B.goalAchieved);
    expect(body.matchRequests.map((r) => r.requestMessage)).toEqual([OWN_A.requestMessage]);

    await assertNoSecretsOrOthers(body);
  }

  it('ev kurumu (A) oturumunda kişi iki kurumdaki kendi verisinin tamamını alır; başkasınınki yok', async () => {
    const { accessToken } = await loginAs(http, person.email, person.rawPassword);
    const res = await http.get('/api/me/data-export').set(tenantHeaders(tenantA.id, accessToken)).expect(200);
    await assertAllOwnData(res.body as ExportBody);

    const own = await http.get(`/api/users/${person.id}/export`).set(tenantHeaders(tenantA.id, accessToken)).expect(200);
    await assertAllOwnData(own.body as ExportBody);
  });

  it('misafir kurum (B) oturumunda da aynı kendi verisi gelir', async () => {
    const token = signToken({ sub: person.id, tenantId: tenantB.id, role: 'MENTOR', fullName: person.fullName });
    const res = await http.get('/api/me/data-export').set(tenantHeaders(tenantB.id, token)).expect(200);
    await assertAllOwnData(res.body as ExportBody);
  });

  it('kurum A yöneticisi kişiyi dışa aktarınca yalnız A kurumundaki kayıtlar görünür', async () => {
    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http.get(`/api/users/${person.id}/export`).set(tenantHeaders(tenantA.id, accessToken)).expect(200);
    const body = res.body as ExportBody;
    const blob = JSON.stringify(body);

    // A kayıtları var.
    expect(body.availabilityBlocks.map((b) => b.tenantId)).toEqual([tenantA.id]);
    expect(body.clubMemberships.map((c) => c.club.name)).toEqual(['Kulüp A AJ126']);
    expect(body.suggestedTags.map((t) => t.value)).toEqual([OWN_A.tag]);
    expect(body.meetings.map((m) => m.side)).toEqual(['MENTI']);
    expect(body.meetingFeedbacks.map((f) => f.side)).toEqual(['MENTI']);
    expect(body.meetingCheckIns.map((c) => c.openNote)).toEqual([OWN_A.checkIn]);
    expect(body.matchFeedbacks.map((f) => f.comment)).toEqual([OWN_A.matchFeedback]);
    expect(body.agreements.map((a) => a.side)).toEqual(['MENTI']);
    expect(body.conversations.map((c) => c.side)).toEqual(['MENTI']);
    expect(body.messagesSent.map((m) => m.content)).toEqual([OWN_A.message]);
    expect(body.reportsMade).toEqual([]);
    expect(body.visibilityRequests).toEqual([]);
    expect(body.userProfile?.schools).toEqual([OWN_GLOBAL.school]);

    // B kurumundaki hiçbir kayıt yok.
    expect(blob).not.toContain(tenantB.id);
    for (const marker of Object.values(OWN_B)) expect(blob, `B kaydı sızdı: ${marker}`).not.toContain(marker);
    // (b) alanları / başkasının verisi / sır yönetici yolunda da yok.
    for (const marker of FORBIDDEN) expect(blob, `yasak veri sızdı: ${marker}`).not.toContain(marker);
    expect(keysDeep(body).has('password')).toBe(false);
  });
});
