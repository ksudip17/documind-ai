import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { query, getQueryHistory } from '../controllers/query';
import rateLimit from 'express-rate-limit';

const queryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'Query limit reached. Max 20 queries per hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.use(authenticate);

router.post('/', queryLimiter, query);
router.get('/history/:documentId', getQueryHistory);

export default router;
