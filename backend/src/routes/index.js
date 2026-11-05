import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import videoRoutes from './video.routes.js';
import adminRoutes from './admin.routes.js';
import billingRoutes from './billing.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/videos', videoRoutes);
router.use('/admin', adminRoutes);
router.use('/billing', billingRoutes);

export default router;
