import fs from 'fs';
import PublishJob, { PUBLISH_JOB_ACTIVE_STATUSES } from '../models/PublishJob.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Video from '../models/Video.js';
import { env } from '../config/env.js';
import {
  addVideoToPlaylist,
  fetchYouTubeVideoStatus,
  getValidYouTubeAccessToken,
  publishYouTubeVideo,
  setYouTubeThumbnail,
  updatePlaylistItemPosition,
  updateYouTubeVideo,
} from './youtubePublish.service.js';
import {
  buildPublishDescription,
  buildSlotTimes,
  describeSlot,
  getPublishSettings,
  nextDailySlot,
  toYouTubePublishAt,
} from './publishScheduler.service.js';

const HOUR_MS = 60 * 60 * 1000;
const YOUTUBE_TOKEN_FIELDS =
  '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken';

// Only one queue pass may run at a time: two passes would upload the same job
// twice and burn quota on a duplicate video.
let queueRunning = false;

const log = (level, message, extra = '') =>
  console[level === 'error' ? 'error' : 'log'](
    `[publishQueue] ${message}${extra ? ` ${extra}` : ''}`,
  );

const httpError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const newestFirst = (items) =>
  [...items].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );

/**
 * Picks the render that should be uploaded. A dub keeps the original footage
 * and is preferred over a generated lesson render, exactly like the manual
 * publish flow.
 */
export const resolveRender = (video, { language, source = null, voice = null } = {}) => {
  const lang = String(language || '').trim();
  const dubs = newestFirst(
    (video?.dubs || []).filter((item) => item.language === lang && item.url),
  );
  const requestedDub = voice
    ? dubs.find((item) => String(item.voice || '') === String(voice))
    : null;
  const dub = requestedDub || dubs[0] || null;

  const lesson = newestFirst(
    (video?.lessonVideos || []).filter(
      (item) =>
        item.language === lang && (item.source || 'lesson') === 'lesson' && item.url,
    ),
  )[0] || null;

  const asRender = (item, kind) => ({
    source: kind,
    url: item.url,
    durationSeconds: Number(item.durationSeconds || 0),
    voice: kind === 'dub' ? item.voice || null : null,
  });

  if (source === 'dub') return dub ? asRender(dub, 'dub') : null;
  if (source === 'lesson') return lesson ? asRender(lesson, 'lesson') : null;
  if (dub) return asRender(dub, 'dub');
  if (lesson) return asRender(lesson, 'lesson');
  return null;
};

const isQuotaError = (error) => {
  const status = Number(error?.statusCode || error?.code || 0);
  const message = String(error?.message || '');
  return (
    status === 429 ||
    (status === 403 && /quota|rate ?limit|exceeded/i.test(message)) ||
    /quota exceeded|quotaExceeded|rateLimitExceeded|userRateLimitExceeded/i.test(message)
  );
};

const nextQuotaRetryAt = () => {
  const { retryHour } = getPublishSettings();
  return nextDailySlot(new Date(), retryHour);
};

const backoffRetryAt = (attempts) => {
  const minutes = Math.min(6 * 60, 15 * Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + minutes * 60 * 1000);
};

/**
 * The first free slot after every active job of this owner. Scheduling a batch
 * therefore continues the existing calendar instead of overlapping it.
 */
export const nextAvailableSlot = async ({
  ownerId,
  from = new Date(),
  gapHours = null,
} = {}) => {
  const settings = getPublishSettings();
  const gap = Number(gapHours) > 0 ? Number(gapHours) : settings.gapHours;
  const earliest = new Date(
    Math.max(new Date(from).getTime(), Date.now() + settings.minLeadMinutes * 60 * 1000),
  );

  if (!ownerId) return buildSlotTimes({ count: 1, startAt: earliest })[0];

  const last = await PublishJob.findOne({
    owner: ownerId,
    status: { $in: PUBLISH_JOB_ACTIVE_STATUSES },
  })
    .sort({ scheduledPublishAt: -1 })
    .select('scheduledPublishAt')
    .lean();

  if (last?.scheduledPublishAt) {
    const lastAt = new Date(last.scheduledPublishAt);
    if (lastAt.getTime() >= earliest.getTime()) {
      return new Date(lastAt.getTime() + gap * HOUR_MS);
    }
  }
  return buildSlotTimes({ count: 1, startAt: earliest, gapHours: gap })[0];
};

