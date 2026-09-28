/**
 * AN-30 / KARAR-34 (OAuth ayağı) — "bekleyen OAuth kaydı" token servisi birim testleri.
 *
 * Saf fonksiyon testi (DB/HTTP GEREKMEZ) — `invitationToken.ts` için yazılmış desenle aynı ruhta:
 * imzala → doğrula round-trip, süresi geçmiş/bozuk/yanlış-tip token → null.
 *
 * Not: `vitest.config.ts`'teki `globalSetup` TÜM suite için TEST_DATABASE_URL zorunlu kıldığından
 * (bu dosya DB'ye dokunmasa bile) yerelde TEST_DATABASE_URL yokken bu dosya da diğerleri gibi
 * guard'la durur — CLAUDE.md "verify ↔ CI farkı" notuyla tutarlı. Mantık ayrıca DB'siz bir
 * `tsx` script'iyle bağımsız doğrulandı (bkz. PR açıklaması / ajan raporu).
 */
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signPendingOAuthRegistration,
  verifyPendingOAuthRegistration,
  type PendingOAuthRegistrationPayload,
} from '../src/services/oauth/oauthPendingRegistration.js';

const JWT_SECRET = process.env['JWT_SECRET'] as string; // tests/setup.ts sabit test değeri set eder

const SAMPLE_PAYLOAD: PendingOAuthRegistrationPayload = {
  email: 'bekleyen@test.local',
  fullName: 'Bekleyen Kullanıcı',
  provider: 'GOOGLE',
  avatarUrl: 'https://example.test/avatar.png',
  tenantId: 'tenant-123',
  role: 'MENTI',
  approvalStatus: 'PENDING',
};

describe('oauthPendingRegistration — sign/verify round-trip', () => {
  it('imzalanan token doğrulanınca AYNI payload\'ı döner (fazladan alan sızdırmaz)', () => {
    const token = signPendingOAuthRegistration(SAMPLE_PAYLOAD);
    const result = verifyPendingOAuthRegistration(token);
    expect(result).toEqual(SAMPLE_PAYLOAD);
  });

  it('avatarUrl olmadan da (opsiyonel alan) round-trip çalışır', () => {
    const { avatarUrl: _avatarUrl, ...withoutAvatar } = SAMPLE_PAYLOAD;
    const token = signPendingOAuthRegistration(withoutAvatar);
    const result = verifyPendingOAuthRegistration(token);
    expect(result).toEqual(withoutAvatar);
  });

  it('süresi geçmiş token → null (10 dk pencere kapanmış)', () => {
    // signPendingOAuthRegistration expiresIn'i sabitler; süre dolmuş bir token'ı doğrudan
    // craft ederek test ediyoruz (fake timer beklemeye gerek yok — invitationToken.ts
    // testlerinde de kullanılan yaklaşımla aynı ruhta: geçersiz/expired girdi → null).
    const expiredToken = jwt.sign(
      { ...SAMPLE_PAYLOAD, type: 'oauth_pending_registration', exp: Math.floor(Date.now() / 1000) - 60 },
      JWT_SECRET,
    );
    expect(verifyPendingOAuthRegistration(expiredToken)).toBeNull();
  });

  it('bozuk/rastgele token → null', () => {
    expect(verifyPendingOAuthRegistration('bozuk.token.degeri')).toBeNull();
    expect(verifyPendingOAuthRegistration('')).toBeNull();
  });

  it('yanlış imza (başka secret) → null', () => {
    const wrongSecretToken = jwt.sign(
      { ...SAMPLE_PAYLOAD, type: 'oauth_pending_registration' },
      'baska-bir-secret-en-az-32-karakter-uzunlugunda!!',
      { expiresIn: '10m' },
    );
    expect(verifyPendingOAuthRegistration(wrongSecretToken)).toBeNull();
  });

  it('doğru imza ama yanlış `type` (ör. davet token\'ı) → null (tip karışması engellenir)', () => {
    const invitationLikeToken = jwt.sign(
      { tenantId: 'tenant-123', role: 'MENTI', type: 'invitation' },
      JWT_SECRET,
      { expiresIn: '10m' },
    );
    expect(verifyPendingOAuthRegistration(invitationLikeToken)).toBeNull();
  });
});
