import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import {
  listQuestions,
  createQuestion,
  submitResponses,
  getMyResponses,
} from '../controllers/questionController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// GET  /          → tenant içindeki herkes (CORE ve DEEPENING soruları)
router.get('/', listQuestions as unknown as RequestHandler);

// POST /          → yalnızca ADMIN (soru ekle)
router.post('/', requireRole('ADMIN'), createQuestion as unknown as RequestHandler);

// POST /respond   → giriş yapmış herkes (yanıt gönder + discVector güncelle)
router.post('/respond', submitResponses as unknown as RequestHandler);

// GET  /my-responses → giriş yapmış herkes (tamamlanma oranı)
router.get('/my-responses', getMyResponses as unknown as RequestHandler);

export default router;