const loadJobContext = async ({ videoId, courseId = null, ownerId }) => {
  const video = await Video.findById(videoId);
  if (!video) throw httpError('Video not found', 404);
  if (ownerId && String(video.user) !== String(ownerId)) {
    throw httpError('Not authorized to publish this video', 403);
  }
  const course = courseId ? await Course.findById(courseId) : null;
  return { video, course };
};

/**
 * Queues one video for a scheduled publish.
 *
 * The upload payload (title, description, tags, thumbnail, destination) is
 * snapshotted here, so editing the video later cannot change what a slot
 * promises. An active job for the same render is updated instead of
 * duplicated, which makes the endpoint safe to call twice.
 */
export const enqueuePublishJob = async ({
  ownerId,
  videoId,
  courseId = null,
  language,
  source = null,
  voice = null,
  playlistId = null,
  channelId = null,
  scheduledPublishAt = null,
  schedulingMode = null,
  title = null,
  description = null,
  tags = null,
  categoryId = null,
  thumbnailPath = null,
  thumbnailUrl = null,
  visibility = 'public',
  madeForKids = false,
  videoLanguage = null,
  playlistPosition = null,
} = {}) => {
  const lang = String(language || '').trim();
  if (!lang) throw httpError('Target language is required', 400);

  const { video, course } = await loadJobContext({ videoId, courseId, ownerId });
  const render = resolveRender(video, { language: lang, source, voice });
  if (!render) {
    throw httpError(
      `"${video.title}" has no ${lang} ${source || 'dubbed or lesson'} version yet`,
      400,
    );
  }

  const targetPlaylistId =
    String(playlistId || course?.playlistId || course?.youtubePlaylistId || '').trim() || null;
  const targetChannelId =
    String(channelId || course?.channelId || '').trim() || null;

  const resolvedTitle = String(
    title || video.aiMetadata?.titles?.[0] || `${video.title} (${lang})`,
  )
    .replace(/[<>]/g, '')
    .slice(0, 100)
    .trim();
  if (!resolvedTitle) throw httpError('A YouTube title is required', 400);

  const baseDescription = String(
    description ||
      video.aiMetadata?.summary ||
      video.aiMetadata?.descriptions?.[0] ||
      video.description ||
      '',
  ).trim();
  const resolvedDescription = buildPublishDescription({
    description: baseDescription,
    playlistId: targetPlaylistId,
    channelId: targetChannelId,
    courseTitle: course?.title || '',
  });

  const resolvedTags = Array.isArray(tags) && tags.length
    ? tags
    : Array.isArray(video.aiMetadata?.tags)
      ? video.aiMetadata.tags
      : [];

  const settings = getPublishSettings();
  const slot = scheduledPublishAt ? new Date(scheduledPublishAt) : await nextAvailableSlot({
    ownerId: video.user,
  });
  if (Number.isNaN(slot.getTime())) throw httpError('scheduledPublishAt is not a valid date', 400);

  // YouTube rejects publishAt that is too close to the upload; such a job is
  // uploaded private and the worker flips it to public at the slot instead.
  const leadMs = slot.getTime() - Date.now();
  const mode = schedulingMode && ['youtube', 'worker'].includes(schedulingMode)
    ? schedulingMode
    : leadMs > 10 * 60 * 1000
      ? settings.mode
      : 'worker';

  const active = await PublishJob.findOne({
    owner: video.user,
    video: video._id,
    language: lang,
    source: render.source,
    status: { $in: PUBLISH_JOB_ACTIVE_STATUSES },
  });

  const payload = {
    owner: video.user,
    video: video._id,
    course: course?._id || null,
    language: lang,
    source: render.source,
    voice: render.voice,
    mediaUrl: render.url,
    mediaDurationSeconds: render.durationSeconds,
    channelId: targetChannelId,
    playlistId: targetPlaylistId,
    playlistPosition:
      Number.isInteger(playlistPosition) && playlistPosition >= 0 ? playlistPosition : null,
    title: resolvedTitle,
    description: resolvedDescription,
    tags: resolvedTags.slice(0, 30),
    categoryId: String(categoryId || video.youtubeCategoryId || '27'),
    thumbnailPath: thumbnailPath || null,
    thumbnailUrl: thumbnailUrl || video.thumbnailUrl || null,
    madeForKids: Boolean(madeForKids),
    videoLanguage: String(videoLanguage || lang || 'en'),
    visibility: ['public', 'unlisted', 'private'].includes(visibility) ? visibility : 'public',
    scheduledPublishAt: slot,
    schedulingMode: mode,
    status: 'PENDING',
    nextRetryAt: null,
    lastError: null,
    quotaExceeded: false,
    completedAt: null,
  };

  if (active) {
    Object.assign(active, payload);
    active.addLog('info', `Rescheduled to ${describeSlot(slot)}`);
    await active.save();
    return { job: active, created: false };
  }

  const job = new PublishJob(payload);
  job.addLog('info', `Queued for ${describeSlot(slot)} (${mode} scheduling)`);
  await job.save();
  log('log', `queued ${job._id} (${lang}, ${render.source}) for ${describeSlot(slot)}`);
  return { job, created: true };
};

