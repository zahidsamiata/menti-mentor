import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import {
  createJobListing,
  listJobListings,
  getJobListing,
  updateJobListing,
} from '../controllers/jobListingController.js';

const router = Router();

// Tüm iş ilanı endpoint'leri tenant-scope
router.use(requireTenant as RequestHandler);

router.get('/', listJobListings as unknown as RequestHandler);
router.post('/', createJobListing as unknown as RequestHandler);
router.get('/:id', getJobListing as unknown as RequestHandler);
router.patch('/:id', updateJobListing as unknown as RequestHandler);

export default router;
