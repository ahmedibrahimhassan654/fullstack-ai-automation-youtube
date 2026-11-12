import { asyncHandler } from '../utils/asyncHandler.js';
import Course from '../models/Course.js';
import Video from '../models/Video.js';
import User from '../models/User.js';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { publishCourseToYouTube } from '../services/coursePublish.service.js';
import {
  applyCourseYouTubeSync,
  getCourseYouTubeStateById,
} from '../services/youtubeSync.service.js';
import {
  createYouTubePlaylist,
  getValidYouTubeAccessToken,
} from '../services/youtubePublish.service.js';

const SUPPORTED_LANGUAGES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'zh', 'ja', 'ko', 'tr', 'nl', 'pl',
]);

const normalizeLanguage = (value) => {
  const code = String(value || '').trim().toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.has(code) ? code : 'en';
};

/**
 * Finds a channel of the user and returns it with its language.
 *
 * The channel language is what the course language follows, so a course
 * published to the Arabic channel is an Arabic course.
 */
const findUserChannel = async (userId, channelId) => {
  const user = await User.findById(userId).select(
    '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken',
  );
  if (!user) return null;

  const all = [];
  const push = (container) => {
    for (const channel of container?.channels || []) {
      all.push({
        channelId: channel.channelId,
        channelTitle: channel.channelTitle,
        language: channel.language || null,
      });
    }
  };
  push(user.youtube);
  for (const account of user.youtubeAccounts || []) push(account);

  if (all.length === 0 && user.youtube?.channelId) {
    all.push({
      channelId: user.youtube.channelId,
      channelTitle: user.youtube.channelTitle,
      language: user.youtube.language || null,
    });
  }

  if (!channelId) return all[0] || null;
  return all.find((channel) => channel.channelId === channelId) || null;
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
    language: entry.language,
    youtubeVideoId: entry.youtubeVideoId,
    youtubeUrl: entry.youtubeUrl,
    publishedAt: entry.publishedAt,
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
          language: entry.language,
          youtubeVideoId: entry.youtubeVideoId,
          youtubeUrl: entry.youtubeUrl,
          publishedAt: entry.publishedAt,
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

  const channelId = String(req.body?.channelId || '').trim() || null;
  const channel = await findUserChannel(req.user._id, channelId);

  if (channelId && !channel) {
    const err = new Error('Channel not found');
    err.statusCode = 404;
    throw err;
  }

  // The channel decides the language of the course unless one is given.
  const language = req.body?.language
    ? normalizeLanguage(req.body.language)
    : normalizeLanguage(channel?.language || 'en');

  const videoIds = await ownedVideoIds(req.user._id, req.body?.videoIds);

  // The course image can be sent with the course itself.
  let thumbnailUrl = String(req.body?.thumbnailUrl || '').trim() || null;
  const dataUrl = String(req.body?.thumbnailDataUrl || '').trim();
  if (!thumbnailUrl && dataUrl.startsWith('data:image/') && isCloudinaryConfigured()) {
    try {
      const uploaded = await cloudinary.uploader.upload(dataUrl, {
        folder: `${env.cloudinaryFolder}/courses`,
        resource_type: 'image',
      });
      thumbnailUrl = uploaded.secure_url;
    } catch (error) {
      console.warn('[createCourse] image upload failed:', error?.message);
    }
  }

  let playlistId = String(req.body?.playlistId || '').trim() || null;
  let playlistTitle = String(req.body?.playlistTitle || '').trim() || null;

  // One playlist per course: create it now on the course channel. The
  // tokens of the account that owns that channel are used, not the ones of
  // whichever channel happens to be active.
  if (req.body?.createPlaylist && channel) {
    const user = await User.findById(req.user._id).select(
      '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken',
    );
    const accessToken = await getValidYouTubeAccessToken(user, channel.channelId);
    const playlist = await createYouTubePlaylist(accessToken, {
      title,
      description: String(req.body?.description || '').trim(),
    });
    playlistId = playlist.id;
    playlistTitle = playlist.title;
  }

  const course = await Course.create({
    title,
    description: String(req.body?.description || '').trim(),
    language,
    thumbnailUrl,
    channelId: channel?.channelId || null,
    channelTitle: channel?.channelTitle || null,
    channelLanguage: channel?.language || null,
    playlistId,
    playlistTitle,
    owner: req.user._id,
    videos: videoIds.map((video, index) => ({
      video,
      order: index,
      addedAt: new Date(),
      language,
    })),
  });

  res.status(201).json({ success: true, message: 'Course created', data: { course } });
});