/**
 * Queues a batch (a course, or a list of videos) on consecutive slots.
 */
export const enqueuePublishJobs = async ({
  ownerId,
  items = [],
  startAt = null,
  gapHours = null,
  courseId = null,
  playlistId = null,
  channelId = null,
  schedulingMode = null,
} = {}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('No videos to schedule', 400);
  }

  const settings = getPublishSettings();
  const gap = Number(gapHours) > 0 ? Number(gapHours) : settings.gapHours;
  const firstSlot =
    startAt && !Number.isNaN(new Date(startAt).getTime())
      ? new Date(startAt)
      : await nextAvailableSlot({ ownerId, gapHours: gap });

  const slots = buildSlotTimes({
    count: items.length,
    startAt: firstSlot,
    gapHours: gap,
  });

  const jobs = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = await enqueuePublishJob({
      ownerId,
      videoId: item.videoId || item.video || item._id,
      courseId: item.courseId || courseId,
      language: item.language,
      source: item.source || null,
      voice: item.voice || null,
      playlistId: item.playlistId || playlistId,
      channelId: item.channelId || channelId,
      scheduledPublishAt: slots[index],
      schedulingMode: item.schedulingMode || schedulingMode,
      title: item.title || null,
      description: item.description || null,
      tags: item.tags || null,
      categoryId: item.categoryId || null,
      thumbnailPath: item.thumbnailPath || null,
      thumbnailUrl: item.thumbnailUrl || null,
      visibility: item.visibility || 'public',
      madeForKids: item.madeForKids ?? false,
      videoLanguage: item.videoLanguage || null,
      playlistPosition: item.playlistPosition ?? index,
    });
    jobs.push(result.job);
  }
  return jobs;
};

const readThumbnail = async (job) => {
  if (job.thumbnailPath && fs.existsSync(job.thumbnailPath)) {
    return { buffer: fs.readFileSync(job.thumbnailPath), mimeType: 'image/jpeg' };
  }
  if (job.thumbnailUrl) {
    const res = await fetch(job.thumbnailUrl);
    if (!res.ok) return null;
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type') || 'image/jpeg',
    };
  }
  return null;
};

/**
 * Keeps the video page and the course in sync with the queued upload, so a
 * scheduled lesson already shows its YouTube link (as private) before it goes
 * live.
 */
