import type { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger.js';
import { CSP_REPORT_CONTENT_TYPES, extractCspViolations } from '../services/cspReport.js';

/**
 * POST /api/csp-reports — public (tarayıcı gönderir, oturum yok). AJ-52.
 *
 * Yanıt HER ZAMAN 204 (oran sınırı aşımı hariç: 429, `cspReportRateLimiter`): geçerli, bozuk,
 * yanlış içerik tipli ya da aşırı büyük gövde ayırt edilmez → gönderene bilgi sızmaz.
 * Yalnız daraltılmış alanlar (`services/cspReport.ts`) SystemLog'a `CSP` kategorisiyle yazılır.
 */
export function receiveCspReport(req: Request, res: Response) {
  try {
    if (req.is(CSP_REPORT_CONTENT_TYPES)) {
      for (const violation of extractCspViolations(req.body)) {
        // Yanıt günlük yazımını beklemez; logger DB hatasını kendi yakalar (fırlatmaz).
        void logger.warn('CSP', `CSP ihlali: ${violation.directive}`, violation);
      }
    }
  } catch {
    // Dış girdi — beklenmeyen biçim sessizce yok sayılır (204).
  }
  return res.status(204).end();
}

/**
 * Gövde ayrıştırma hataları (boyut aşımı 413, bozuk JSON 400) genel hata işleyicisine gitmez:
 * 204 döner, hiçbir şey yazılmaz. Genel işleyici hatayı günlüğe yazıp ayrıntılı gövde döndürürdü.
 */
export function swallowCspReportErrors(_err: unknown, _req: Request, res: Response, _next: NextFunction) {
  return res.status(204).end();
}
