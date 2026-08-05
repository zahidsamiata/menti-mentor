import { Router } from 'express';
import type { RequestHandler } from 'express';
import { joinViaInvitation } from '../controllers/selfServeController.js';
import { invitationJoinRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Herkese açık — davet linkine tıklayan üyenin ilk durağı.
// Token yol parametresi olarak geliyor: GET /api/invitations/:token/join
// JWT token nokta (.) içerdiğinden Express'in dot-segment davranışı test edildi;
// /:token tek-segment path'i tüm karakterleri (noktalar dahil) yakalar.
// invitationJoinRateLimiter: IP-bazlı — token deneme + DoS koruması.
router.get('/:token/join', invitationJoinRateLimiter, joinViaInvitation as RequestHandler);

export default router;