const syncLocalRecords = async (job, youtubeVideoId, { published }) => {
  const video = await Video.findById(job.video);
  if (!video) return;

  let lesson = (video.lessonVideos || []).find(
    (item) =>
      item.language === job.language &&
      (item.source || 'lesson') === job.source &&
      (job.source !== 'dub' || String(item.voice || '') === String(job.voice || '')),
  );

  if (!lesson) {
    lesson = {
      language: job.language,
      source: job.source,
      url: job.mediaUrl,
      durationSeconds: job.mediaDurationSeconds,
      voice: job.voice,
      createdAt: new Date(),
    };
    video.lessonVideos = [...(video.lessonVideos || []), lesson];
  }

  lesson.youtubeVideoId = youtubeVideoId;
  lesson.youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  lesson.youtubeChannelId = job.channelId || lesson.youtubeChannelId || null;
  lesson.youtubeChannelTitle = job.channelTitle || lesson.youtubeChannelTitle || null;
  lesson.youtubePlaylistId = job.playlistId || null;
  lesson.youtubePlaylistItemId = job.youtubePlaylistItemId || null;
  lesson.youtubeVisibility = published ? job.visibility : 'private';
  lesson.youtubeCategoryId = job.categoryId;
  lesson.youtubeTitle = job.title;
  lesson.youtubeDescription = job.description;
  lesson.youtubeTags = job.tags;
  lesson.youtubeMadeForKids = job.madeForKids;
  lesson.youtubeVideoLanguage = job.videoLanguage;
  lesson.youtubeScheduledPublishAt = job.scheduledPublishAt;
  if (published) {
    lesson.youtubePublishedAt = lesson.youtubePublishedAt || new Date();
  }
  await video.save();

  if (!job.course) return;
  const course = await Course.findById(job.course);
  if (!course) return;
  const entry = (course.videos || []).find(
    (item) => String(item.video) === String(job.video),
  );
  if (!entry) return;
  entry.youtubeVideoId = youtubeVideoId;
  entry.youtubeUrl = lesson.youtubeUrl;
  entry.youtubePlaylistItemId = job.youtubePlaylistItemId || entry.youtubePlaylistItemId || null;
  if (published) entry.publishedAt = entry.publishedAt || new Date();
  await course.save();
};

const attachToPlaylist = async (job, accessToken, youtubeVideoId) => {
  if (!job.playlistId) return null;
  try {
    const item = await addVideoToPlaylist(accessToken, job.playlistId, youtubeVideoId);
    const playlistItemId = item?.id || null;
    if (playlistItemId && Number.isInteger(job.playlistPosition) && job.playlistPosition >= 0) {
      try {
        await updatePlaylistItemPosition(
          accessToken,
          playlistItemId,
          job.playlistId,
          youtubeVideoId,
          job.playlistPosition,
        );
      } catch (error) {
        job.addLog('warn', `Playlist position update failed: ${error?.message}`, 'playlistPositionFailed');
      }
    }
    return playlistItemId;
  } catch (error) {
    // A playlist failure must not lose a finished upload.
    job.addLog('warn', `Playlist add failed: ${error?.message}`, 'playlistFailed');
    return null;
  }
};

const applyThumbnail = async (job, accessToken, youtubeVideoId) => {
  try {
    const thumbnail = await readThumbnail(job);
    if (!thumbnail) return;
    await setYouTubeThumbnail(accessToken, youtubeVideoId, thumbnail.buffer, thumbnail.mimeType);
  } catch (error) {
    job.addLog('warn', `Thumbnail upload failed: ${error?.message}`, 'thumbnailFailed');
  }
};

