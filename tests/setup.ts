/**
 * Test dosyası setup — her test dosyasından önce çalışır.
 * DATABASE_URL'i TEST_DATABASE_URL'e yönlendirir (config.ts'den önce).
 */

import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test', override: true });

// TEST_DATABASE_URL varsa DATABASE_URL'i override et
const testDbUrl = process.env['TEST_DATABASE_URL'];
if (testDbUrl) {
  process.env['DATABASE_URL'] = testDbUrl;
}

// Production güvenlik kontrollerini test ortamında devre dışı bırak
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-min-32-chars-for-testing-only!!';
process.env['PLATFORM_ADMIN_KEY'] = 'test-platform-key';
