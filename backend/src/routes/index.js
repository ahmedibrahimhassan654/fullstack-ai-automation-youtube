import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import videoRoutes from './video.routes.js';
import adminRoutes from './admin.routes.js';
import billingRoutes from './billing.routes.js';
import { protectSSE } from '../middleware/auth.middleware.js';
import * as video from '../controllers/video.controller.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

// Real-time progress streams (SSE). Auth via Bearer header or ?token= query param.
router.get('/events', protectSSE, video.streamGlobalEvents);
router.get('/videos/:id/events', protectSSE, video.streamVideoEvents);
router.get('/videos/:id/lessons/:language/subtitles.vtt', protectSSE, video.streamLessonSubtitle);

router.use('/videos', videoRoutes);
router.use('/admin', adminRoutes);
router.use('/billing', billingRoutes);

export default router;
