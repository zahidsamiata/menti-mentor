/**
 * IC-11 — kullanıcıya dönen görüşme metinleri tek terimle ("görüşme"): menti "randevu" gönderip
 * mentörün "toplantı" alması bitti. Yalnız kullanıcıya giden metinlere bakar (yorum/günlük satırları hariç).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const USER_FACING_FILES = [
  'src/controllers/feedbackController.ts',
  'src/controllers/meetingController.ts',
  'src/services/emailService.ts',
];

function userFacingLines(file: string): string[] {
  return readFileSync(join(process.cwd(), file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => !/logger\.(info|warn|error|debug)\(/.test(line));
}

describe('IC-11 · görüşme terimi', () => {
  for (const file of USER_FACING_FILES) {
    it(`${file} kullanıcı metinlerinde "toplantı/randevu/buluşma" yok`, () => {
      const offenders = userFacingLines(file).filter((line) => /toplantı|randevu|buluşma/i.test(line));
      expect(offenders).toEqual([]);
    });
  }
});
