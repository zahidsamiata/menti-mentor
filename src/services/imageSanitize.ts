/**
 * Profil fotoğrafı için başlık düzeyinde denetim ve üst veri temizliği — görsel çözülmez,
 * yeni bağımlılık yok. Saf fonksiyonlar; disk/DB yok.
 *
 * GV-20: çözünürlük başlıktan okunur ve sınırı aşan görsel reddedilir. Dosya boyutu sınırı
 * (UPLOAD_MAX_BYTES) tek başına yetmez: küçük bir dosya çok büyük bir tuval bildirebilir ve
 * ön yüzün görsel iyileştiricisi onu belleğe açar.
 * GV-16: telefon fotoğraflarındaki konum (GPS) ve diğer kişisel üst veri, dosya herkese açık
 * servis edilmeden önce çıkarılır (KVKK Md.4 veri minimizasyonu). Yalnız üst veri blokları
 * atılır; piksel verisine dokunulmaz.
 *
 * Bozuk/beklenmedik yapı → null (çağıran reddeder). Sınırların dışına okuma yapılmaz.
 */
import type { ImageKind } from './avatarStorage.js';

export const AVATAR_IMAGE_LIMITS = { maxSide: 8000, maxPixels: 40_000_000 } as const;

export interface ImageSize {
  width: number;
  height: number;
}

export function isWithinAvatarLimits(size: ImageSize): boolean {
  return (
    size.width > 0 &&
    size.height > 0 &&
    size.width <= AVATAR_IMAGE_LIMITS.maxSide &&
    size.height <= AVATAR_IMAGE_LIMITS.maxSide &&
    size.width * size.height <= AVATAR_IMAGE_LIMITS.maxPixels
  );
}

// ─── JPEG ────────────────────────────────────────────────────────────────────
// Segment: FF <marker> [uzunluk(2, BE, kendisi dahil) + veri]. SOS'tan (DA) sonra sıkıştırılmış
// tarama verisi gelir (içinde FF yalnız FF00 dolgusu ya da RSTn olabilir); ilerlemeli JPEG'de
// taramalar arasında yeniden segmentler olur. EOI'ye (FF D9) kadar ayrıştırılır, sonrası atılır
// — EOI'den sonra eklenmiş ikincil görüntüler kendi Exif/konum bilgisini taşıyabilir.
const JPEG_DROP = new Set([0xe1 /* APP1: Exif/XMP (GPS) */, 0xed /* APP13: IPTC */, 0xfe /* COM */]);
const JPEG_STANDALONE = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7);
const JPEG_SOF = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const EXIF_ORIENTATION_TAG = 0x0112;

/** APP1 Exif bloğundan yönlendirme (orientation) değerini okur; yoksa null. */
function readExifOrientation(seg: Buffer): number | null {
  // seg = APP1 verisi (uzunluk alanından sonrası): "Exif\0\0" + TIFF başlığı
  if (seg.length < 14 || seg.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = seg.subarray(6);
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (tiff.length < 8) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > tiff.length) return null;
    if (u16(e) === EXIF_ORIENTATION_TAG) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** Yalnız yönlendirme etiketini taşıyan en küçük APP1 Exif segmenti (konum vb. yok). */
function orientationOnlyApp1(orientation: number): Buffer {
  const data = Buffer.alloc(6 + 8 + 2 + 12 + 4);
  data.write('Exif\0\0', 0, 'latin1');
  data.write('MM', 6, 'latin1');
  data.writeUInt16BE(0x002a, 8);
  data.writeUInt32BE(8, 10); // IFD0 ofseti
  data.writeUInt16BE(1, 14); // tek girdi
  data.writeUInt16BE(EXIF_ORIENTATION_TAG, 16);
  data.writeUInt16BE(3, 18); // SHORT
  data.writeUInt32BE(1, 20);
  data.writeUInt16BE(orientation, 24);
  data.writeUInt32BE(0, 28); // sonraki IFD yok
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

/** APP2 içinde çoklu görüntü (MPF) işaretçisi mi — ikincil görüntülere yol gösterir, atılır. */
const isMpfApp2 = (marker: number, data: Buffer) => marker === 0xe2 && data.toString('latin1', 0, 4) === 'MPF\0';

function processJpeg(buf: Buffer): { size: ImageSize | null; clean: Buffer } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let size: ImageSize | null = null;
  let orientation: number | null = null;
  let sawScan = false;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    let j = i;
    while (j < buf.length && buf[j] === 0xff) j++; // dolgu baytları
    if (j >= buf.length) return null;
    const marker = buf[j]!;
    if (JPEG_STANDALONE(marker)) {
      parts.push(buf.subarray(i, j + 1));
      i = j + 1;
      continue;
    }
    if (marker === 0xd9) {
      if (!sawScan) return null;
      parts.push(Buffer.from([0xff, 0xd9])); // EOI — sonrası bilinçli olarak atılır
      if (orientation && orientation !== 1) parts.splice(1, 0, orientationOnlyApp1(orientation));
      return { size, clean: Buffer.concat(parts) };
    }
    if (j + 2 >= buf.length) return null;
    const len = buf.readUInt16BE(j + 1);
    const segEnd = j + 1 + len;
    if (len < 2 || segEnd > buf.length) return null;
    const data = buf.subarray(j + 3, segEnd);
    if (JPEG_SOF(marker) && !size) {
      if (len < 7) return null;
      size = { height: buf.readUInt16BE(j + 4), width: buf.readUInt16BE(j + 6) };
    }
    if (marker === 0xe1 && orientation === null) orientation = readExifOrientation(data);
    if (!JPEG_DROP.has(marker) && !isMpfApp2(marker, data)) parts.push(buf.subarray(i, segEnd));
    i = segEnd;
    if (marker === 0xda) {
      // Tarama verisi: FF00 (dolgu) ve FF D0-D7 (RST) dışında bir FF xx ile biter.
      sawScan = true;
      let k = i;
      while (k < buf.length) {
        if (buf[k] === 0xff && k + 1 < buf.length) {
          const next = buf[k + 1]!;
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }
        k++;
      }
      if (k >= buf.length) return null; // EOI yok → yarım dosya
      parts.push(buf.subarray(i, k));
      i = k;
    }
  }
  return null;
}

