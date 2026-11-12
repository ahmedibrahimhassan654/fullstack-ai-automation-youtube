import Course from '../models/Course.js';
import Video from '../models/Video.js';
import User from '../models/User.js';
import {
  addVideoToPlaylist,
  createYouTubePlaylist,
  deletePlaylistItem,
  deleteYouTubeVideo,
  getValidYouTubeAccessToken,
  updatePlaylistItemPosition,
  youtubeFetch,
} from './youtubePublish.service.js';

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';

export const YOUTUBE_TOKEN_FIELDS =
  '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken';

// Arabic diacritics (tashkeel) and the tatweel connector are not part of the
// words, so they must not decide whether two titles are the same.
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;

/**
 * Turns a lesson title into the shape YouTube titles share.
 *
 * YouTube titles carry the lesson number ("7. ...") and sometimes the
 * language tag ("... (ar)"), while the stored localized title has neither.
 * Arabic letters are unified and punctuation is dropped, so the two forms
 * compare equal.
 */
export const normalizeTitle = (value) => {
  let text = String(value || '');
  try {
    text = text.normalize('NFKC');
  } catch {
    // Older runtimes may not support normalize; the raw text still works.
  }

  return text
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    // "7.", "07 -", "Lesson 7:" at the start.
    .replace(/^\s*(?:lesson\s*)?\d{1,3}\s*[.)\-:]?\s*/i, '')
    // A trailing language tag such as "(ar)" or "(en-US)". Only two-letter
    // tags are removed so a real "(Part 2)" stays part of the title.
    .replace(/\s*\((?:[a-z]{2}(?:-[a-z]{2,3})?)\)\s*$/i, '')
    .replace(/[.,!?;:()[\]{}"'«»…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

/** Reads the lesson number a YouTube title starts with, if any. */
export const readLeadingNumber = (value) => {
  const match = String(value || '').match(/^\s*(?:lesson\s*)?(\d{1,3})\s*[.)\-:]\s*/i);
  return match ? Number(match[1]) : null;
};

/**
 * Every title a lesson can have on YouTube: the localized titles first, then
 * the original title. All of them are normalized for comparison.
 */
export const lessonTitleCandidates = (video, language, extraTitles = []) => {
  const titles = new Set();
  const add = (title) => {
    const normalized = normalizeTitle(title);
    if (normalized) titles.add(normalized);
  };

  const languageCode = String(language || '').split('-')[0];
  const localized = video?.aiMetadata?.localized || {};
  for (const [code, data] of Object.entries(localized)) {
    if (languageCode && String(code).split('-')[0] !== languageCode) continue;
    for (const title of data?.titles || []) add(title);
  }

  add(video?.title);
  for (const title of extraTitles) add(title);

  return [...titles];
};

/** Lists every item of a playlist, across all result pages. */
export const listAllPlaylistItems = async (accessToken, playlistId) => {
  const items = [];
  let pageToken = '';

  do {
    const query =
      `part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}` +
      `&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await youtubeFetch(accessToken, `${YOUTUBE_API_URL}/playlistItems?${query}`);

    for (const item of data.items || []) {
      items.push({
        playlistItemId: item.id,
        videoId:
          item.contentDetails?.videoId ||
          item.snippet?.resourceId?.videoId ||
          null,
        title: item.snippet?.title || '',
        position: Number(item.snippet?.position ?? items.length),
        publishedAt:
          item.contentDetails?.videoPublishedAt ||
          item.snippet?.publishedAt ||
          null,
        channelId:
          item.snippet?.videoOwnerChannelId || item.snippet?.channelId || null,
      });
    }

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return items;
};

/** Resolves the channel of a course and the playlist that holds its uploads. */export const resolveChannel = async (accessToken, channelId = null) => {
  const query = channelId
    ? `id=${encodeURIComponent(channelId)}`
    : 'mine=true';
  const data = await youtubeFetch(
    accessToken,
    `${YOUTUBE_API_URL}/channels?part=snippet,contentDetails&${query}`,
  );
  const channel = (data.items || [])[0];
  if (!channel) return null;

  return {
    id: channel.id,
    title: channel.snippet?.title || '',
    uploadsPlaylistId:
      channel.contentDetails?.relatedPlaylists?.uploads || null,
  };
};

/**
 * The playlist a course publishes into. A course without one gets it created
 * on its channel, so every lesson has a playlist to be placed in.
 */
export const ensureCoursePlaylist = async (course, accessToken) => {
  if (course.playlistId) return course.playlistId;

  // A course playlist is the way the channel shows its courses, so it has to
  // be visible to viewers. Its videos keep their own privacy.
  const playlist = await createYouTubePlaylist(accessToken, {
    title: course.title,
    description: course.description || '',
    visibility: 'public',
  });
  course.playlistId = playlist.id;
  course.playlistTitle = playlist.title;
  course.youtubePlaylistId = playlist.id;
  course.youtubePlaylistUrl = playlist.url;
  await course.save();
  return playlist.id;
};

const byNewest = (a, b) =>
  new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();

const byCreatedAt = (a, b) =>
  new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();

const youtubeUrl = (videoId) =>
  videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;

/**
 * Reads the real state of a course on YouTube.
 *
 * The channel uploads are the source of truth: a lesson counts as published
 * when an upload carries one of its titles. When several uploads match (an
 * older voice version, a re-upload) the newest one is chosen and the rest are
 * reported as duplicates. The course playlist is read separately, so an
 * upload that exists but is missing from the playlist is visible too.
 */
export const getCourseYouTubeState = async (course, user) => {
  const accessToken = await getValidYouTubeAccessToken(
    user,
    course.channelId || null,
  );
  const channel = await resolveChannel(accessToken, course.channelId);

  const [uploads, playlistItems] = await Promise.all([
    channel?.uploadsPlaylistId
      ? listAllPlaylistItems(accessToken, channel.uploadsPlaylistId)
      : Promise.resolve([]),
    course.playlistId
      ? listAllPlaylistItems(accessToken, course.playlistId)
      : Promise.resolve([]),
  ]);

  const entries = [...(course.videos || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0),
  );
  const videos = await Video.find({
    _id: { $in: entries.map((entry) => entry.video).filter(Boolean) },
  })
    .select('title aiMetadata dubs lessonVideos')
    .lean();
  const videoById = new Map(
    videos.map((video) => [String(video._id), video]),
  );

  const prepared = entries.map((entry, index) => {
    const video = videoById.get(String(entry.video)) || null;
    const language = entry.language || course.language;
    const titles = new Set(lessonTitleCandidates(video, language));
    return {
      entry,
      index,
      video,
      language,
      titles,
      matches: [],
    };
  });

  // Assign every upload to the lesson it belongs to. An upload can match more
  // than one lesson when titles are similar; the lesson number decides, and a
  // remaining ambiguity is flagged so it is never deleted automatically.
  for (const upload of uploads) {
    const normalized = normalizeTitle(upload.title);
    if (!normalized) continue;
    const owners = prepared.filter((lesson) => lesson.titles.has(normalized));
    if (!owners.length) continue;

    const uploadNumber = readLeadingNumber(upload.title);
    const byNumber = owners.find(
      (lesson) => Number(lesson.entry.order) + 1 === uploadNumber,
    );
    const owner = byNumber || owners[0];

    owner.matches.push({
      ...upload,
      normalizedTitle: normalized,
      ambiguous: owners.length > 1 && !byNumber,
    });
  }

  // A video the database already points at is a strong match: keep it with
  // its lesson even if the title has changed since it was published.
  for (const lesson of prepared) {
    const knownId = lesson.entry.youtubeVideoId;
    if (!knownId) continue;
    const upload = uploads.find((item) => item.videoId === knownId);
    if (!upload) continue;
    if (lesson.matches.some((item) => item.videoId === knownId)) continue;
    for (const other of prepared) {
      other.matches = other.matches.filter((item) => item.videoId !== knownId);
    }
    lesson.matches.push({
      ...upload,
      normalizedTitle: normalizeTitle(upload.title),
      ambiguous: false,
    });
  }

  const playlistByVideo = new Map();
  for (const item of playlistItems) {
    if (!item.videoId) continue;
    const list = playlistByVideo.get(item.videoId) || [];
    list.push(item);
    playlistByVideo.set(item.videoId, list);
  }

  const lessons = prepared.map((lesson) => {
    const sorted = [...lesson.matches].sort(byNewest);
    const best = sorted[0] || null;
    const bestPlaylistItems = best
      ? (playlistByVideo.get(best.videoId) || []).sort(
          (a, b) => a.position - b.position,
        )
      : [];
    const primaryPlaylistItem = bestPlaylistItems[0] || null;

    const duplicates = sorted.slice(1).map((item) => ({
      videoId: item.videoId,
      title: item.title,
      publishedAt: item.publishedAt,
      playlistItems: playlistByVideo.get(item.videoId) || [],
      ambiguous: Boolean(item.ambiguous),
    }));

    return {
      videoId: String(lesson.entry.video),
      title: lesson.video?.title || '',
      order: lesson.entry.order ?? lesson.index,
      lessonNumber:
        Number.isFinite(Number(lesson.entry.order)) &&
        Number(lesson.entry.order) >= 0
          ? Number(lesson.entry.order) + 1
          : null,
      language: lesson.language,
      db: {
        youtubeVideoId: lesson.entry.youtubeVideoId || null,
        youtubeUrl: lesson.entry.youtubeUrl || null,
      },
      published: Boolean(best),
      youtubeVideoId: best?.videoId || null,
      youtubeUrl: youtubeUrl(best?.videoId),
      youtubeTitle: best?.title || null,
      publishedAt: best?.publishedAt || null,
      ambiguous: Boolean(best?.ambiguous),
      inPlaylist: Boolean(primaryPlaylistItem),
      playlistItemId: primaryPlaylistItem?.playlistItemId || null,
      playlistPosition: primaryPlaylistItem?.position ?? null,
      playlistItemDuplicates: bestPlaylistItems.slice(1),
      duplicates,
    };
  });

  const knownVideoIds = new Set();
  for (const lesson of lessons) {
    if (lesson.youtubeVideoId) knownVideoIds.add(lesson.youtubeVideoId);
    for (const duplicate of lesson.duplicates) {
      knownVideoIds.add(duplicate.videoId);
    }
  }

  return {
    course: {
      id: String(course._id),
      title: course.title,
      language: course.language,
      channelId: channel?.id || course.channelId || null,
      channelTitle: channel?.title || course.channelTitle || null,
      playlistId: course.playlistId || null,
      playlistUrl: course.playlistId
        ? `https://www.youtube.com/playlist?list=${course.playlistId}`
        : null,
    },
    channelResolved: Boolean(channel),
    lessons,
    playlistItems,
    unmatchedPlaylistItems: playlistItems.filter(
      (item) => item.videoId && !knownVideoIds.has(item.videoId),
    ),
    summary: {
      lessons: lessons.length,
      published: lessons.filter((lesson) => lesson.published).length,
      inPlaylist: lessons.filter((lesson) => lesson.inPlaylist).length,
      duplicates: lessons.reduce(
        (total, lesson) =>
          total +
          lesson.duplicates.length +
          lesson.playlistItemDuplicates.length,
        0,
      ),
    },
  };
};

