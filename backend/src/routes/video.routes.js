import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect } from '../middleware/auth.middleware.js';
import { uploadVideoWithAttachments } from '../middleware/upload.middleware.js';
import * as video from '../controllers/video.controller.js';

const subtitleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['text/plain', 'text/vtt', 'application/x-subrip', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || /\.(srt|vtt)$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error('Unsupported subtitle file type (expected .srt or .vtt).'));
  },
}).single('file');

const router = Router();

router.use(protect);

router.get('/', video.listMyVideos);
router.get('/voices', video.listElevenLabsVoices);
router.get('/edge-voices', video.listEdgeVoices);
router.get('/youtube/channels', video.listYouTubeChannels);
router.get('/youtube/playlists', video.listYouTubePlaylists);
router.get('/google-voices', video.listGoogleVoices);
router.post('/tts/preview', video.previewVoice);
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
router.post('/:id/thumbnail/generate-ai', video.generateAiThumbnail);
router.post('/:id/process', video.processVideo);
router.post('/:id/cancel', video.cancelProcessing);
router.post('/:id/ask', video.answerVideoQuestion);
router.post('/:id/lesson', video.generateLesson);
router.post('/:id/lesson/cancel', video.cancelLessonGeneration);
router.post('/:id/lessons/:language/publish', video.publishLessonVideo);
router.post('/:id/dub', video.dubVideo);
router.post('/:id/dub/cancel', video.cancelDubbing);
router.delete('/:id/dub', video.deleteDub);
router.post('/:id/translate', video.translateVideo);
router.post('/:id/transcript/import', (req, res, next) => {
  subtitleUpload(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, video.importTranscriptReference);
router.get('/:id/publish-prefill', video.getPublishPrefill);
router.post('/:id/improve-seo', video.improveVideoSeo);
router.get('/:id/youtube', video.getVideoYouTube);
router.get('/:id', video.getVideo);
router.delete('/:id', video.deleteVideo);

export default router;
