import type { Request, Response, NextFunction } from 'express';
import { extractBearerToken, verifyToken } from './jwtAuth.js';

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Platform token gerekli.' });
  }

  const payload = verifyToken(token);
  if (!payload || !payload.isPlatformAdmin) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Bu endpoint yalnızca platform yöneticisine açıktır.' });
  }

  next();
}