/** Loads a course and the owner, then reads its YouTube state. */
export const getCourseYouTubeStateById = async (courseId, userId) => {
  const course = await Course.findOne({ _id: courseId, owner: userId }).lean();
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }
  const user = await User.findById(userId).select(YOUTUBE_TOKEN_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return getCourseYouTubeState(course, user);
};

/**
 * Writes the YouTube truth back into the database and, optionally, removes the
 * duplicate uploads and puts the playlist back in lesson order.
 */
export const applyCourseYouTubeSync = async ({
  courseId,
  userId,
  deleteDuplicates = false,
  reorderPlaylist = true,
} = {}) => {
  const course = await Course.findById(courseId);
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }
  const user = await User.findById(userId).select(YOUTUBE_TOKEN_FIELDS);
  const accessToken = await getValidYouTubeAccessToken(
    user,
    course.channelId || null,
  );

  // A course without a playlist gets one, so the lessons have a place to go.
  if (!course.playlistId && course.channelId) {
    try {
      await ensureCoursePlaylist(course, accessToken);
    } catch (error) {
      console.warn('[youtubeSync] playlist creation failed:', error?.message);
    }
  }

  const state = await getCourseYouTubeState(course, user);
  const actions = { updated: [], deleted: [], playlistAdded: [], reordered: [], warnings: [] };

  // Never delete a video that is the chosen upload of a lesson in another
  // course on the same channel: two courses can share a title.
  const protectedVideoIds = new Set();
  const otherCourses = await Course.find({
    owner: userId,
    _id: { $ne: course._id },
    ...(course.channelId ? { channelId: course.channelId } : {}),
  })
    .select('videos')
    .lean();
  for (const other of otherCourses) {
    for (const entry of other.videos || []) {
      if (entry.youtubeVideoId) protectedVideoIds.add(entry.youtubeVideoId);
    }
  }

  // 1. Database: the newest upload becomes the lesson's YouTube video.
  for (const lesson of state.lessons) {
    if (!lesson.published) {
      // The database may still point at a video that was deleted from the
      // channel. Clear the stale link so the UI stops claiming it is live.
      const entry = (course.videos || []).find(
        (item) => String(item.video) === String(lesson.videoId),
      );
      if (
        entry?.youtubeVideoId &&
        state.channelResolved &&
        course.channelId &&
        state.course.channelId === course.channelId
      ) {
        const staleId = entry.youtubeVideoId;
        entry.youtubeVideoId = null;
        entry.youtubeUrl = null;
        entry.youtubePlaylistItemId = null;
        entry.publishedAt = null;

        const video = await Video.findById(lesson.videoId);
        if (video) {
          for (const record of video.lessonVideos || []) {
            if (
              record.language === lesson.language &&
              record.youtubeVideoId === staleId
            ) {
              record.youtubeVideoId = null;
              record.youtubeUrl = null;
              record.youtubePublishedAt = null;
              record.youtubePlaylistItemId = null;
              record.youtubePlaylistId = null;
            }
          }
          await video.save();
        }
      }
      continue;
    }

    const entry = (course.videos || []).find(
      (item) => String(item.video) === String(lesson.videoId),
    );
    if (entry) {
      entry.youtubeVideoId = lesson.youtubeVideoId;
      entry.youtubeUrl = lesson.youtubeUrl;
      if (lesson.playlistItemId) {
        entry.youtubePlaylistItemId = lesson.playlistItemId;
      }
      entry.publishedAt = lesson.publishedAt
        ? new Date(lesson.publishedAt)
        : entry.publishedAt || new Date();
      actions.updated.push(String(lesson.videoId));
    }

    const video = await Video.findById(lesson.videoId);
    if (!video) continue;

    const records = (video.lessonVideos || []).filter(
      (item) => item.language === lesson.language,
    );
    // Prefer the publish record of the newest dub voice, because that is the
    // voice the newest upload carries.
    const newestDub = [...(video.dubs || [])]
      .filter((dub) => dub.language === lesson.language && dub.url)
      .sort(byCreatedAt)[0];
    const newestVoiceRecord = newestDub
      ? records.find(
          (item) =>
            (item.source || 'lesson') === 'dub' &&
            String(item.voice || '') === String(newestDub.voice || ''),
        )
      : null;
    const record =
      newestVoiceRecord ||
      records.find((item) => item.youtubeVideoId === lesson.youtubeVideoId) ||
      records.find((item) => item.youtubeVideoId === lesson.db.youtubeVideoId) ||
      records[0] ||
      null;

    const duplicateIds = new Set(
      lesson.duplicates.map((duplicate) => duplicate.videoId).filter(Boolean),
    );
    for (const item of records) {
      if (item === record) continue;
      if (item.youtubeVideoId && duplicateIds.has(item.youtubeVideoId)) {
        item.youtubeVideoId = null;
        item.youtubeUrl = null;
        item.youtubePublishedAt = null;
        item.youtubePlaylistItemId = null;
      }
    }

    if (record) {
      record.youtubeVideoId = lesson.youtubeVideoId;
      record.youtubeUrl = lesson.youtubeUrl;
      record.youtubePublishedAt = lesson.publishedAt
        ? new Date(lesson.publishedAt)
        : new Date();
      record.youtubeChannelId = state.course.channelId;
      record.youtubeChannelTitle = state.course.channelTitle;
      record.youtubePlaylistId = course.playlistId || null;
      record.youtubePlaylistItemId = lesson.playlistItemId || null;
    }

    await video.save();
  }

  // 2. Delete the older copies of each lesson from the channel.
  if (deleteDuplicates) {
    for (const lesson of state.lessons) {
      for (const duplicate of lesson.duplicates) {
        if (!duplicate.videoId || duplicate.ambiguous) continue;
        if (protectedVideoIds.has(duplicate.videoId)) {
          actions.warnings.push(
            `Kept ${duplicate.videoId}: it is the published video of another lesson.`,
          );
          continue;
        }
        try {
          for (const item of duplicate.playlistItems) {
            await deletePlaylistItem(accessToken, item.playlistItemId);
          }
          await deleteYouTubeVideo(accessToken, duplicate.videoId);
          actions.deleted.push(duplicate.videoId);
        } catch (error) {
          actions.warnings.push(
            `Could not delete ${duplicate.videoId}: ${error?.message}`,
          );
        }
      }
      // The same video can sit in the playlist more than once.
      for (const item of lesson.playlistItemDuplicates) {
        try {
          await deletePlaylistItem(accessToken, item.playlistItemId);
          actions.deleted.push(item.playlistItemId);
        } catch (error) {
          actions.warnings.push(
            `Could not remove playlist item ${item.playlistItemId}: ${error?.message}`,
          );
        }
      }
    }
  }

  // 3. Every published lesson belongs in the course playlist, once.
  if (course.playlistId) {
    for (const lesson of state.lessons) {
      if (!lesson.published || !lesson.youtubeVideoId) continue;
      try {
        const current = await listAllPlaylistItems(
          accessToken,
          course.playlistId,
        );
        const existing = current
          .filter((item) => item.videoId === lesson.youtubeVideoId)
          .sort((a, b) => a.position - b.position);

        if (!existing.length) {
          const added = await addVideoToPlaylist(
            accessToken,
            course.playlistId,
            lesson.youtubeVideoId,
          );
          lesson.playlistItemId = added?.id || null;
          lesson.inPlaylist = true;
          actions.playlistAdded.push(lesson.youtubeVideoId);
        } else {
          lesson.playlistItemId = existing[0].playlistItemId;
          lesson.inPlaylist = true;
          for (const extra of existing.slice(1)) {
            await deletePlaylistItem(accessToken, extra.playlistItemId);
          }
        }

        const entry = (course.videos || []).find(
          (item) => String(item.video) === String(lesson.videoId),
        );
        if (entry) entry.youtubePlaylistItemId = lesson.playlistItemId;
      } catch (error) {
        actions.warnings.push(
          `Could not add ${lesson.youtubeVideoId} to the playlist: ${error?.message}`,
        );
      }
    }
  }

  // 4. The playlist order follows the lesson order.
  if (course.playlistId && reorderPlaylist) {
    try {
      const reordered = await reorderCoursePlaylist({
        accessToken,
        playlistId: course.playlistId,
        orderedVideoIds: state.lessons
          .filter((lesson) => lesson.published && lesson.youtubeVideoId)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((lesson) => lesson.youtubeVideoId),
      });
      actions.reordered = reordered.moved;
      actions.warnings.push(...reordered.warnings);
    } catch (error) {
      actions.warnings.push(
        `Could not reorder the playlist: ${error?.message}`,
      );
    }
  }

  await course.save();

  return {
    state: await getCourseYouTubeState(course, user),
    actions,
  };
};

