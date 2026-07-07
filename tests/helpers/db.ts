/**
 * Test veritabanı yardımcıları.
 *
 * cleanDb(): Tüm tenant-scope tabloları temizler (silme sırası FK kısıtlarına uyar).
 * Her describe bloğunun beforeEach veya beforeAll'unda çağrılır.
 */

import { PrismaClient } from '@prisma/client';

export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL'] } },
});

/**
 * Tabloları FK bağımlılık sırasına göre temizler.
 * Transaction kullanılır; kısmi temizlik önlenir.
 */
export async function cleanDb(): Promise<void> {
  await testPrisma.$transaction([
    testPrisma.userResponse.deleteMany(),
    testPrisma.feedbackLog.deleteMany(),
    testPrisma.feedback.deleteMany(),
    testPrisma.meeting.deleteMany(),
    testPrisma.pendingTag.deleteMany(),
    testPrisma.passwordResetToken.deleteMany(),
    testPrisma.refreshToken.deleteMany(),
    testPrisma.matchRequest.deleteMany(),
    testPrisma.visibilityOptIn.deleteMany(),
    testPrisma.matchCombinationScore.deleteMany(),
    testPrisma.clubMembership.deleteMany(),
    testPrisma.club.deleteMany(),
    testPrisma.question.deleteMany(),
    testPrisma.systemLog.deleteMany(),
    testPrisma.user.deleteMany(),
    testPrisma.tenant.deleteMany(),
  ]);
}

/** Test sonunda bağlantıyı kapat. */
export async function disconnectDb(): Promise<void> {
  await testPrisma.$disconnect();
}
