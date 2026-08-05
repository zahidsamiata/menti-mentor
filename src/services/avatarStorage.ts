/**
 * Avatar dosya depolama — kalıcı diske güvenli yazma/silme + içerik doğrulama.
 *
 * Tüm çekirdek mantık (tip tespiti, dosya adı üretimi, URL üretimi) saf fonksiyon
 * olarak tutulur; diske dokunan kısımlar ince sarmalayıcılardır. Böylece birim testi
 * kolaylaşır (magic-byte tespiti DB/disk gerektirmez).
 *
 * GÜVENLİK: Dosya adı KULLANICI GİRDİSİNDEN üretilmez (path traversal riski) — userId
 * + rastgele UUID + tespit edilen uzantıdan oluşur. Uzantı istemcinin bildirdiği MIME'a
 * değil, dosyanın gerçek sihirli baytlarına göre belirlenir.
 */

import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { config } from '../config.js';

export type ImageKind = { ext: 'jpg' | 'png' | 'webp'; mime: string };

/**
 * Dosyanın gerçek türünü sihirli baytlarından (magic bytes) tespit eder.
 * Uzantıya/istemci MIME'ına GÜVENMEZ. Sadece jpeg/png/webp kabul edilir;
 * SVG bilinçli olarak reddedilir (XSS vektörü taşıyabilir → null döner).
 */
export function detectImageType(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }

  // WEBP: "RIFF" .... "WEBP" (bayt 0-3 ve 8-11)
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

/** Tahmin edilemez, çakışmayan güvenli dosya adı: <userId>-<uuid>.<ext>. */
export function buildAvatarFilename(userId: string, ext: ImageKind['ext']): string {
  return `${userId}-${randomUUID()}.${ext}`;
}

/** Dosya adından public erişim URL'i üretir (avatarUrl bu değere set edilir). */
export function buildAvatarUrl(filename: string): string {
  return `${config.upload.publicBaseUrl}/uploads/${filename}`;
}

/** Upload dizininin var olmasını garanti eder (yoksa oluşturur). */
export async function ensureUploadDir(): Promise<void> {
  await mkdir(config.upload.dir, { recursive: true });
}

/** Doğrulanmış avatar dosyasını kalıcı diske yazar. */
export async function writeAvatarFile(filename: string, buffer: Buffer): Promise<void> {
  await ensureUploadDir();
  await writeFile(join(config.upload.dir, filename), buffer);
}

/**
 * Kullanıcının önceki KENDİ yüklediği avatar dosyasını diskten siler (disk şişmesin).
 * Dış OAuth avatar URL'leri (Google lh3.googleusercontent.com vb.) SİLİNMEZ — yalnızca
 * bizim /uploads altında servis ettiğimiz yerel dosyalar hedeflenir. Best-effort:
 * dosya yoksa sessizce geçer.
 *
 * GÜVENLİK: URL'den yalnızca basename alınır (path traversal '..' etkisiz) ve çözülen
 * mutlak yol upload dizininin içinde kalıyor mu diye ikinci kez doğrulanır.
 */
export async function deleteLocalAvatar(avatarUrl: string | null | undefined): Promise<void> {
  if (!avatarUrl) return;

  const marker = '/uploads/';
  const idx = avatarUrl.indexOf(marker);
  if (idx === -1) return; // dış URL — dokunma

  const name = basename(avatarUrl.slice(idx + marker.length));
  if (!name || name === '.' || name === '..') return;

  const dir = resolve(config.upload.dir);
  const full = resolve(dir, name);
  if (full !== join(dir, name)) return; // yol upload dizini dışına çıkıyorsa iptal

  try {
    await unlink(full);
  } catch {
    /* dosya zaten yoksa yok say */
  }
}
