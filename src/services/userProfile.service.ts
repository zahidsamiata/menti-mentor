import type { UserProfile } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Verilen kullanıcı için bir UserProfile satırının var olmasını garanti eder (idempotent).
 *
 * - Kayıt zaten varsa mevcut satır aynen döndürülür (hiçbir alan sıfırlanmaz).
 * - Yoksa yalnızca varsayılan alanlarla (schema @default) oluşturulur.
 *
 * UserProfile.userId @unique olduğundan `upsert` yarış koşullarına karşı güvenlidir:
 * eşzamanlı iki çağrı tek satır üretir. `update: {}` bilinçli olarak boştur — bu fonksiyon
 * yalnızca satırın VARLIĞINI sağlar; alan doldurma (skillTags, DISC vb.) çağıranların işidir.
 *
 * Not: UserProfile'da doğrudan tenantId yoktur; tenant izolasyonu User ilişkisi üzerinden
 * sağlanır. Çağıran, userId'nin kimliği doğrulanmış/yetkili kullanıcıya ait olduğundan
 * emin olmalıdır (userId FK olduğundan var olmayan kullanıcı için oluşturma başarısız olur).
 */
export async function ensureUserProfile(userId: string): Promise<UserProfile> {
  return prisma.userProfile.upsert({
    where:  { userId },
    create: { userId },
    update: {},
  });
}
