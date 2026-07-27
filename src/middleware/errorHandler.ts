import type { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint bulunamadı.' });
}

// Express 4-param imzası: error handler olarak tanınması için 4 parametre şart.
export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  void logger.error('HTTP', 'Beklenmedik sunucu hatası', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (res.headersSent) return;

  // Güvenlik: iç hata detayını (DB hatası, dosya yolu, stack, kütüphane mesajı) client'a
  // SIZDIRMA. Ayrıntı yalnızca sunucu log'unda kalır; client'a jenerik mesaj döner.
  res.status(500).json({ error: 'INTERNAL', message: 'Beklenmedik bir sunucu hatası oluştu.' });
}