// ---------- Courses: read ----------
export const getCourse = asyncHandler(async (req, res) => {
  // Load raw first so we keep the video id even when the referenced Video
  // document is missing (populate would replace it with null and lose the id).
  const raw = await Course.findOne({ _id: req.params.id, owner: req.user._id }).lean();
  if (!raw) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  const course = await Course.populate(raw, {
    path: 'videos.video',
    select: 'title status durationSeconds thumbnailUrl targetLanguages lessonVideos dubs',
  });

  res.status(200).json({
    success: true,
    data: {
      course: {
        ...course,
        videos: (course.videos || []).map((entry, index) => {
          const rawVideoId = raw.videos?.[index]?.video || null;
          const populated = entry.video && typeof entry.video === 'object' && entry.video._id ? entry.video : null;
          const videoId = populated?._id || rawVideoId || null;
          return {
            videoId: videoId ? String(videoId) : null,
            order: entry.order,
            addedAt: entry.addedAt,
            language: entry.language,
            youtubeVideoId: entry.youtubeVideoId,
            youtubeUrl: entry.youtubeUrl,
            publishedAt: entry.publishedAt,
            video: populated
              ? {
                  _id: populated._id,
                  title: populated.title,
                  status: populated.status,
                  durationSeconds: populated.durationSeconds,
                  thumbnailUrl: populated.thumbnailUrl,
                  targetLanguages: populated.targetLanguages,
                  lessonVideos: populated.lessonVideos,
                  dubs: populated.dubs,
                }
              : null,
          };
        }),
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
  if (req.body?.channelId !== undefined) {
    const channelId = String(req.body.channelId || '').trim() || null;
    if (channelId) {
      const channel = await findUserChannel(req.user._id, channelId);
      if (!channel) {
        const err = new Error('Channel not found');
        err.statusCode = 404;
        throw err;
      }
      course.channelId = channel.channelId;
      course.channelTitle = channel.channelTitle;
      course.channelLanguage = channel.language || null;
      // The playlist belongs to the old channel, so it cannot be kept.
      course.playlistId = null;
      course.playlistTitle = null;
    } else {
      course.channelId = null;
      course.channelTitle = null;
      course.channelLanguage = null;
      course.playlistId = null;
      course.playlistTitle = null;
    }
  }
  if (req.body?.playlistId !== undefined) {
    course.playlistId = String(req.body.playlistId || '').trim() || null;
    course.playlistTitle = String(req.body.playlistTitle || '').trim() || null;
  }

  await course.save();
  res.status(200).json({ success: true, message: 'Course updated', data: { course } });
});

// ---------- Courses: read the real YouTube state ----------
export const getCourseYouTube = asyncHandler(async (req, res) => {
  const state = await getCourseYouTubeStateById(req.params.id, req.user._id);
  res.status(200).json({ success: true, data: { youtube: state } });
});

// ---------- Courses: sync the database with YouTube ----------
export const syncCourseYouTube = asyncHandler(async (req, res) => {
  const result = await applyCourseYouTubeSync({
    courseId: req.params.id,
    userId: req.user._id,
    deleteDuplicates: Boolean(req.body?.deleteDuplicates),
    reorderPlaylist:
      req.body?.reorderPlaylist === undefined
        ? true
        : Boolean(req.body.reorderPlaylist),
  });

  res.status(200).json({
    success: true,
    message: 'Course synced with YouTube',
    data: result,
  });
});

// ---------- Courses: publish ----------
export const publishCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }
  if (!course.videos?.length) {
    const err = new Error('Add at least one lesson before publishing the course');
    err.statusCode = 400;
    throw err;
  }
  if (course.publishing?.status === 'processing') {
    const err = new Error('This course is already being published');
    err.statusCode = 409;
    throw err;
  }

  // The upload runs in the background: a course means uploading every lesson.
  publishCourseToYouTube({
    courseId: course._id,
    userId: req.user._id,
    onProgress: async (progress) => {
      const fresh = await Course.findById(course._id);
      if (!fresh) return;
      fresh.publishing = { ...(fresh.publishing?.toObject?.() ?? fresh.publishing ?? {}), progress };
      await fresh.save();
    },
  }).catch(async (error) => {
    console.error('[publishCourse] failed:', error);
    const fresh = await Course.findById(course._id);
    if (!fresh) return;
    fresh.publishing = {
      ...(fresh.publishing?.toObject?.() ?? fresh.publishing ?? {}),
      status: 'failed',
      error: error?.message || 'Publishing failed',
      completedAt: new Date(),
    };
    await fresh.save();
  });

  res.status(202).json({
    success: true,
    message: 'Publishing started',
    data: { courseId: course._id },
  });
});

// ---------- Courses: list the channels and playlists available ----------
export const listCourseDestinations = asyncHandler(async (req, res) => {
  const channels = [];
  const user = await User.findById(req.user._id).select(
    '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken',
  );

  const push = (container) => {
    for (const channel of container?.channels || []) {
      channels.push({
        channelId: channel.channelId,
        channelTitle: channel.channelTitle,
        language: channel.language || null,
      });
    }
  };
  push(user?.youtube);
  for (const account of user?.youtubeAccounts || []) push(account);

  const unique = [];
  const seen = new Set();
  for (const channel of channels) {
    if (!channel.channelId || seen.has(channel.channelId)) continue;
    seen.add(channel.channelId);
    unique.push(channel);
  }

  let playlists = [];
  try {
    const accessToken = await getValidYouTubeAccessToken(user);
    const { listChannelPlaylists } = await import('../services/coursePublish.service.js');
    playlists = await listChannelPlaylists(accessToken);
  } catch {
    // Playlists are optional: the user may not be connected yet.
    playlists = [];
  }

  res.status(200).json({
    success: true,
    data: { channels: unique, playlists },
  });
});

// ---------- Courses: the playlists of every channel ----------
export const listChannelPlaylists = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken',
  );

  // The playlists live on a Google account, so they are fetched once per
  // account and then grouped by the channel they belong to.
  const accounts = [];
  for (const account of user?.youtubeAccounts || []) {
    const channels = (account.channels || []).map((channel) => ({
      channelId: channel.channelId,
      channelTitle: channel.channelTitle,
      language: channel.language || null,
    }));
    if (!channels.length && account.channelId) {
      channels.push({
        channelId: account.channelId,
        channelTitle: account.channelTitle,
        language: account.language || null,
      });
    }
    if (!channels.length) continue;
    accounts.push({ account, channels });
  }
  if (!accounts.length && user?.youtube?.channelId) {
    accounts.push({
      account: user.youtube,
      channels: [
        {
          channelId: user.youtube.channelId,
          channelTitle: user.youtube.channelTitle,
          language: user.youtube.language || null,
        },
      ],
    });
  }

  const playlistsByChannel = new Map();
  for (const { account, channels } of accounts) {
    let playlists = [];
    try {
      const accessToken = await getValidYouTubeAccessToken(user, account.channelId);
      const res2 = await fetch(
        'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res2.json().catch(() => ({}));
      playlists = (data.items || []).map((item) => ({
        id: item.id,
        title: item.snippet?.title || 'Untitled playlist',
        description: item.snippet?.description || '',
        channelId: item.snippet?.channelId || null,
        thumbnailUrl: item.snippet?.thumbnails?.default?.url || null,
      }));
    } catch {
      // This account is not authorized any more.
      playlists = [];
    }

    for (const playlist of playlists) {
      // The API gives the channel of the playlist; fall back to the account
      // when it does not.
      const ownerChannel =
        channels.find((channel) => channel.channelId === playlist.channelId) ||
        channels[0];
      if (!ownerChannel) continue;
      const list = playlistsByChannel.get(ownerChannel.channelId) || [];
      list.push(playlist);
      playlistsByChannel.set(ownerChannel.channelId, list);
    }
  }

  const allChannels = [];
  const seen = new Set();
  for (const { channels } of accounts) {
    for (const channel of channels) {
      if (!channel.channelId || seen.has(channel.channelId)) continue;
      seen.add(channel.channelId);
      allChannels.push({
        ...channel,
        playlists: playlistsByChannel.get(channel.channelId) || [],
      });
    }
  }

  res.status(200).json({
    success: true,
    data: { channels: allChannels },
  });
});

// ---------- Courses: the image of the course ----------
export const uploadCourseThumbnail = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, owner: req.user._id });
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  const dataUrl = String(req.body?.thumbnailDataUrl || '').trim();
  if (!dataUrl.startsWith('data:image/')) {
    const err = new Error('A valid image data URL is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: `${env.cloudinaryFolder}/courses`,
    resource_type: 'image',
  });

  course.thumbnailUrl = result.secure_url;
  await course.save();

  res.status(200).json({
    success: true,
    message: 'Course image updated',
    data: { thumbnailUrl: course.thumbnailUrl },
  });
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