/**
 * Puts the playlist items in the given video order. Items that are not part
 * of a lesson keep their relative order at the end.
 */
export const reorderCoursePlaylist = async ({
  accessToken,
  playlistId,
  orderedVideoIds = [],
}) => {
  const items = await listAllPlaylistItems(accessToken, playlistId);
  const warnings = [];
  const moved = [];

  const byVideo = new Map();
  for (const item of items) {
    if (!item.videoId) continue;
    const list = byVideo.get(item.videoId) || [];
    list.push(item);
    byVideo.set(item.videoId, list);
  }

  const desired = [];
  const used = new Set();
  for (const videoId of orderedVideoIds) {
    const list = byVideo.get(videoId) || [];
    const primary = list.sort((a, b) => a.position - b.position)[0];
    if (!primary || used.has(primary.playlistItemId)) continue;
    desired.push(primary);
    used.add(primary.playlistItemId);
    for (const extra of list.slice(1)) {
      if (used.has(extra.playlistItemId)) continue;
      used.add(extra.playlistItemId);
      try {
        await deletePlaylistItem(accessToken, extra.playlistItemId);
      } catch (error) {
        warnings.push(error?.message);
      }
    }
  }

  // Keep the items that are not lessons, in their current order.
  for (const item of items.sort((a, b) => a.position - b.position)) {
    if (used.has(item.playlistItemId)) continue;
    desired.push(item);
    used.add(item.playlistItemId);
  }

  for (let index = 0; index < desired.length; index += 1) {
    const item = desired[index];
    if (item.position === index) continue;
    try {
      await updatePlaylistItemPosition(
        accessToken,
        item.playlistItemId,
        playlistId,
        item.videoId,
        index,
      );
      moved.push(item.videoId);
    } catch (error) {
      warnings.push(
        `Could not move ${item.videoId} to ${index}: ${error?.message}`,
      );
      // A playlist that does not use manual ordering refuses every move.
      break;
    }
  }

  return { moved, warnings };
};

