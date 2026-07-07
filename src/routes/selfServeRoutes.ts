import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  selfServeRegister,
  checkSlugAvailability,
  updateOnboarding,
  getTenantPreview,
  createInvitation,
} from '../controllers/selfServeController.js';

const router = Router();

// X-Tenant-Id header'ı gerektirmeyen self-serve akışı:
// - check-slug + register: herkese açık (onboarding wizard)
// - onboarding / preview / invitations: JWT Bearer ile korunan (controller içinde doğrulanır)

router.get('/self-serve/check-slug', checkSlugAvailability as RequestHandler);
router.post('/self-serve/register',  selfServeRegister     as RequestHandler);
router.patch('/:id/onboarding',      updateOnboarding      as RequestHandler);
router.get('/:slug/preview',         getTenantPreview      as RequestHandler);
router.post('/:id/invitations',      createInvitation      as RequestHandler);

export default router;
