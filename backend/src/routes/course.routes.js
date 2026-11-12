import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect } from '../middleware/auth.middleware.js';
import * as course from '../controllers/course.controller.js';

const router = Router();

router.use(protect);

router.get('/', course.listCourses);
router.post('/', course.createCourse);
router.get('/destinations', course.listCourseDestinations);
router.get('/channels', course.listChannelPlaylists);
router.get('/:id', course.getCourse);
router.get('/:id/youtube', course.getCourseYouTube);
router.post('/:id/youtube/sync', course.syncCourseYouTube);
router.patch('/:id', course.updateCourse);
router.delete('/:id', course.deleteCourse);
router.post('/:id/thumbnail', course.uploadCourseThumbnail);
router.post('/:id/publish', course.publishCourse);
router.post('/:id/videos', course.addCourseVideos);
router.delete('/:id/videos/:videoId', course.removeCourseVideo);
router.put('/:id/videos/order', course.reorderCourseVideos);

export default router;
