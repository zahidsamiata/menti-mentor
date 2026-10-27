/**
 * AJ-126 — KVKK dışa aktarma: kişinin KENDİ verisi için şema-kapsam bekçisi (DB'siz).
 *
 * AJ-124 desenini (TenantMembership) User ve kişinin kendi kayıtlarını tutan modellere genişletir:
 * schema.prisma'daki her SKALER alan ya dışa aktarma select'lerinden birinde ya da gerekçeli hariç
 * listesinde olmalı (gdprOwnDataExport.ts OWN_DATA_EXPORT_COVERAGE). Şemaya yeni alan eklenip ikisine
 * de yazılmazsa bu test KIRMIZI olur → "verilerimi indir" çıktısı sessizce eksik kalmaz.
 * Ayrıca: sır/token/hash asla dışa aktarılmaz; (b) ayağı alanları (başkasının kişi hakkında
 * yazdıkları) KARAR-138 gerekçesiyle hariç kalır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  OWN_DATA_EXPORT_COVERAGE,
  EXPORT_PROFILE_SELECT,
  EXPORT_FEEDBACK_LOG_SELECT,
  EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT,
  EXPORT_USER_REPORT_SELECT,
  EXPORT_MEETING_AS_MENTI_SELECT,
  EXPORT_MEETING_AS_MENTOR_SELECT,
  EXPORT_FEEDBACK_AS_MENTOR_SELECT,
  EXPORT_FEEDBACK_AS_MENTI_SELECT,
  EXPORT_AGREEMENT_AS_MENTOR_SELECT,
  EXPORT_AGREEMENT_AS_MENTI_SELECT,
  PROFILE_EXPORT_EXCLUDED,
} from '../src/services/gdprOwnDataExport.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma');
const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');
const MODEL_NAMES = new Set([...SCHEMA.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));

/** Modelin skaler alan adları (ilişki alanları — tipi başka model olanlar — hariç). */
function scalarFields(model: string): string[] {
  const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm').exec(SCHEMA);
  if (!block) throw new Error(`schema.prisma içinde ${model} modeli bulunamadı`);
  const fields: string[] = [];
  for (const raw of block[1]!.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@@') || line.startsWith('/**') || line.startsWith('*')) continue;
    const m = /^(\w+)\s+(\w+)/.exec(line);
    if (!m) continue;
    const [, name, type] = m;
    if (MODEL_NAMES.has(type!)) continue;
    fields.push(name!);
  }
  return fields;
}

/** Select'lerdeki skaler anahtarlar (iç içe ilişki seçimi — değeri nesne olan — sayılmaz). */
function exportedScalars(selects: ReadonlyArray<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const s of selects) for (const [k, v] of Object.entries(s)) if (v === true) keys.add(k);
  return [...keys];
}

// Sır/kimlik bilgisi taşıyabilecek alan adları — dışa aktarmaya ASLA girmemeli.
const SECRET_NAME = /(password|hash|token|secret)/i;

describe('AJ-126 — kişinin kendi verisi: şema kapsamı', () => {
  const models = Object.keys(OWN_DATA_EXPORT_COVERAGE);

  it('kapsam kaydı beklenen modelleri içeriyor (User + (a) listesi)', () => {
    expect(models).toEqual(expect.arrayContaining([
      'User', 'FeedbackLog', 'MatchRequest', 'UserProfile', 'MentorFilter', 'AvailabilityBlock',
      'ClubMembership', 'PendingTag', 'VisibilityOptIn', 'Meeting', 'Feedback', 'MeetingCheckIn',
      'MatchFeedback', 'UserReport', 'MentorshipAgreement', 'Conversation', 'Message',
    ]));
  });

  it('şema ayrıştırması anlamlı (User\'ın bilinen alanları bulunuyor, ilişkiler sayılmıyor)', () => {
    const f = scalarFields('User');
    expect(f).toEqual(expect.arrayContaining(['password', 'email', 'temperamentJson', 'linkedinUrl', 'lastLoginAt']));
    expect(f).not.toContain('memberships');
    expect(f).not.toContain('tenant');
  });

  for (const [model, cov] of Object.entries(OWN_DATA_EXPORT_COVERAGE)) {
    describe(model, () => {
      const fields = scalarFields(model);
      const exported = exportedScalars(cov.selects);
      const excluded = Object.keys(cov.excluded);

      it('her şema alanı ya dışa aktarılıyor ya da gerekçeyle hariç tutuluyor', () => {
        const uncovered = fields.filter((f) => !exported.includes(f) && !excluded.includes(f));
        expect(uncovered, `${model}: yeni alan — gdprOwnDataExport.ts'de izin ya da hariç listesine ekle: ${uncovered.join(', ')}`).toEqual([]);
      });

      it('izin/hariç listeleri şemada olmayan alan içermiyor ve çakışmıyor', () => {
        expect(exported.filter((f) => !fields.includes(f))).toEqual([]);
        expect(excluded.filter((f) => !fields.includes(f))).toEqual([]);
        expect(exported.filter((f) => excluded.includes(f))).toEqual([]);
      });

      it('hariç tutulan her alanın gerekçesi yazılı', () => {
        for (const reason of Object.values(cov.excluded)) expect(reason.trim().length).toBeGreaterThan(10);
      });

      it('sır/token/hash adlı alan dışa aktarılmıyor', () => {
        expect(exported.filter((f) => SECRET_NAME.test(f))).toEqual([]);
      });
    });
  }

  it('User: parola hariç ("sır"), (b) alanları KARAR-138 gerekçesiyle hariç, oturum izi hariç', () => {
    expect(EXPORT_PROFILE_SELECT).not.toHaveProperty('password');
    expect(PROFILE_EXPORT_EXCLUDED['password']).toMatch(/Sır/);
    for (const f of ['approvedBy', 'rejectedBy', 'rejectionReason']) {
      expect(EXPORT_PROFILE_SELECT).not.toHaveProperty(f);
      expect(PROFILE_EXPORT_EXCLUDED[f]).toMatch(/KARAR-138/);
    }
    expect(EXPORT_PROFILE_SELECT).not.toHaveProperty('lastLoginAt');
  });

  it('User: ölçüt alanları (mizaç, geçmiş, sosyal hesaplar, beklenti/ihtiyaç/güçlü yön) dışa aktarılıyor', () => {
    expect(Object.keys(EXPORT_PROFILE_SELECT)).toEqual(expect.arrayContaining([
      'temperamentJson', 'discResultCard', 'enneagramWing', 'volunteerHistory', 'pastProjects',
      'education', 'linkedinUrl', 'instagramUrl', 'avatarUrl', 'expectationCategories', 'mentiNeeds',
      'mentorStrengths', 'supportApproach', 'priorityValue', 'timeCommitment', 'targetAudience',
    ]));
  });

  it('taraf bölümlemesi: karşı tarafın yazdığı alan kişinin tarafına verilmiyor', () => {
    // FeedbackLog: goalAchieved yalnız yazar (mentör) tarafında; menti satırları AJ-125 kümesi.
    expect(EXPORT_FEEDBACK_LOG_SELECT).not.toHaveProperty('goalAchieved');
    expect(EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT).toHaveProperty('goalAchieved', true);
    // Feedback (KARAR 1): mentöre menti puanları, mentiye mentör puanları/yorumları verilmez.
    for (const f of ['guidanceScore', 'resourceSharingScore', 'trustScore']) {
      expect(EXPORT_FEEDBACK_AS_MENTOR_SELECT).not.toHaveProperty(f);
    }
    for (const f of ['preparednessScore', 'keyLearnings', 'specificComments', 'periodicCareerGrowth']) {
      expect(EXPORT_FEEDBACK_AS_MENTI_SELECT).not.toHaveProperty(f);
    }
    // Meeting: notes hiçbir tarafta; menti girdisi mentöre, mentör bağlantısı mentiye verilmez.
    expect(EXPORT_MEETING_AS_MENTI_SELECT).not.toHaveProperty('notes');
    expect(EXPORT_MEETING_AS_MENTOR_SELECT).not.toHaveProperty('notes');
    expect(EXPORT_MEETING_AS_MENTOR_SELECT).not.toHaveProperty('phoneNumber');
    expect(EXPORT_MEETING_AS_MENTI_SELECT).not.toHaveProperty('locationUrl');
    // Anlaşma: menti hedefi mentöre verilmez; karşı tarafın onay anı verilmez.
    expect(EXPORT_AGREEMENT_AS_MENTOR_SELECT).not.toHaveProperty('mentiGoal');
    expect(EXPORT_AGREEMENT_AS_MENTOR_SELECT).not.toHaveProperty('mentiConfirmedAt');
    expect(EXPORT_AGREEMENT_AS_MENTI_SELECT).not.toHaveProperty('mentorConfirmedAt');
    // Şikâyet: şikâyet edilen kişi ve inceleme sonucu yok.
    for (const f of ['targetUserId', 'status', 'reviewNote', 'reviewedBy']) {
      expect(EXPORT_USER_REPORT_SELECT).not.toHaveProperty(f);
    }
  });
});
