import { asyncHandler } from '../utils/asyncHandler.js';
import { getPublishSettings } from '../services/publishScheduler.service.js';
import {
  cancelPublishJob,
  enqueueCoursePublishJobs,
  enqueuePublishJob,
  enqueuePublishJobs,
  getPublishQueueSummary,
  listPublishJobs,
  processPublishQueue,
  reschedulePublishJob,
  retryPublishJob,
} from '../services/publishQueue.service.js';

const ownerIdFor = (req) => {
  const requested = String(req.query?.owner || req.body?.owner || '').trim();
  if (requested && req.user.role === 'admin') return requested;
  return req.user._id;
};

// ---------- Queue: read ----------
export const listQueue = asyncHandler(async (req, res) => {
  const jobs = await listPublishJobs({
    ownerId: ownerIdFor(req),
    status: req.query?.status || null,
    videoId: req.query?.videoId || null,
    limit: req.query?.limit || 100,
  });
  res.status(200).json({ success: true, count: jobs.length, data: jobs });
});

export const getQueueSummary = asyncHandler(async (req, res) => {
  const summary = await getPublishQueueSummary({ ownerId: ownerIdFor(req) });
  res.status(200).json({ success: true, data: summary });
});

export const getQueueSettings = asyncHandler(async (req, res) => {
  const settings = getPublishSettings();
  res.status(200).json({ success: true, data: settings });
});

// ---------- Queue: write ----------
export const createQueueJob = asyncHandler(async (req, res) => {
  const { job, created } = await enqueuePublishJob({
    ownerId: req.user._id,
    videoId: req.body?.videoId || req.params?.videoId,
    courseId: req.body?.courseId || null,
    language: req.body?.language,
    source: req.body?.source || null,
    voice: req.body?.voice || null,
    playlistId: req.body?.playlistId || null,
    channelId: req.body?.channelId || null,
    scheduledPublishAt: req.body?.scheduledPublishAt || null,
    schedulingMode: req.body?.schedulingMode || null,
    title: req.body?.title || null,
    description: req.body?.description || null,
    tags: Array.isArray(req.body?.tags) ? req.body.tags : null,
    categoryId: req.body?.categoryId || null,
    thumbnailPath: req.body?.thumbnailPath || null,
    thumbnailUrl: req.body?.thumbnailUrl || null,
    visibility: req.body?.visibility || 'public',
    madeForKids: req.body?.madeForKids ?? false,
    videoLanguage: req.body?.videoLanguage || null,
    playlistPosition: req.body?.playlistPosition ?? null,
  });

  res.status(created ? 201 : 200).json({
    success: true,
    message: created ? 'Video queued for scheduled publishing' : 'Queued publish updated',
    data: job,
  });
});

export const createQueueBatch = asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const jobs = await enqueuePublishJobs({
    ownerId: req.user._id,
    items,
    startAt: req.body?.startAt || null,
    gapHours: req.body?.gapHours || null,
    courseId: req.body?.courseId || null,
    playlistId: req.body?.playlistId || null,
    channelId: req.body?.channelId || null,
    schedulingMode: req.body?.schedulingMode || null,
  });

  res.status(201).json({
    success: true,
    message: `${jobs.length} video(s) queued for scheduled publishing`,
    data: jobs,
  });
});

export const scheduleCourse = asyncHandler(async (req, res) => {
  const jobs = await enqueueCoursePublishJobs({
    ownerId: req.user._id,
    courseId: req.params.id,
    startAt: req.body?.startAt || null,
    gapHours: req.body?.gapHours || null,
    schedulingMode: req.body?.schedulingMode || null,
  });

  res.status(201).json({
    success: true,
    message: `${jobs.length} lesson(s) queued for scheduled publishing`,
    data: jobs,
  });
});

export const updateQueueJob = asyncHandler(async (req, res) => {
  const ownerId = ownerIdFor(req);
  const status = String(req.body?.status || '').toUpperCase();

  if (status === 'CANCELED') {
    const job = await cancelPublishJob({
      jobId: req.params.id,
      ownerId,
      reason: req.body?.reason || 'Canceled by user',
    });
    return res.status(200).json({ success: true, message: 'Publish canceled', data: job });
  }

  if (req.body?.scheduledPublishAt) {
    const job = await reschedulePublishJob({
      jobId: req.params.id,
      ownerId,
      scheduledPublishAt: req.body.scheduledPublishAt,
    });
    return res.status(200).json({ success: true, message: 'Publish rescheduled', data: job });
  }

  const err = new Error('Provide scheduledPublishAt or status: "CANCELED"');
  err.statusCode = 400;
  throw err;
});

export const retryQueueJob = asyncHandler(async (req, res) => {
  const job = await retryPublishJob({
    jobId: req.params.id,
    ownerId: ownerIdFor(req),
  });
  res.status(200).json({ success: true, message: 'Retry queued', data: job });
});

// ---------- Queue: worker ----------
export const runQueueNow = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    const err = new Error('Only an admin can run the publish queue manually');
    err.statusCode = 403;
    throw err;
  }
  const summary = await processPublishQueue({
    limit: Math.min(25, Math.max(1, Number(req.body?.limit) || 5)),
  });
  res.status(200).json({ success: true, data: summary });
});