/**
 * Reads the YouTube state of a single video, grouped by the courses it is a
 * lesson of. Every dub of the lesson language is mapped to the newest upload.
 */
export const getVideoYouTubeState = async (videoId, userId) => {
  const video = await Video.findOne({ _id: videoId, user: userId }).lean();
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }

  const user = await User.findById(userId).select(YOUTUBE_TOKEN_FIELDS);
  const courses = await Course.find({
    owner: userId,
    'videos.video': video._id,
  }).lean();

  const states = [];
  for (const course of courses) {
    try {
      const state = await getCourseYouTubeState(course, user);
      const lesson = state.lessons.find(
        (item) => String(item.videoId) === String(video._id),
      );
      if (!lesson) continue;

      const languageDubs = (video.dubs || [])
        .filter(
          (dub) =>
            dub.language === lesson.language &&
            (!course.language ||
              String(dub.language).split('-')[0] ===
                String(course.language).split('-')[0]),
        )
        .sort(byCreatedAt);
      const newestVoice = languageDubs[0]?.voice || null;

      states.push({
        course: state.course,
        lesson,
        dubs: languageDubs.map((dub) => ({
          language: dub.language,
          voice: dub.voice || null,
          createdAt: dub.createdAt || null,
          url: dub.url,
          published:
            Boolean(lesson.published) &&
            String(dub.voice || '') === String(newestVoice || ''),
          youtubeVideoId: lesson.published ? lesson.youtubeVideoId : null,
          youtubeUrl: lesson.published ? lesson.youtubeUrl : null,
        })),
      });
    } catch (error) {
      states.push({
        course: {
          id: String(course._id),
          title: course.title,
          language: course.language,
          channelId: course.channelId || null,
          channelTitle: course.channelTitle || null,
          playlistId: course.playlistId || null,
          playlistUrl: course.playlistId
            ? `https://www.youtube.com/playlist?list=${course.playlistId}`
            : null,
        },
        lesson: null,
        dubs: [],
        error: error?.message || 'Could not read YouTube',
      });
    }
  }

  return { videoId: String(video._id), courses: states };
};

