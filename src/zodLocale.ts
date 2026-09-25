import { z } from 'zod';

/**
 * Zod doğrulama hataları için Türkçe varsayılan mesajlar (IC-05).
 *
 * Neden: şemalardaki kısıtların çoğu kendi mesajını yazmıyor; Zod'un İngilizce varsayılanı
 * ("Too big: expected string to have <=1000 characters") frontend'de doğrudan kullanıcıya
 * çıkıyordu (`frontend/src/lib/api/client.ts` ilk alan mesajını gösterir). Zod'un hazır `tr`
 * dili de teknik terim sızdırıyor ("beklenen string <=3 karakter", düzenli ifade deseni),
 * bu yüzden sade bir harita yazıldı. Şemada açıkça yazılan mesaj her zaman önceliklidir.
 *
 * Global ayar: `config.ts` bu modülü yükler — her giriş noktası (sunucu, test uygulaması,
 * betikler) config'i ilk yüklediği için ayar parse'tan önce devrededir.
 */
type Issue = Parameters<z.core.$ZodErrorMap>[0];

function sizeLimitMessage(origin: unknown, bound: unknown, kind: 'max' | 'min', inclusive: boolean | undefined): string {
  const n = typeof bound === 'bigint' ? bound.toString() : String(bound);
  if (origin === 'string') {
    if (kind === 'min' && Number(bound) <= 1 && inclusive !== false) return 'Bu alan boş bırakılamaz.';
    return kind === 'max' ? `En fazla ${n} karakter olabilir.` : `En az ${n} karakter olmalı.`;
  }
  if (origin === 'array' || origin === 'set') {
    if (kind === 'min' && Number(bound) <= 1 && inclusive !== false) return 'En az bir seçim yapılmalı.';
    return kind === 'max' ? `En fazla ${n} seçim yapılabilir.` : `En az ${n} seçim yapılmalı.`;
  }
  if (origin === 'date') return kind === 'max' ? 'Tarih izin verilenden ileri.' : 'Tarih izin verilenden geri.';
  if (origin === 'file') return kind === 'max' ? 'Dosya çok büyük.' : 'Dosya çok küçük.';
  if (kind === 'max') return inclusive === false ? `Değer ${n} değerinden küçük olmalı.` : `Değer en fazla ${n} olabilir.`;
  return inclusive === false ? `Değer ${n} değerinden büyük olmalı.` : `Değer en az ${n} olmalı.`;
}

const FORMAT_MESSAGES: Record<string, string> = {
  email: 'Geçerli bir e-posta adresi girin.',
  url: 'Geçerli bir bağlantı (URL) girin.',
  datetime: 'Geçerli bir tarih ve saat girin.',
  date: 'Geçerli bir tarih girin.',
  time: 'Geçerli bir saat girin.',
};

export function turkishZodError(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'Bu alan zorunlu.' : 'Değerin biçimi geçersiz.';
    case 'too_big':
      return sizeLimitMessage(issue.origin, issue.maximum, 'max', issue.inclusive);
    case 'too_small':
      return sizeLimitMessage(issue.origin, issue.minimum, 'min', issue.inclusive);
    case 'invalid_format':
      return FORMAT_MESSAGES[issue.format] ?? 'Biçim geçersiz.';
    case 'invalid_value':
      return 'Geçersiz seçim.';
    case 'unrecognized_keys':
      return 'İstekte tanınmayan alan var.';
    default:
      return 'Geçersiz değer.';
  }
}

z.config({ localeError: turkishZodError });
