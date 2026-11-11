import { asyncHandler } from '../utils/asyncHandler.js';
import Course from '../models/Course.js';
import Video from '../models/Video.js';

const SUPPORTED_LANGUAGES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'zh', 'ja', 'ko', 'tr', 'nl', 'pl',
]);

const normalizeLanguage = (value) => {
  const code = String(value || '').trim().toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.has(code) ? code : 'en';
};

/** Only the videos the user owns can be added to a course. */
const ownedVideoIds = async (userId, videoIds) => {
  const ids = (Array.isArray(videoIds) ? videoIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (ids.length === 0) return [];

  const videos = await Video.find({
    _id: { $in: ids },
    user: userId,
  })
    .select('_id title status durationSeconds thumbnailUrl')
    .lean();

  const byId = new Map(videos.map((video) => [String(video._id), video]));
  // Keep the order the user picked.
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((video) => video._id);
};

const withSummary = (course) => ({
  ...course,
  videos: (course.videos || []).map((entry) => ({
    video: entry.video,
    order: entry.order,
    addedAt: entry.addedAt,
  })),
});

// ---------- Courses: list ----------
export const listCourses = asyncHandler(async (req, res) => {
  const courses = await Course.find({ owner: req.user._id })
    .sort({ createdAt: -1 })
    .populate({
      path: 'videos.video',
      select: 'title status durationSeconds thumbnailUrl targetLanguages lessonVideos dubs',
    })
    .lean();

  res.status(200).json({
    success: true,
    data: {
      items: courses.map((course) => ({
        ...course,
        videos: (course.videos || []).map((entry) => ({
          order: entry.order,
          addedAt: entry.addedAt,
          video: entry.video
            ? {
                _id: entry.video._id,
                title: entry.video.title,
                status: entry.video.status,
                durationSeconds: entry.video.durationSeconds,
                thumbnailUrl: entry.video.thumbnailUrl,
                targetLanguages: entry.video.targetLanguages,
                lessonVideos: entry.video.lessonVideos,
                dubs: entry.video.dubs,
              }
            : null,
        })),
      })),
    },
  });
});

// ---------- Courses: create ----------
export const createCourse = asyncHandler(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) {
    const err = new Error('Course title is required');
    err.statusCode = 400;
    throw err;
  }

  const videoIds = await ownedVideoIds(req.user._id, req.body?.videoIds);

  const course = await Course.create({
    title,
    description: String(req.body?.description || '').trim(),
    language: normalizeLanguage(req.body?.language),
    thumbnailUrl: String(req.body?.thumbnailUrl || '').trim() || null,
    owner: req.user._id,
    videos: videoIds.map((video, index) => ({
      video,
      order: index,
      addedAt: new Date(),
    })),
  });

  res.status(201).json({ success: true, message: 'Course created', data: { course } });
});

// ---------- Courses: read ----------
export const getCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id })
    .populate({
      path: 'videos.video',
      select: 'title status durationSeconds thumbnailUrl targetLanguages lessonVideos dubs',
    })
    .lean();
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  res.status(200).json({
    success: true,
    data: {
      course: {
        ...course,
        videos: (course.videos || []).map((entry) => ({
          order: entry.order,
          addedAt: entry.addedAt,
          video: entry.video
            ? {
                _id: entry.video._id,
                title: entry.video.title,
                status: entry.video.status,
                durationSeconds: entry.video.durationSeconds,
                thumbnailUrl: entry.video.thumbnailUrl,
                targetLanguages: entry.video.targetLanguages,
                lessonVideos: entry.video.lessonVideos,
                dubs: entry.video.dubs,
              }
            : null,
        })),
      },
    },
  });
});

// ---------- Courses: update ----------
export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      const err = new Error('Course title is required');
      err.statusCode = 400;
      throw err;
    }
    course.title = title;
  }
  if (req.body?.description !== undefined) {
    course.description = String(req.body.description).trim();
  }
  if (req.body?.language !== undefined) {
    course.language = normalizeLanguage(req.body.language);
  }
  if (req.body?.thumbnailUrl !== undefined) {
    course.thumbnailUrl = String(req.body.thumbnailUrl).trim() || null;
  }

  await course.save();
  res.status(200).json({ success: true, message: 'Course updated', data: { course } });
});

// ---------- Courses: delete ----------
export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }
  res.status(200).json({ success: true, message: 'Course deleted' });
});

// ---------- Courses: add videos ----------
export const addCourseVideos = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  const videoIds = await ownedVideoIds(req.user._id, req.body?.videoIds);
  const existing = new Set((course.videos || []).map((entry) => String(entry.video)));

  let order = course.videos?.length || 0;
  for (const video of videoIds) {
    if (existing.has(String(video))) continue;
    course.videos.push({ video, order: order++, addedAt: new Date() });
  }

  await course.save();
  res.status(200).json({
    success: true,
    message: 'Videos added to the course',
    data: { course: withSummary(course.toObject()) },
  });
});

// ---------- Courses: remove a video ----------
export const removeCourseVideo = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  course.videos = (course.videos || []).filter(
    (entry) => String(entry.video) !== String(req.params.videoId),
  );
  course.videos.forEach((entry, index) => {
    entry.order = index;
  });

  await course.save();
  res.status(200).json({
    success: true,
    message: 'Video removed from the course',
    data: { course: withSummary(course.toObject()) },
  });
});

// ---------- Courses: reorder ----------
export const reorderCourseVideos = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  const order = Array.isArray(req.body?.videoIds) ? req.body.videoIds : [];
  const byId = new Map((course.videos || []).map((entry) => [String(entry.video), entry]));
  const reordered = [];

  for (const videoId of order) {
    const entry = byId.get(String(videoId));
    if (!entry) continue;
    entry.order = reordered.length;
    reordered.push(entry);
    byId.delete(String(videoId));
  }
  // Keep the videos the user did not mention.
  for (const entry of byId.values()) {
    entry.order = reordered.length;
    reordered.push(entry);
  }

  course.videos = reordered;
  await course.save();
  res.status(200).json({
    success: true,
    message: 'Course order updated',
    data: { course: withSummary(course.toObject()) },
  });
});
