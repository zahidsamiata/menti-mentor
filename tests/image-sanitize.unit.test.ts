/**
 * GV-16 + GV-20 — profil fotoğrafı: başlıktan çözünürlük okunur, konum (GPS) dahil
 * üst veri çıkarılır, piksel verisi aynen kalır. Sentetik dosyalarla; disk/DB yok.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeImage, isWithinAvatarLimits } from '../src/services/imageSanitize.js';
import { detectImageType } from '../src/services/avatarStorage.js';

const GPS = Buffer.from('Exif\0\0GPSLatitude41.0082GPSLongitude28.9784', 'latin1');
const PIXELS = Buffer.from('PIXELDATA-0123456789', 'latin1');

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

function makeJpeg(width: number, height: number): Buffer {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    jpegSegment(0xe1, GPS),
    jpegSegment(0xfe, Buffer.from('yorum: cekim yeri', 'latin1')),
    jpegSegment(0xc0, sof),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    PIXELS,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('eXIf', GPS),
    pngChunk('tEXt', Buffer.from('Location\0Istanbul', 'latin1')),
    pngChunk('IDAT', PIXELS),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function makeWebp(width: number, height: number): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04; // EXIF + XMP bayrakları
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([
    webpChunk('VP8X', vp8x),
    webpChunk('VP8 ', Buffer.concat([Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0]), PIXELS])),
    webpChunk('EXIF', GPS),
    webpChunk('XMP ', Buffer.from('<x:xmpmeta>konum</x:xmpmeta>', 'latin1')),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

const cases = [
  ['JPEG', makeJpeg],
  ['PNG', makePng],
  ['WEBP', makeWebp],
] as const;

describe('GV-16 + GV-20: sanitizeImage', () => {
  for (const [name, make] of cases) {
    it(`${name}: boyut başlıktan okunur, konum üst verisi çıkar, piksel verisi kalır`, () => {
      const input = make(640, 480);
      const kind = detectImageType(input)!;
      expect(kind).not.toBeNull();
      const out = sanitizeImage(input, kind)!;
      expect(out.size).toEqual({ width: 640, height: 480 });
      expect(out.clean.includes(Buffer.from('GPSLatitude'))).toBe(false);
      expect(out.clean.includes(Buffer.from('konum'))).toBe(false);
      expect(out.clean.includes(Buffer.from('Istanbul'))).toBe(false);
      expect(out.clean.includes(PIXELS)).toBe(true);
      // Temizlenmiş dosya yine aynı tür olarak tanınır ve yeniden çözümlenebilir.
      expect(detectImageType(out.clean)).toEqual(kind);
      expect(sanitizeImage(out.clean, kind)!.size).toEqual({ width: 640, height: 480 });
    });

    it(`negatif: ${name} yarıda kesilmiş ya da bozuk yapı reddedilir`, () => {
      const input = make(640, 480);
      const kind = detectImageType(input)!;
      expect(sanitizeImage(input.subarray(0, 30), kind)).toBeNull();
    });
  }

  it('WEBP: EXIF/XMP bayrakları temizlenir ve RIFF boyutu yeni uzunluğa eşit', () => {
    const out = sanitizeImage(makeWebp(100, 50), { ext: 'webp', mime: 'image/webp' })!;
    expect(out.clean.readUInt32LE(4)).toBe(out.clean.length - 8);
    expect(out.clean[20]! & 0x0c).toBe(0);
  });
});

function exifApp1WithOrientationAndGps(orientation: number): Buffer {
  // "Exif\0\0" + TIFF (II) + IFD0: 2 girdi (Orientation, GPS göstergesi) + metin
  const tiff = Buffer.alloc(8 + 2 + 24 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0x8825, 22); // GPSInfo IFD işaretçisi
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(0, 30);
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, GPS]);
}

describe('GV-16 inceleme düzeltmeleri (JPEG)', () => {
  const jpg = { ext: 'jpg', mime: 'image/jpeg' } as const;
  function jpegWith(app1: Buffer, tail: Buffer = Buffer.alloc(0), extraSegments: Buffer[] = []): Buffer {
    const sof = Buffer.alloc(15);
    sof[0] = 8;
    sof.writeUInt16BE(200, 1);
    sof.writeUInt16BE(300, 3);
    sof[5] = 3;
    return Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe1, app1),
      ...extraSegments,
      jpegSegment(0xc0, sof),
      jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
      PIXELS,
      Buffer.from([0xff, 0xd9]),
      tail,
    ]);
  }

  it('dikey fotoğrafın yönlendirmesi korunur, konum atılır', () => {
    const out = sanitizeImage(jpegWith(exifApp1WithOrientationAndGps(6)), jpg)!;
    expect(out.clean.includes(Buffer.from('GPSLatitude'))).toBe(false);
    const idx = out.clean.indexOf(Buffer.from('Exif\0\0', 'latin1'));
    expect(idx).toBeGreaterThan(0);
    // Yeniden ayrıştırınca yönlendirme 6 (MM, tek girdi)
    const tiff = out.clean.subarray(idx + 6);
    expect(tiff.toString('latin1', 0, 2)).toBe('MM');
    expect(tiff.readUInt16BE(10)).toBe(0x0112);
    expect(tiff.readUInt16BE(18)).toBe(6); // girdi: etiket(10) tür(12) sayı(14) değer(18)
    expect(sanitizeImage(out.clean, jpg)!.size).toEqual({ width: 300, height: 200 });
  });

  it('yönlendirme 1 ise Exif hiç yazılmaz', () => {
    const out = sanitizeImage(jpegWith(exifApp1WithOrientationAndGps(1)), jpg)!;
    expect(out.clean.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
  });

  it('negatif: EOI sonrasına eklenmiş ikincil görüntü ve MPF işaretçisi atılır', () => {
    const secondary = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe1, GPS),
      Buffer.from([0xff, 0xd9]),
    ]);
    const mpf = jpegSegment(0xe2, Buffer.from('MPF\0IIxxxx', 'latin1'));
    const icc = jpegSegment(0xe2, Buffer.from('ICC_PROFILE\0renk', 'latin1'));
    const out = sanitizeImage(jpegWith(exifApp1WithOrientationAndGps(1), secondary, [mpf, icc]), jpg)!;
    expect(out.clean.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(out.clean.includes(Buffer.from('MPF\0', 'latin1'))).toBe(false);
    expect(out.clean.includes(Buffer.from('ICC_PROFILE'))).toBe(true);
    expect(out.clean.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('negatif: boyutu 0 bildiren başlık okunamaz sayılır', () => {
    const sof = Buffer.alloc(15);
    sof[0] = 8;
    const bad = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xc0, sof),
      jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
      PIXELS,
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(sanitizeImage(bad, jpg)).toBeNull();
  });

  it('bozuk girdilerde istisna fırlatmaz (rastgele kesme/bozma)', () => {
    const base = makeJpeg(640, 480);
    for (let n = 0; n < 500; n++) {
      const b = Buffer.from(base);
      b[(n * 7919) % b.length] = (n * 31) & 0xff;
      const cut = b.subarray(0, (n * 13) % b.length);
      expect(() => sanitizeImage(cut, jpg)).not.toThrow();
      expect(() => sanitizeImage(b, jpg)).not.toThrow();
    }
  });
});

describe('GV-20: isWithinAvatarLimits', () => {
  it('olağan telefon fotoğrafı sınır içinde', () => {
    expect(isWithinAvatarLimits({ width: 4032, height: 3024 })).toBe(true);
  });

  it('negatif: kenar ya da toplam piksel sınırı aşılırsa reddedilir', () => {
    expect(isWithinAvatarLimits({ width: 10000, height: 100 })).toBe(false);
    expect(isWithinAvatarLimits({ width: 8000, height: 8000 })).toBe(false);
    expect(isWithinAvatarLimits({ width: 0, height: 100 })).toBe(false);
    const huge = sanitizeImage(makePng(60000, 60000), { ext: 'png', mime: 'image/png' })!;
    expect(isWithinAvatarLimits(huge.size)).toBe(false);
  });
});