const handleJobFailure = async (job, error) => {
  const quota = isQuotaError(error);
  const message = String(error?.message || 'Publish failed').slice(0, 1000);
  job.lastError = message;
  job.quotaExceeded = quota;
  job.addLog(quota ? 'warn' : 'error', message, quota ? 'quotaExceeded' : 'publishFailed');

  if (quota) {
    // Quota is a daily budget, not a broken job: retry after it resets and
    // never count it towards the hard failure limit.
    job.status = 'PENDING';
    job.nextRetryAt = nextQuotaRetryAt();
    job.retryAfter = job.nextRetryAt;
    log('log', `quota reached on ${job._id}, retrying at ${describeSlot(job.nextRetryAt)}`);
  } else if (job.attempts >= job.maxAttempts) {
    job.status = 'FAILED';
    job.nextRetryAt = null;
    job.completedAt = new Date();
    log('error', `job ${job._id} failed permanently: ${message}`);
  } else {
    job.status = 'PENDING';
    job.nextRetryAt = backoffRetryAt(job.attempts);
    log('log', `job ${job._id} failed, retrying at ${describeSlot(job.nextRetryAt)}`);
  }

  await job.save();
};

/**
 * Uploads (or publishes) one job.
 *
 * The job is claimed by moving it to UPLOADING first, so a second pass cannot
 * pick it up. Any thrown error goes through the retry/quota policy.
 */
export const processPublishJob = async (jobId) => {
  const job = await PublishJob.findById(jobId);
  if (!job || !job.isActive()) return job || null;
  if (job.status === 'UPLOADING') return job;

  job.status = 'UPLOADING';
  job.attempts += 1;
  job.nextRetryAt = null;
  job.addLog('info', `Attempt ${job.attempts} started`);
  await job.save();

  try {
    const user = await User.findById(job.owner).select(YOUTUBE_TOKEN_FIELDS);
    if (!user) throw httpError('Owner not found', 404);
    const accessToken = await getValidYouTubeAccessToken(user, job.channelId);

    const now = Date.now();
    const due = new Date(job.scheduledPublishAt).getTime() <= now;
    const publishAt =
      job.schedulingMode === 'youtube' && !due
        ? toYouTubePublishAt(job.scheduledPublishAt)
        : null;

    let youtubeVideoId = job.youtubeVideoId;

    if (!youtubeVideoId) {
      const mediaRes = await fetch(job.mediaUrl);
      if (!mediaRes.ok) {
        throw httpError(
          `Failed to download the ${job.source} render (${mediaRes.status})`,
          502,
        );
      }
      const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
      const uploaded = await publishYouTubeVideo(
        accessToken,
        {
          title: job.title,
          description: job.description,
          tags: job.tags,
          categoryId: job.categoryId,
          // A scheduled video must be private; YouTube publishes it itself.
          visibility: publishAt ? 'private' : due ? job.visibility : 'private',
          publishAt,
          madeForKids: job.madeForKids,
          videoLanguage: job.videoLanguage,
          mimeType: 'video/mp4',
        },
        mediaBuffer,
      );
      youtubeVideoId = uploaded.id;
      job.youtubeVideoId = youtubeVideoId;
      job.uploadedAt = new Date();
      job.addLog('info', `Uploaded as ${youtubeVideoId}`);
    } else if (due) {
      // Worker mode: the video was uploaded private earlier, publish it now.
      await updateYouTubeVideo(accessToken, youtubeVideoId, {
        title: job.title,
        description: job.description,
        tags: job.tags,
        categoryId: job.categoryId,
        visibility: job.visibility,
        madeForKids: job.madeForKids,
        videoLanguage: job.videoLanguage,
      });
    }

    job.youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    job.youtubePlaylistItemId =
      (await attachToPlaylist(job, accessToken, youtubeVideoId)) || job.youtubePlaylistItemId;
    await applyThumbnail(job, accessToken, youtubeVideoId);

    const publishedNow = !publishAt;
    job.status = publishedNow ? 'PUBLISHED' : 'SCHEDULED';
    if (publishedNow) {
      job.publishedAt = new Date();
      job.completedAt = job.publishedAt;
    }
    job.lastError = null;
    job.quotaExceeded = false;
    job.addLog(
      'info',
      publishedNow
        ? `Published ${job.youtubeUrl}`
        : `Scheduled for ${describeSlot(job.scheduledPublishAt)}`,
    );

    await syncLocalRecords(job, youtubeVideoId, { published: publishedNow });
    await job.save();
    log('log', `job ${job._id} -> ${job.status} (${job.youtubeUrl})`);
    return job;
  } catch (error) {
    await handleJobFailure(job, error);
    return job;
  }
};

