import { z } from 'zod';

/**
 * AN-36 / G1-12 — Kurumun yasal kimlik bilgileri (KVKK Veri İşleyen Sözleşmesi için).
 *
 * Neden ayrı dosya: doğrulama kuralları saf (DB'siz) test edilebilsin ve okuma/yazma uçları
 * AYNI alan listesini (select) kullansın — yeni alan eklenirken tek yerde güncellenir.
 *
 * Kapsam: yalnız alanlar. Sözleşme METNİ ve "imzala" akışı bu dosyada YOK (avukat onayı bekler).
 *
 * KVKK notu: tüzel kişi bilgisidir; ancak adres / KEP adresi bir gerçek kişiye (ör. dernek başkanının
 * ev adresi) ait olabilir → kişisel veri gibi davranılır: yalnız kendi kurumunun ADMIN'i okur/yazar,
 * denetim loguna DEĞER değil yalnız alan ADI yazılır.
 */

// Sınırlar: veri kalitesi + kötüye kullanım (aşırı büyük gövde) çıpası.
export const LEGAL_INFO_LIMITS = {
  legalNameMax:    300,
  legalAddressMax: 500,
  kepAddressMax:   254, // RFC 5321 e-posta üst sınırı
  taxOfficeMax:    100,
} as const;

// MERSİS numarası 16 hanedir (Ticaret Bakanlığı Merkezi Sicil Kayıt Sistemi).
export const MERSIS_NO_PATTERN = /^.*$/; // MUTASYON
// Tüzel kişi Vergi Kimlik Numarası (VKN) 10 hanedir.
export const TAX_NUMBER_PATTERN = /^\d{10}$/;
// Türkiye'deki tüm KEP hizmet sağlayıcılarının alan adları `kep.tr` ile biter (ör. ad@hs01.kep.tr).
export const KEP_DOMAIN_SUFFIX = '.kep.tr';

/**
 * Boş dize → null: formda alanı silen yönetici değeri TEMİZLEYEBİLSİN (hepsi nullable).
 * `undefined` = alan gönderilmedi → dokunulmaz.
 */
function optionalNullableText(max: number, label: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim() : v))
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v == null || v.length <= max, { message: `${label} en fazla ${max} karakter olabilir.` });
}

function optionalNullablePattern(pattern: RegExp, message: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    // Kullanıcı "1234 5678 ..." biçiminde boşluklu yazabilir — boşluklar atılır, rakam dışı karakter reddedilir.
    .transform((v) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v))
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v == null || pattern.test(v), { message });
}

const kepAddress = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v))
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || v.length <= LEGAL_INFO_LIMITS.kepAddressMax, {
    message: `KEP adresi en fazla ${LEGAL_INFO_LIMITS.kepAddressMax} karakter olabilir.`,
  })
  .refine((v) => v == null || (z.email().safeParse(v).success), {
    message: 'KEP adresi geçerli bir KEP e-posta adresi olmalı (ör. kurum@hs01.kep.tr).',
  });

export const UpdateLegalInfoSchema = z
  .object({
    legalName:    optionalNullableText(LEGAL_INFO_LIMITS.legalNameMax, 'Resmî unvan'),
    legalAddress: optionalNullableText(LEGAL_INFO_LIMITS.legalAddressMax, 'Resmî adres'),
    kepAddress,
    mersisNo:     optionalNullablePattern(MERSIS_NO_PATTERN, 'MERSİS numarası 16 haneli olmalı ve yalnız rakam içermeli.'),
    taxOffice:    optionalNullableText(LEGAL_INFO_LIMITS.taxOfficeMax, 'Vergi dairesi'),
    taxNumber:    optionalNullablePattern(TAX_NUMBER_PATTERN, 'Vergi kimlik numarası 10 haneli olmalı ve yalnız rakam içermeli.'),
  })
  .passthrough() // MUTASYON
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'En az bir yasal bilgi alanı gönderilmelidir.',
  });

export type UpdateLegalInfoInput = z.infer<typeof UpdateLegalInfoSchema>;

/** Okuma/yazma yanıtının TEK alan listesi (explicit select — Tenant'ın başka alanı dönmez). */
export const TENANT_LEGAL_INFO_SELECT = {
  legalName:          true,
  legalAddress:       true,
  kepAddress:         true,
  mersisNo:           true,
  taxOffice:          true,
  taxNumber:          true,
  legalInfoUpdatedAt: true,
} as const;

/** Gönderilmeyen (undefined) alanları atar — yalnız gerçekten gönderilenler yazılır. */
export function pickProvidedLegalFields(input: UpdateLegalInfoInput): Partial<Record<keyof UpdateLegalInfoInput, string | null>> {
  const out: Partial<Record<keyof UpdateLegalInfoInput, string | null>> = {};
  for (const [key, value] of Object.entries(input) as [keyof UpdateLegalInfoInput, string | null | undefined][]) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
