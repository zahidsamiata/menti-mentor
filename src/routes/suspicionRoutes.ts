import { Router } from 'express';
import { createSuspicionReport } from '../controllers/suspicionController.js';

const router = Router();

// Public: sahte kurum/davet şüphesi bildirimi
router.post('/', createSuspicionReport);

export default router;
