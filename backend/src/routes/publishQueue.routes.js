import { Router } from 'express';
import { protect } from '../middleware/auth.middleware.js';
import * as queue from '../controllers/publishQueue.controller.js';

const router = Router();

router.use(protect);

router.get('/', queue.listQueue);
router.get('/summary', queue.getQueueSummary);
router.get('/settings', queue.getQueueSettings);
router.post('/', queue.createQueueJob);
router.post('/batch', queue.createQueueBatch);
router.post('/courses/:id/schedule', queue.scheduleCourse);
router.patch('/:id', queue.updateQueueJob);
router.post('/:id/retry', queue.retryQueueJob);
router.post('/run', queue.runQueueNow);

export default router;