/**
 * Called right after a lesson is uploaded/updated on YouTube.
 *
 * It removes the older copies of the lesson from the channel, makes sure the
 * new upload is in the course playlist exactly once and moves it to the
 * position of the lesson inside the course.
 */
export const reconcilePublishedLesson = async ({
  accessToken,
  channelId = null,
  video = null,
  language = '',
  keepVideoId,
  title = '',
  playlistId = null,
  position = null,
  deleteDuplicates = true,
  protectedVideoIds = null,
}) => {
  const result = { deleted: [], playlistItemId: null, position: null, warnings: [] };
  if (!keepVideoId) return result;

  if (deleteDuplicates) {
    try {
      const channel = await resolveChannel(accessToken, channelId);
      if (channel?.uploadsPlaylistId) {
        const uploads = await listAllPlaylistItems(
          accessToken,
          channel.uploadsPlaylistId,
        );
        const candidates = new Set(
          lessonTitleCandidates(video, language, [title]).filter(Boolean),
        );
        const duplicates = uploads.filter(
          (item) =>
            item.videoId &&
            item.videoId !== keepVideoId &&
            candidates.has(normalizeTitle(item.title)) &&
            !(protectedVideoIds && protectedVideoIds.has(item.videoId)),
        );

        for (const duplicate of duplicates) {
          try {
            await deleteYouTubeVideo(accessToken, duplicate.videoId);
            result.deleted.push(duplicate.videoId);
          } catch (error) {
            result.warnings.push(
              `Could not delete ${duplicate.videoId}: ${error?.message}`,
            );
          }
        }
      }
    } catch (error) {
      result.warnings.push(`Could not check duplicates: ${error?.message}`);
    }
  }

  if (playlistId) {
    try {
      const items = await listAllPlaylistItems(accessToken, playlistId);
      const existing = items
        .filter((item) => item.videoId === keepVideoId)
        .sort((a, b) => a.position - b.position);

      let primary = existing[0] || null;
      for (const extra of existing.slice(1)) {
        try {
          await deletePlaylistItem(accessToken, extra.playlistItemId);
        } catch (error) {
          result.warnings.push(error?.message);
        }
      }

      if (!primary) {
        const added = await addVideoToPlaylist(
          accessToken,
          playlistId,
          keepVideoId,
        );
        primary = { playlistItemId: added?.id || null };
      }
      result.playlistItemId = primary?.playlistItemId || null;

      if (
        result.playlistItemId &&
        position !== null &&
        Number.isFinite(Number(position))
      ) {
        try {
          await updatePlaylistItemPosition(
            accessToken,
            result.playlistItemId,
            playlistId,
            keepVideoId,
            Number(position),
          );
          result.position = Number(position);
        } catch (error) {
          result.warnings.push(
            `Could not move the lesson to position ${position}: ${error?.message}`,
          );
        }
      }
    } catch (error) {
      result.warnings.push(`Could not update the playlist: ${error?.message}`);
    }
  }

  return result;
};

export default {
  normalizeTitle,
  readLeadingNumber,
  lessonTitleCandidates,
  listAllPlaylistItems,
  resolveChannel,
  ensureCoursePlaylist,
  getCourseYouTubeState,
  getCourseYouTubeStateById,
  applyCourseYouTubeSync,
  reorderCoursePlaylist,
  getVideoYouTubeState,
  reconcilePublishedLesson,
};
