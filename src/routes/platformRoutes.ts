import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { platformLogin, getPlatformStats, getPlatformHealth, getPlatformLogs } from '../controllers/platformController.js';

const router = Router();

// Public: key-based platform auth
router.post('/auth', platformLogin);

// Protected: platform-admin token required for all below
router.use(requirePlatformAdmin);

router.get('/stats', getPlatformStats);
router.get('/health', getPlatformHealth);
router.get('/logs', getPlatformLogs);

export default router;
