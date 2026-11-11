import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect } from '../middleware/auth.middleware.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refresh);
router.get('/me', protect, authController.me);

// YouTube OAuth 2.0
router.get('/youtube/connect', protect, authController.prepareYouTubeConnect, authController.youtubeConnect);
// POST allows passing the language of the channel being added in the body.
router.post('/youtube/connect', protect, authController.prepareYouTubeConnect, authController.youtubeConnect);
router.get('/youtube/callback', authController.youtubeCallback);
router.get('/youtube/status', protect, authController.youtubeStatus);
router.post('/youtube/channel', protect, authController.youtubeSelectChannel);
router.post('/youtube/channel-language', protect, authController.youtubeSetChannelLanguage);
router.post('/youtube/disconnect', protect, authController.youtubeDisconnect);

export default router;
