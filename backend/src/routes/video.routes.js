import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect } from '../middleware/auth.middleware.js';
import { uploadVideoWithAttachments } from '../middleware/upload.middleware.js';
import * as video from '../controllers/video.controller.js';

const router = Router();

router.use(protect);

router.get('/', video.listMyVideos);
router.post('/upload', (req, res, next) => {
  uploadVideoWithAttachments(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, video.uploadVideo);
router.patch('/:id', video.updateVideo);
router.post('/:id/process', video.processVideo);
router.post('/:id/ask', video.answerVideoQuestion);
router.get('/:id', video.getVideo);
router.delete('/:id', video.deleteVideo);

export default router;
