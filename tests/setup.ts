/**
 * Test dosyası setup — her test dosyasından önce çalışır.
 * DATABASE_URL'i TEST_DATABASE_URL'e yönlendirir (config.ts'den önce).
 */

import { config as loadEnv } from 'dotenv';
import { beforeEach } from 'vitest';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

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
// Rate-limit eşiklerini suite geneli için YÜKSEK tut → meşru testler (ör. tenant-verification'da
// 9 self-serve register) 429 yemez. Dedicated rate-limit testleri kendi beforeEach'inde düşürür.
process.env['SELF_SERVE_REGISTER_RATE_RPM'] = '1000';

// Her testten önce in-memory rate-limit sayaçlarını sıfırla. Suite genelinde aynı IP
// sayacına düşen çok sayıda login, loginRateLimiter'ı tetikleyip meşru testleri 429'la
// bozmasın (.env.test'e/CI env'ine bağımlı olmadan çalışır).
beforeEach(() => {
  resetRateLimiters();
});
