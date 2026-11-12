import Course from '../models/Course.js';
import Video from '../models/Video.js';
import {
  createYouTubePlaylist,
  getValidYouTubeAccessToken,
  publishYouTubeVideo,
  updateYouTubeVideo,
} from './youtubePublish.service.js';
import { reconcilePublishedLesson } from './youtubeSync.service.js';

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';

/**
 * Finds the render of a video for a language.
 *
 * The dubbed version wins over the study-journey lesson render, because a
 * dub keeps the original footage while a lesson render is a new video.
 */
export const findRenderForLanguage = (video, language) => {
  const dubs = (video.dubs || [])
    .filter((item) => item.language === language && item.url)
    // The newest voice version is the one that should be on YouTube.
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime(),
    );
  const lesson = (video.lessonVideos || []).find(
    (item) =>
      item.language === language &&
      (item.source || 'lesson') === 'lesson' &&
      item.url,
  );

  if (dubs.length > 0) {
    return { source: 'dub', url: dubs[0].url, durationSeconds: Number(dubs[0].durationSeconds || 0) };
  }
  if (lesson) {
    return {
      source: 'lesson',
      url: lesson.url,
      durationSeconds: Number(lesson.durationSeconds || 0),
    };
  }
  return null;
};

/**
 * Publishes every lesson of a course to its YouTube channel and adds it to
 * the course playlist, in the lesson order.
 *
 * Runs in the background: uploading a course means uploading every lesson,
 * which takes far longer than a request may last.
 */
export const publishCourseToYouTube = async ({ courseId, userId, onProgress = null }) => {
  const course = await Course.findById(courseId);
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  const report = async (progress, extra = {}) => {
    if (!onProgress) return;
    try {
      await onProgress(progress, extra);
    } catch {
      // progress reporting must never break the publish
    }
  };

  course.publishing = {
    status: 'processing',
    progress: 5,
    publishedCount: 0,
    total: course.videos.length,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };
  await course.save();
  await report(5, { total: course.videos.length });

  const User = (await import('../models/User.js')).default;
  const user = await User.findById(userId).select(
    '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken',
  );
  const accessToken = await getValidYouTubeAccessToken(user, course.channelId);

  // Make sure the playlist exists on the channel.
  if (!course.playlistId) {
    const playlist = await createYouTubePlaylist(accessToken, {
      title: course.title,
      description: course.description || '',
    });
    course.playlistId = playlist.id;
    course.playlistTitle = playlist.title;
    course.youtubePlaylistId = playlist.id;
    course.youtubePlaylistUrl = playlist.url;
    await course.save();
  }

  const lessons = [...(course.videos || [])].sort((a, b) => a.order - b.order);
  let published = 0;

  for (let index = 0; index < lessons.length; index += 1) {
    const lesson = lessons[index];
    const video = await Video.findById(lesson.video);
    if (!video) {
      console.warn(`[coursePublish] lesson ${index + 1} has no video, skipping`);
      continue;
    }

    const language = lesson.language || course.language;
    const render = findRenderForLanguage(video, language);
    if (!render) {
      const err = new Error(
        `"${video.title}" has no ${language} version yet. Dub it or generate the lesson first.`,
      );
      err.statusCode = 400;
      throw err;
    }

    const title = `${video.title} (${language})`;
    const description = String(
      video.aiMetadata?.summary || video.description || '',
    ).trim();
    const tags = Array.isArray(video.aiMetadata?.tags) ? video.aiMetadata.tags : [];
    const categoryId = String(video.youtubeCategoryId || '27');
    const visibility = String(video.youtubeVisibility || 'private');

    let youtubeVideoId = lesson.youtubeVideoId;

    if (youtubeVideoId) {
      // Already published: refresh the metadata instead of uploading again.
      // A video that was deleted from the channel falls back to a new upload.
      try {
        await updateYouTubeVideo(accessToken, youtubeVideoId, {
          title,
          description,
          tags,
          categoryId,
          visibility,
        });
      } catch (error) {
        if (error?.statusCode === 404 || /not found/i.test(error?.message || '')) {
          youtubeVideoId = null;
        } else {
          throw error;
        }
      }
    }

    if (!youtubeVideoId) {
      const mediaRes = await fetch(render.url);
      if (!mediaRes.ok) {
        const err = new Error(
          `Failed to download the ${language} version of "${video.title}" (${mediaRes.status})`,
        );
        err.statusCode = 502;
        throw err;
      }
      const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
      const uploaded = await publishYouTubeVideo(
        accessToken,
        {
          title,
          description,
          tags,
          categoryId,
          visibility,
          mimeType: 'video/mp4',
        },
        mediaBuffer,
      );
      youtubeVideoId = uploaded.id;
    }

    lesson.youtubeVideoId = youtubeVideoId;
    lesson.youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    lesson.language = language;
    lesson.publishedAt = lesson.publishedAt || new Date();

    // Keep the lesson in the playlist once, at its position in the course,
    // and remove any older copy of it from the channel.
    const reconcile = await reconcilePublishedLesson({
      accessToken,
      channelId: course.channelId,
      video,
      language,
      keepVideoId: youtubeVideoId,
      title,
      playlistId: course.playlistId,
      position: index,
      deleteDuplicates: true,
    });
    if (reconcile.playlistItemId) {
      lesson.youtubePlaylistItemId = reconcile.playlistItemId;
    }
    for (const warning of reconcile.warnings) {
      console.warn('[coursePublish] YouTube reconcile:', warning);
    }

    // Keep the video page in sync so the lesson shows as published there too.
    const publishRecord = (video.lessonVideos || []).find(
      (item) => item.language === language && item.youtubeVideoId === youtubeVideoId,
    );
    if (publishRecord) {
      publishRecord.youtubePlaylistId = course.playlistId;
      publishRecord.youtubePlaylistItemId = lesson.youtubePlaylistItemId;
      publishRecord.youtubeUrl = lesson.youtubeUrl;
      publishRecord.youtubePublishedAt = lesson.publishedAt;
      video.lessonVideos = [...(video.lessonVideos || [])];
      await video.save();
    }

    published += 1;
    course.publishing = {
      status: 'processing',
      progress: Math.min(95, 10 + Math.round(((index + 1) / lessons.length) * 85)),
      publishedCount: published,
      total: lessons.length,
      error: null,
      startedAt: course.publishing.startedAt,
      completedAt: null,
    };
    await course.save();
    await report(course.publishing.progress, { publishedCount: published, total: lessons.length });
  }

  course.status = 'published';
  course.publishing = {
    status: 'completed',
    progress: 100,
    publishedCount: published,
    total: lessons.length,
    error: null,
    startedAt: course.publishing.startedAt,
    completedAt: new Date(),
  };
  await course.save();
  await report(100, { publishedCount: published, total: lessons.length });

  return course;
};

export const listChannelPlaylists = async (accessToken) => {
  const res = await fetch(
    `${YOUTUBE_API_URL}/playlists?part=snippet&mine=true&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Failed to fetch the playlists');
    err.statusCode = res.status;
    throw err;
  }
  return (data.items || []).map((item) => ({
    id: item.id,
    title: item.snippet?.title || 'Untitled playlist',
  }));
};
