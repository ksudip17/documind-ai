import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getStats, getAllUsers } from '../controllers/admin';

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/stats', getStats);
router.get('/users', getAllUsers);

export default router;