/**
 * Confirms that YouTube actually published the scheduled uploads. YouTube is
 * the source of truth: a video is only marked PUBLISHED once the API says so.
 */
export const verifyScheduledJobs = async ({ limit = 10 } = {}) => {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const jobs = await PublishJob.find({
    status: 'SCHEDULED',
    scheduledPublishAt: { $lte: cutoff },
  })
    .sort({ scheduledPublishAt: 1 })
    .limit(limit);

  let published = 0;
  for (const job of jobs) {
    try {
      const user = await User.findById(job.owner).select(YOUTUBE_TOKEN_FIELDS);
      if (!user) throw httpError('Owner not found', 404);
      const accessToken = await getValidYouTubeAccessToken(user, job.channelId);
      const video = await fetchYouTubeVideoStatus(accessToken, job.youtubeVideoId);
      const privacy = String(video?.status?.privacyStatus || '').toLowerCase();
      const uploadStatus = String(video?.status?.uploadStatus || '').toLowerCase();

      if (privacy === 'public' || privacy === 'unlisted') {
        job.status = 'PUBLISHED';
        job.publishedAt = job.publishedAt || new Date();
        job.completedAt = job.publishedAt;
        job.addLog('info', `YouTube reports ${privacy}; marked published`);
        await syncLocalRecords(job, job.youtubeVideoId, { published: true });
        await job.save();
        published += 1;
      } else if (uploadStatus === 'failed' || uploadStatus === 'rejected') {
        job.status = 'FAILED';
        job.lastError = `YouTube upload ${uploadStatus}`;
        job.completedAt = new Date();
        job.addLog('error', job.lastError, 'uploadRejected');
        await job.save();
      }
      // Otherwise it is still processing; the next tick checks again.
    } catch (error) {
      if (isQuotaError(error)) {
        job.addLog('warn', `Verification skipped: ${error.message}`, 'quotaExceeded');
        job.nextRetryAt = nextQuotaRetryAt();
        await job.save();
        break;
      }
      job.addLog('warn', `Verification failed: ${error?.message}`, 'verifyFailed');
      await job.save();
    }
  }
  return published;
};

/**
 * The worker pass: retries that are due, then uploads/publishes that are due.
 */
export const processPublishQueue = async ({ limit = 5, now = new Date() } = {}) => {
  if (queueRunning) return { skipped: true, processed: 0 };
  queueRunning = true;

  const summary = { processed: 0, published: 0, scheduled: 0, failed: 0, verified: 0, skipped: false };
  try {
    const due = await PublishJob.find({
      status: 'PENDING',
      $or: [
        { nextRetryAt: null, scheduledPublishAt: { $lte: now } },
        { nextRetryAt: { $lte: now } },
      ],
    })
      .sort({ scheduledPublishAt: 1 })
      .limit(limit)
      .select('_id');

    for (const { _id } of due) {
      const job = await processPublishJob(_id);
      summary.processed += 1;
      if (!job) continue;
      if (job.status === 'PUBLISHED') summary.published += 1;
      else if (job.status === 'SCHEDULED') summary.scheduled += 1;
      else if (job.status === 'FAILED') summary.failed += 1;
    }

    summary.verified = await verifyScheduledJobs({ limit });
    if (summary.processed || summary.verified) {
      log('log', 'tick finished', JSON.stringify(summary));
    }
    return summary;
  } catch (error) {
    log('error', 'tick crashed:', error?.message || error);
    return { ...summary, error: error?.message || String(error) };
  } finally {
    queueRunning = false;
  }
};

/** A restart must not leave jobs stuck in UPLOADING forever. */
export const recoverInterruptedPublishJobs = async () => {
  const result = await PublishJob.updateMany(
    { status: 'UPLOADING' },
    {
      $set: {
        status: 'PENDING',
        nextRetryAt: new Date(),
      },
      $push: {
        logs: {
          at: new Date(),
          level: 'warn',
          message: 'Interrupted by a server restart; queued for a retry',
          code: 'interrupted',
        },
      },
    },
  );
  if (result.modifiedCount) {
    log('log', `recovered ${result.modifiedCount} interrupted job(s)`);
  }
  return result.modifiedCount || 0;
};

