/**
 * AJ-57 — prisma/seed.ts için giriş kapısı (yan etkili modül).
 *
 * seed.ts bunu İLK import olarak yükler. ESM import'ları sırayla değerlendirildiği için bu kontrol,
 * seed.ts'in ve onun import ettiği seed-certification / seed-learning-journey modüllerinin
 * PrismaClient oluşturmasından ÖNCE çalışır. Böylece `tsx prisma/seed.ts` koruma betiği
 * atlanarak doğrudan çalıştırılsa da MENTI_TEHLIKELI_DB_ONAY=seed yoksa hiçbir DB işlemi yapılmaz.
 * (seed.ts içindeki KR-01 kontrolü — yerel host + SEED_ALLOW_DESTRUCTIVE — ayrıca geçerlidir.)
 */
import { checkDangerousDbApproval, DB_GUARD_REFUSED_EXIT_CODE } from '../src/dangerousDbGuard.js';

const decision = checkDangerousDbApproval('seed', process.env);
if (!decision.allowed) {
  console.error(decision.message);
  process.exit(DB_GUARD_REFUSED_EXIT_CODE);
}
