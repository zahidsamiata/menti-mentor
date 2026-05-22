import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
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

// Tüm kulüp endpoint'lerine tenant izolasyonu uygulanır.
router.use(requireTenant as RequestHandler);

// Kulüp CRUD
router.post('/', createClub as unknown as RequestHandler);
router.get('/', listClubs as unknown as RequestHandler);
router.get('/:id', getClub as unknown as RequestHandler);
router.patch('/:id', updateClub as unknown as RequestHandler);

// Üyelik işlemleri
router.post('/:id/members', addClubMember as unknown as RequestHandler);
router.delete('/:id/members/:userId', removeClubMember as unknown as RequestHandler);
router.get('/:id/members', listClubMembers as unknown as RequestHandler);

export default router;
