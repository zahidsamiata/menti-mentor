import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { login, getMe } from '../controllers/authController.js';

const router = Router();

// POST /api/auth/login — tenant gerektirmez, token döndürür
router.post('/login', login as unknown as RequestHandler);

// GET /api/auth/me — mevcut token sahibinin profilini döndürür
router.get('/me', requireTenant as unknown as RequestHandler, getMe as unknown as RequestHandler);

export default router;
