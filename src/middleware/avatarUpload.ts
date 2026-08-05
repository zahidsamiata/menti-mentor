/**
 * Avatar yükleme middleware'i — multer (bellek deposu) + hata çevirisi.
 *
 * Bellek deposu bilinçli tercih: dosya diske YAZILMADAN önce controller'da sihirli-bayt
 * içerik doğrulaması yapabilmek için buffer'a ihtiyaç var. Diske ancak doğrulama geçince
 * güvenli adla yazılır (bkz. avatarStorage.ts).
 *
 * Boyut sınırı ve tek-dosya kısıtı multer seviyesinde uygulanır; MIME ön-kontrolü ilk
 * savunmadır (istemci spoof edebilir → asıl doğrulama controller'daki magic-byte).
 */

import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('GECERSIZ_DOSYA_TIPI'));
      return;
    }
    cb(null, true);
  },
});

const single = upload.single('avatar');

/**
 * upload.single('avatar')'ı sarmalar ve multer hatalarını jenerik 500 yerine anlamlı
 * 4xx yanıtlarına çevirir. İç hata detayı sızdırılmaz.
 */
export const avatarUploadMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  single(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = Math.round(config.upload.maxBytes / (1024 * 1024));
        res.status(413).json({
          error: 'DOSYA_BUYUK',
          message: `Fotoğraf boyutu en fazla ${maxMb}MB olabilir.`,
        });
        return;
      }
      res.status(400).json({ error: 'YUKLEME_HATASI', message: 'Dosya yüklenemedi.' });
      return;
    }

    if (err instanceof Error && err.message === 'GECERSIZ_DOSYA_TIPI') {
      res.status(400).json({
        error: 'GECERSIZ_DOSYA_TIPI',
        message: 'Yalnızca JPEG, PNG veya WEBP formatında fotoğraf yükleyebilirsiniz.',
      });
      return;
    }

    res.status(400).json({ error: 'YUKLEME_HATASI', message: 'Dosya yüklenemedi.' });
  });
};
