/**
 * Elle CSV üretimi (F-18) — yeni bağımlılık eklememek için saf, küçük bir yardımcı.
 *
 * Biçim kararları (hedef: Türkçe Excel'de çift tıkla doğru açılması):
 *  - UTF-8 BOM (﻿): Excel BOM'suz UTF-8'i yerel kod sayfasıyla (Windows-1254) okur ve
 *    "ş/ğ/İ" bozulur. BOM, Excel'e dosyanın UTF-8 olduğunu söyler; diğer araçlar yok sayar.
 *  - Ayırıcı `;`: Türkçe bölge ayarında ondalık ayırıcı virgül olduğu için Excel liste
 *    ayırıcısı olarak `;` bekler. Virgülle ayrılmış dosya tek sütuna yığılır.
 *  - Satır sonu CRLF: RFC 4180 ve Excel varsayılanı.
 *
 * Güvenlik — CSV/formül enjeksiyonu: `=`, `+`, `-`, `@` (ve Excel'in aynı şekilde yorumladığı
 * sekme/satır başı) ile başlayan hücre, elektronik tabloda FORMÜL olarak çalışabilir. Bu tür
 * hücrelerin başına `'` eklenir; Excel onu düz metin olarak gösterir. Sayılar (number tipi)
 * olduğu gibi yazılır — negatif sayı formül değildir ve metne çevrilmemelidir.
 */

export const CSV_DELIMITER = ';';
export const CSV_BOM = '﻿';
const CSV_LINE_BREAK = '\r\n';

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export type CsvCell = string | number | null | undefined;

/** Tek hücreyi güvenli CSV alanına çevirir: formülü etkisizleştirir, gerekirse tırnaklar. */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';

  const neutralized = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  const needsQuotes = /[";\r\n,]/.test(neutralized);
  if (!needsQuotes) return neutralized;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

/** Satırlardan BOM'lu, `;` ayırıcılı, CRLF satır sonlu CSV metni üretir. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(CSV_DELIMITER)).join(CSV_LINE_BREAK);
  return `${CSV_BOM}${body}${CSV_LINE_BREAK}`;
}