export const listPublishJobs = async ({
  ownerId,
  status = null,
  videoId = null,
  limit = 100,
} = {}) => {
  const query = { owner: ownerId };
  if (status) query.status = String(status).toUpperCase();
  if (videoId) query.video = videoId;
  return PublishJob.find(query)
    .sort({ scheduledPublishAt: 1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
    .populate('video', 'title thumbnailUrl')
    .populate('course', 'title language playlistId')
    .lean();
};

export const getPublishQueueSummary = async ({ ownerId } = {}) => {
  const rows = await PublishJob.aggregate([
    { $match: { owner: ownerId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
  const settings = getPublishSettings();
  const next = await PublishJob.findOne({
    owner: ownerId,
    status: { $in: PUBLISH_JOB_ACTIVE_STATUSES },
    scheduledPublishAt: { $gte: new Date() },
  })
    .sort({ scheduledPublishAt: 1 })
    .select('scheduledPublishAt status language title')
    .lean();

  return {
    counts,
    settings: {
      gapHours: settings.gapHours,
      videosPerDay: settings.videosPerDay,
      startHour: settings.startHour,
      mode: settings.mode,
      enabled: settings.enabled,
    },
    nextSlot: next?.scheduledPublishAt || null,
  };
};

export const cancelPublishJob = async ({ jobId, ownerId, reason = 'Canceled by user' }) => {
  const job = await PublishJob.findOne({ _id: jobId, owner: ownerId });
  if (!job) throw httpError('Publish job not found', 404);
  if (job.status === 'PUBLISHED') throw httpError('A published video cannot be canceled', 400);
  job.status = 'CANCELED';
  job.nextRetryAt = null;
  job.completedAt = new Date();
  job.addLog('info', reason);
  await job.save();
  return job;
};

export const reschedulePublishJob = async ({ jobId, ownerId, scheduledPublishAt }) => {
  const date = new Date(scheduledPublishAt);
  if (Number.isNaN(date.getTime())) throw httpError('scheduledPublishAt is not a valid date', 400);
  const job = await PublishJob.findOne({ _id: jobId, owner: ownerId });
  if (!job) throw httpError('Publish job not found', 404);
  if (job.status === 'PUBLISHED') throw httpError('A published video cannot be rescheduled', 400);
  if (job.youtubeVideoId) {
    throw httpError(
      'This job was already uploaded to YouTube; change its schedule in YouTube Studio',
      400,
    );
  }
  job.scheduledPublishAt = date;
  job.status = 'PENDING';
  job.nextRetryAt = null;
  job.completedAt = null;
  job.addLog('info', `Rescheduled to ${describeSlot(date)}`);
  await job.save();
  return job;
};

export const retryPublishJob = async ({ jobId, ownerId }) => {
  const job = await PublishJob.findOne({ _id: jobId, owner: ownerId });
  if (!job) throw httpError('Publish job not found', 404);
  if (job.status === 'PUBLISHED') throw httpError('This job is already published', 400);
  job.status = 'PENDING';
  job.attempts = 0;
  job.nextRetryAt = new Date();
  job.completedAt = null;
  job.quotaExceeded = false;
  job.addLog('info', 'Manual retry requested');
  await job.save();
  return job;
};

/**
 * Queues every lesson of a course on consecutive slots, in lesson order.
 * Lessons without a render for their language are skipped with a warning
 * instead of failing the whole batch.
 */
export const enqueueCoursePublishJobs = async ({
  ownerId,
  courseId,
  startAt = null,
  gapHours = null,
  schedulingMode = null,
} = {}) => {
  const course = await Course.findOne({ _id: courseId, owner: ownerId });
  if (!course) throw httpError('Course not found', 404);
  if (!course.videos?.length) throw httpError('Add at least one lesson before scheduling', 400);

  const lessons = [...course.videos].sort((a, b) => (a.order || 0) - (b.order || 0));
  const items = [];

  for (let index = 0; index < lessons.length; index += 1) {
    const entry = lessons[index];
    const video = await Video.findById(entry.video).lean();
    if (!video) {
      log('log', `course ${courseId}: lesson ${index + 1} has no video, skipped`);
      continue;
    }
    const language = entry.language || course.language;
    const render = resolveRender(video, { language });
    if (!render) {
      log('log', `course ${courseId}: "${video.title}" has no ${language} render, skipped`);
      continue;
    }
    items.push({
      videoId: video._id,
      language,
      source: render.source,
      voice: render.voice,
      playlistPosition: index,
    });
  }

  if (!items.length) {
    throw httpError('No lesson in this course has a dubbed or generated version yet', 400);
  }

  return enqueuePublishJobs({
    ownerId,
    items,
    startAt,
    gapHours,
    courseId: course._id,
    playlistId: course.playlistId || course.youtubePlaylistId || null,
    channelId: course.channelId || null,
    schedulingMode,
  });
};

/**
 * Records an upload that the course publish flow already made with a
 * status.publishAt. YouTube owns the publication from that point; the job
 * exists so the queue can verify the result and retry a failed one.
 */
export const recordScheduledUpload = async ({
  ownerId,
  video,
  course = null,
  language,
  source,
  voice = null,
  mediaUrl,
  mediaDurationSeconds = 0,
  playlistId = null,
  channelId = null,
  playlistPosition = null,
  title,
  description = '',
  tags = [],
  categoryId = '27',
  thumbnailUrl = null,
  visibility = 'public',
  madeForKids = false,
  videoLanguage = null,
  youtubeVideoId,
  youtubePlaylistItemId = null,
  scheduledPublishAt,
}) => {
  const slot = new Date(scheduledPublishAt);
  if (Number.isNaN(slot.getTime())) throw httpError('scheduledPublishAt is not a valid date', 400);

  const active = await PublishJob.findOne({
    owner: ownerId,
    video: video,
    language,
    source,
    status: { $in: PUBLISH_JOB_ACTIVE_STATUSES },
  });

  const payload = {
    owner: ownerId,
    video,
    course: course || null,
    language,
    source,
    voice,
    mediaUrl,
    mediaDurationSeconds: Number(mediaDurationSeconds) || 0,
    channelId: channelId || null,
    playlistId: playlistId || null,
    playlistPosition:
      Number.isInteger(playlistPosition) && playlistPosition >= 0 ? playlistPosition : null,
    title: String(title || '').slice(0, 100),
    description,
    tags: Array.isArray(tags) ? tags.slice(0, 30) : [],
    categoryId: String(categoryId || '27'),
    thumbnailUrl: thumbnailUrl || null,
    madeForKids: Boolean(madeForKids),
    videoLanguage: videoLanguage || language || null,
    visibility: ['public', 'unlisted', 'private'].includes(visibility) ? visibility : 'public',
    scheduledPublishAt: slot,
    schedulingMode: 'youtube',
    status: 'SCHEDULED',
    youtubeVideoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
    youtubePlaylistItemId: youtubePlaylistItemId || null,
    uploadedAt: new Date(),
    attempts: 1,
    lastError: null,
    quotaExceeded: false,
    nextRetryAt: null,
    completedAt: null,
  };

  const job = active || new PublishJob(payload);
  if (active) Object.assign(active, payload);
  job.addLog('info', `Uploaded ${youtubeVideoId} with publishAt ${describeSlot(slot)}`);
  await job.save();
  return job;
};

/** Used by server.js: one tick, never throws. */
export const runPublishQueueTick = async () => {
  if (String(env.publishQueueEnabled ?? '1') === '0') return null;
  try {
    return await processPublishQueue({});
  } catch (error) {
    log('error', 'tick failed:', error?.message || error);
    return null;
  }
};
