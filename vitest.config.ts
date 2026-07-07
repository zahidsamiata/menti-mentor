/**
 * Vitest konfigürasyonu — ESM + TypeScript + Prisma uyumlu.
 *
 * Tasarım kararları:
 *  - pool: 'forks' → her test dosyası izole process'te çalışır;
 *    Prisma singleton ve Express app durumunu test dosyaları arasında sızdırmaz.
 *  - globalSetup: Test DB migration'ı bir kez uygular (tüm suite için).
 *  - setupFiles: Her test dosyasından önce env değişkenlerini yükler.
 *  - testTimeout: Supertest + DB round-trip için yeterli süre.
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    // Neon gibi paylaşımlı bulut DB'lerde paralel transaction'lar deadlock'a yol açar.
    // fileParallelism: false → tüm test dosyaları sıralı çalışır; deadlock önlenir.
    fileParallelism: false,
    globalSetup: './tests/globalSetup.ts',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/services/scoring.test-cases.ts'],
    },
  },
});