// ─── PNG ─────────────────────────────────────────────────────────────────────
// Parça: uzunluk(4, BE) + tür(4) + veri + CRC(4). İlk parça IHDR (genişlik, yükseklik).
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

function processPng(buf: Buffer): { size: ImageSize | null; clean: Buffer } | null {
  if (buf.length < 33) return null;
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let size: ImageSize | null = null;
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) return null;
    if (i === 8) {
      if (type !== 'IHDR' || len < 8) return null;
      size = { width: buf.readUInt32BE(i + 8), height: buf.readUInt32BE(i + 12) };
    }
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) return null;
  return { size, clean: Buffer.concat(parts) };
}

// ─── WEBP ────────────────────────────────────────────────────────────────────
// RIFF(4) boyut(4, LE) WEBP(4) + parçalar: tür(4) boyut(4, LE) veri [+1 dolgu, tek boyutta].
// VP8X bayrakları: EXIF = 0x08, XMP = 0x04 — parça atılınca bayrak da temizlenir.
const WEBP_DROP = new Set(['EXIF', 'XMP ']);

function processWebp(buf: Buffer): { size: ImageSize | null; clean: Buffer } | null {
  if (buf.length < 20) return null;
  const parts: Buffer[] = [];
  let size: ImageSize | null = null;
  let sawBitstream = false;
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const dataStart = i + 8;
    const end = dataStart + len + (len % 2);
    if (dataStart + len > buf.length) return null;
    let chunk = buf.subarray(i, Math.min(end, buf.length));
    if (type === 'VP8X') {
      if (len < 10) return null;
      size = { width: buf.readUIntLE(dataStart + 4, 3) + 1, height: buf.readUIntLE(dataStart + 7, 3) + 1 };
      chunk = Buffer.from(chunk);
      chunk[8] = chunk[8]! & ~0x0c;
    } else if (type === 'VP8 ' && !size) {
      if (len < 10) return null;
      size = { width: buf.readUInt16LE(dataStart + 6) & 0x3fff, height: buf.readUInt16LE(dataStart + 8) & 0x3fff };
    } else if (type === 'VP8L' && !size) {
      if (len < 5 || buf[dataStart] !== 0x2f) return null;
      const bits = buf.readUInt32LE(dataStart + 1);
      size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') sawBitstream = true;
    if (!WEBP_DROP.has(type)) parts.push(chunk);
    i = end;
  }
  // Tam parça olmayan artık bayt ya da görüntü verisi yoksa yapı bozuktur.
  if (i < buf.length || !sawBitstream) return null;
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { size, clean: Buffer.concat([header, body]) };
}

/**
 * Görselin başlıktan okunan boyutunu ve üst verisi çıkarılmış kopyasını döndürür.
 * Yapı çözümlenemezse ya da boyut bulunamazsa null.
 */
export function sanitizeImage(buf: Buffer, kind: ImageKind): { size: ImageSize; clean: Buffer } | null {
  let result: { size: ImageSize | null; clean: Buffer } | null;
  try {
    result = kind.ext === 'jpg' ? processJpeg(buf) : kind.ext === 'png' ? processPng(buf) : processWebp(buf);
  } catch {
    // Sınır denetimleri okumaları korur; yine de beklenmedik yapı 500'e değil, redde dönmeli.
    return null;
  }
  if (!result || !result.size || result.size.width === 0 || result.size.height === 0) return null;
  return { size: result.size, clean: result.clean };
}
