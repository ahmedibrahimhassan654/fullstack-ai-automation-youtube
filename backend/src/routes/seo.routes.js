import { Router } from 'express';
import { protect } from '../middleware/auth.middleware.js';
import * as seo from '../controllers/seo.controller.js';

const router = Router();

router.use(protect);
router.get('/overview', seo.getSeoOverview);

export default router;
