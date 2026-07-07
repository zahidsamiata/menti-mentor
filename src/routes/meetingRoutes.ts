import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  createMeeting,
  listMeetings,
  updateMeetingStatus,
  saveAvailability,
  getAvailability,
  bookMeeting,
  getActiveMeetings,
  markFeedbackPrompted,
} from '../controllers/meetingController.js';
import {
  submitFeedback,
  getMeetingFeedback,
  clearOrientationLock,
  sendPendingFeedbackReminders,
} from '../controllers/feedbackController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// ─── Müsaitlik (Availability) ─────────────────────────────────────────────────
// POST  /availability  → Mentör kendi bloklarını kaydeder
router.post(
  '/availability',
  requireRole('MENTOR'),
  saveAvailability as unknown as RequestHandler,
);
// GET   /availability?mentorUserId=...  → Herhangi biri bir mentörün müsaitliğini görür
router.get(
  '/availability',
  requireAuth(),
  getAvailability as unknown as RequestHandler,
);

// ─── Akıllı Booking ──────────────────────────────────────────────────────────
// POST  /book  → Menti çakışma + müsaitlik kontrollü görüşme oluşturur
router.post(
  '/book',
  requireRole('MENTI'),
  bookMeeting as unknown as RequestHandler,
);
// GET   /active  → MeetingProvider poller endpoint'i (aktif + yakın geçmiş)
router.get(
  '/active',
  requireAuth(),
  getActiveMeetings as unknown as RequestHandler,
);
// POST  /:meetingId/feedback-prompted  → Feedback kartı gösterilince işaretle
router.post(
  '/:meetingId/feedback-prompted',
  requireAuth(),
  markFeedbackPrompted as unknown as RequestHandler,
);

// ─── Toplantı CRUD (mevcut) ───────────────────────────────────────────────────
// POST  /         → ADMIN veya MENTI (basit toplantı talebi)
router.post(
  '/',
  requireRole('ADMIN', 'MENTI'),
  createMeeting as unknown as RequestHandler,
);
// GET   /         → kimlik doğrulaması zorunlu
router.get(
  '/',
  requireAuth(),
  listMeetings as unknown as RequestHandler,
);
// PATCH /:id      → ADMIN veya MENTOR (durum günceller)
router.patch(
  '/:id',
  requireRole('ADMIN', 'MENTOR'),
  updateMeetingStatus as unknown as RequestHandler,
);

// ─── Geri bildirim (mevcut) ───────────────────────────────────────────────────
router.post(
  '/:meetingId/feedback',
  requireRole('ADMIN', 'MENTOR', 'MENTI'),
  submitFeedback as unknown as RequestHandler,
);
router.get(
  '/:meetingId/feedback',
  requireAuth(),
  getMeetingFeedback as unknown as RequestHandler,
);

// ─── Admin işlemleri (mevcut) ────────────────────────────────────────────────
router.post(
  '/reminders/send',
  requireRole('ADMIN'),
  sendPendingFeedbackReminders as unknown as RequestHandler,
);
router.delete(
  '/orientation-lock/:userId',
  requireRole('ADMIN'),
  clearOrientationLock as unknown as RequestHandler,
);

export default router;
