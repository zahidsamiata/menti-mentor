import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  selfServeRegister,
  checkSlugAvailability,
  updateOnboarding,
  getTenantPreview,
  createInvitation,
  unsubscribeTenant,
  getInvitationTemplates,
  saveInvitationTemplate,
} from '../controllers/selfServeController.js';
import { checkSlugRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// X-Tenant-Id header'ı gerektirmeyen self-serve akışı:
// - check-slug + register: herkese açık (onboarding wizard)
// - onboarding / preview / invitations: JWT Bearer ile korunan (controller içinde doğrulanır)

// checkSlugRateLimiter: IP-bazlı — slug numaralandırmasını yavaşlatır.
router.get('/self-serve/check-slug', checkSlugRateLimiter, checkSlugAvailability as RequestHandler);
router.post('/self-serve/register',  selfServeRegister     as RequestHandler);
router.patch('/:id/onboarding',      updateOnboarding      as RequestHandler);
router.get('/:slug/preview',         getTenantPreview      as RequestHandler);
router.post('/:id/invitations',      createInvitation      as RequestHandler);

// Davet şablonu — admin JWT ile korunan
router.get('/:id/invitation-templates', getInvitationTemplates as RequestHandler);
router.put('/:id/invitation-templates', saveInvitationTemplate as RequestHandler);

// Faz 3: e-posta listesinden çıkma — auth gerektirmez, token yeterli
// GET /api/tenants/unsubscribe?token=<uuid>
router.get('/unsubscribe', unsubscribeTenant as RequestHandler);

export default router;
