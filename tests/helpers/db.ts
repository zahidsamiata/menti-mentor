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
 * Tüm test verilerini tek seferde siler.
 * TRUNCATE ... CASCADE: FK bağımlılık sırası yerine PostgreSQL'e bırakılır;
 * Neon serverless pooler'ında $transaction([...]) array'inin FK sıra sorununu önler.
 */
export async function cleanDb(): Promise<void> {
  await testPrisma.$executeRaw`
    TRUNCATE TABLE "User", "Tenant", "SystemLog" CASCADE
  `;
}

/** Test sonunda bağlantıyı kapat. */
export async function disconnectDb(): Promise<void> {
  await testPrisma.$disconnect();
}
