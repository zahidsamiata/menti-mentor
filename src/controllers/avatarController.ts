import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import {
  detectImageType,
  buildAvatarFilename,
  buildAvatarUrl,
  writeAvatarFile,
  deleteLocalAvatar,
} from '../services/avatarStorage.js';

/**
 * POST /api/users/me/avatar — kullanıcı KENDİ profil fotoğrafını yükler.
 *
 * Güvenlik katmanları (route + bu handler birlikte):
 *  - requireAuth: yalnızca giriş yapmış kullanıcı, yalnızca kendi avatarı (IDOR yok — id yok, "me").
 *  - avatarUploadRateLimiter: kullanıcı başına dakikada sınırlı (disk doldurma koruması).
 *  - multer: 5MB boyut sınırı, tek dosya, MIME ön-kontrolü.
 *  - detectImageType: sihirli-bayt içerik doğrulaması (uzantı/MIME spoof'una karşı; SVG reddedilir).
 *  - buildAvatarFilename: rastgele güvenli ad (path traversal yok).
 *  - Tenant izolasyonu: kullanıcı kendi tenant'ında bulunur (findFirst + tenantId).
 */
export async function uploadMyAvatar(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    return res.status(400).json({ error: 'DOSYA_YOK', message: 'Yüklenecek fotoğraf bulunamadı.' });
  }

  // İçerik doğrulaması — istemcinin bildirdiği türe DEĞİL, gerçek baytlara bakılır.
  const kind = detectImageType(file.buffer);
  if (!kind) {
    return res.status(400).json({
      error: 'GECERSIZ_DOSYA_TIPI',
      message: 'Yalnızca JPEG, PNG veya WEBP formatında fotoğraf yükleyebilirsiniz.',
    });
  }

  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId },
    select: { id: true, avatarUrl: true },
  });
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });

  const filename = buildAvatarFilename(user.id, kind.ext);
  await writeAvatarFile(filename, file.buffer);
  const avatarUrl = buildAvatarUrl(filename);

  await prisma.user.update({ where: { id: user.id }, data: { avatarUrl } });

  // Eski dosyayı DB güncellemesinden SONRA sil: silme başarısız olsa bile yeni URL zaten
  // kayıtlı. Yalnızca önceki KENDİ yerel dosyası silinir; OAuth dış URL'i korunur.
  await deleteLocalAvatar(user.avatarUrl);

  return res.json({ avatarUrl });
}
