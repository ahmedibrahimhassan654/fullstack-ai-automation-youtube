import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect, adminOnly } from '../middleware/auth.middleware.js';
import * as admin from '../controllers/admin.controller.js';

const router = Router();

router.use(protect, adminOnly);

router.get('/stats', admin.getStats);
router.get('/users', admin.getUsers);
router.patch('/users/:id/role', admin.updateUserRole);
router.patch('/users/:id/status', admin.updateUserStatus);
router.get('/videos', admin.getVideos);
router.delete('/videos/:id', admin.deleteVideo);

export default router;