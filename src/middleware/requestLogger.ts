/**
 * HTTP erişim log middleware.
 * Her isteği yapısal JSON formatında loglar.
 * Hassas header'lar (Authorization) loglanmaz.
 */

import type { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl } = req;
  const tenantId = req.header('X-Tenant-Id') ?? '-';

  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';

    console.log(JSON.stringify({
      level,
      category: 'HTTP',
      method,
      url: originalUrl,
      status: res.statusCode,
      ms,
      tenantId,
      ts: new Date().toISOString(),
    }));
  });

  next();
}
