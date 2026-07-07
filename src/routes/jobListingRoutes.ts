import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  createJobListing,
  listJobListings,
  getJobListing,
  updateJobListing,
} from '../controllers/jobListingController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// GET  / → kimlik doğrulaması zorunlu (ilanlar tenant-private)
router.get('/', requireAuth(), listJobListings as unknown as RequestHandler);

// POST / → yalnızca ADMIN ilan oluşturabilir
router.post('/', requireRole('ADMIN'), createJobListing as unknown as RequestHandler);

// GET  /:id → kimlik doğrulaması zorunlu
router.get('/:id', requireAuth(), getJobListing as unknown as RequestHandler);

// PATCH /:id → yalnızca ADMIN ilan güncelleyebilir
router.patch('/:id', requireRole('ADMIN'), updateJobListing as unknown as RequestHandler);

export default router;
