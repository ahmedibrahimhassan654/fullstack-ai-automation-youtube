import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect } from '../middleware/auth.middleware.js';
import { uploadVideoWithAttachments } from '../middleware/upload.middleware.js';
import * as video from '../controllers/video.controller.js';

const router = Router();

router.use(protect);

router.get('/', video.listMyVideos);
router.get('/voices', video.listElevenLabsVoices);
router.get('/edge-voices', video.listEdgeVoices);
router.get('/youtube/channels', video.listYouTubeChannels);
router.get('/youtube/playlists', video.listYouTubePlaylists);
router.get('/youtube/videos/:youtubeVideoId/comments', video.listYouTubeComments);
router.post('/youtube/comments/:commentId/reply', video.replyYouTubeComment);
router.post('/upload', (req, res, next) => {
  uploadVideoWithAttachments(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, video.uploadVideo);
router.patch('/:id', video.updateVideo);
router.post('/:id/thumbnail', video.uploadCanvasThumbnail);
router.post('/:id/process', video.processVideo);
router.post('/:id/ask', video.answerVideoQuestion);
router.post('/:id/lesson', video.generateLesson);
router.post('/:id/lesson/cancel', video.cancelLessonGeneration);
router.post('/:id/lessons/:language/publish', video.publishLessonVideo);
router.post('/:id/dub', video.dubVideo);
router.post('/:id/dub/cancel', video.cancelDubbing);
router.post('/:id/translate', video.translateVideo);
router.get('/:id/publish-prefill', video.getPublishPrefill);
router.get('/:id', video.getVideo);
router.delete('/:id', video.deleteVideo);

export default router;
