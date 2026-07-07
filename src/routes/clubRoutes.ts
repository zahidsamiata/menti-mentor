import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  createClub,
  listClubs,
  getClub,
  updateClub,
  addClubMember,
  removeClubMember,
  listClubMembers,
} from '../controllers/clubController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// ─── Kulüp CRUD ──────────────────────────────────────────────────────────────

// GET  /           → kimlik doğrulaması zorunlu
router.get('/', requireAuth(), listClubs as unknown as RequestHandler);

// POST /           → yalnızca ADMIN kulüp oluşturabilir
router.post('/', requireRole('ADMIN'), createClub as unknown as RequestHandler);

// GET  /:id        → kimlik doğrulaması zorunlu
router.get('/:id', requireAuth(), getClub as unknown as RequestHandler);

// PATCH /:id       → yalnızca ADMIN kulüp güncelleyebilir
router.patch('/:id', requireRole('ADMIN'), updateClub as unknown as RequestHandler);

// ─── Üyelik İşlemleri ────────────────────────────────────────────────────────

// GET  /:id/members        → kimlik doğrulaması zorunlu
router.get('/:id/members', requireAuth(), listClubMembers as unknown as RequestHandler);

// POST /:id/members        → ADMIN üye ekleyebilir
router.post('/:id/members', requireRole('ADMIN'), addClubMember as unknown as RequestHandler);

// DELETE /:id/members/:userId → ADMIN üye çıkarabilir
router.delete(
  '/:id/members/:userId',
  requireRole('ADMIN'),
  removeClubMember as unknown as RequestHandler,
);

export default router;
