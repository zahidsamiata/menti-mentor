import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  startConversation,
  sendMessage,
  listConversations,
  getMessages,
  markRead,
  unreadCount,
} from '../controllers/conversationController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// Sabit path'ler dinamik /:id'den ÖNCE mount edilir (çakışma önleme).
// GET  /unread-count  → çan rozeti toplam okunmamış
router.get('/unread-count', requireAuth(), unreadCount as unknown as RequestHandler);
// GET  /              → inbox (kullanıcının konuşmaları + unread)
router.get('/', requireAuth(), listConversations as unknown as RequestHandler);
// POST /              → menti konuşma başlatır (zorunlu ilk mesaj)
router.post('/', requireRole('MENTI'), startConversation as unknown as RequestHandler);
// GET  /:id/messages  → thread (katılımcı veya aynı-tenant admin)
router.get('/:id/messages', requireAuth(), getMessages as unknown as RequestHandler);
// POST /:id/messages  → mesaj gönder (yalnız katılımcı)
router.post('/:id/messages', requireAuth(), sendMessage as unknown as RequestHandler);
// POST /:id/read      → okundu işaretle (yalnız katılımcı)
router.post('/:id/read', requireAuth(), markRead as unknown as RequestHandler);

export default router;
