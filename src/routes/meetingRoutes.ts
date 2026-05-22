import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import { createMeeting, listMeetings, updateMeetingStatus } from '../controllers/meetingController.js';
import {
  submitFeedback,
  getMeetingFeedback,
  clearOrientationLock,
  sendPendingFeedbackReminders,
} from '../controllers/feedbackController.js';

const router = Router();
// requireTenant async olduğu için cast gerekli.
router.use(requireTenant as unknown as RequestHandler);

// ─── Toplantı CRUD ───────────────────────────────────────────────────────────
// POST /          → ADMIN veya MENTI (toplantı talebi açar)
router.post('/', requireRole('ADMIN', 'MENTI'), createMeeting as unknown as RequestHandler);

// GET  /          → tenant içindeki herkes
router.get('/', listMeetings as unknown as RequestHandler);

// PATCH /:id      → ADMIN veya MENTOR (toplantı durumu günceller)
router.patch('/:id', requireRole('ADMIN', 'MENTOR'), updateMeetingStatus as unknown as RequestHandler);

// ─── Geri bildirim ───────────────────────────────────────────────────────────
// POST /:meetingId/feedback → ADMIN, MENTOR veya MENTI
router.post(
  '/:meetingId/feedback',
  requireRole('ADMIN', 'MENTOR', 'MENTI'),
  submitFeedback as unknown as RequestHandler,
);

// GET /:meetingId/feedback  → tenant içindeki herkes
router.get('/:meetingId/feedback', getMeetingFeedback as unknown as RequestHandler);

// ─── Admin işlemleri ─────────────────────────────────────────────────────────
// POST /reminders/send           → yalnızca ADMIN
router.post(
  '/reminders/send',
  requireRole('ADMIN'),
  sendPendingFeedbackReminders as unknown as RequestHandler,
);

// DELETE /orientation-lock/:userId → yalnızca ADMIN
router.delete(
  '/orientation-lock/:userId',
  requireRole('ADMIN'),
  clearOrientationLock as unknown as RequestHandler,
);

export default router;
