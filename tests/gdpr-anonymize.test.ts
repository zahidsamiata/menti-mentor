/**
 * Madde 93 — anonimleştirme kapsamı: yeni eklenen User PII alanlarının
 * (avatarUrl / linkedinUrl / instagramUrl / enneagramWing / discResultCard)
 * anonymizeUser sonrası temizlendiğini kanıtlar (KVKK saklama-imha vaadi).
 *
 * NOT (dürüst kapsam): mesaj içeriği, fiziksel foto dosyası ve userId (PK) bağı
 * bu testin kapsamı DIŞINDA — bunlar madde 93'te açık uyum boşluğu olarak izlenir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { anonymizeUser } from '../src/services/gdprService.js';

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
