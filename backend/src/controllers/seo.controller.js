import { asyncHandler } from '../utils/asyncHandler.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import { getValidYouTubeAccessToken } from '../services/youtubePublish.service.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const countWords = (text = '') => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const countHashtags = (text = '') => (String(text || '').match(/(^|\s)#([^\s#]+)/g) || []).length;

const getYouTubeChannels = async (userId) => {
  const user = await User.findById(userId).select(
    '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken',
  );
  if (!user) return [];
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
    if (channels.length) accounts.push({ account, channels });
  }
  if (!accounts.length && user?.youtube?.channelId) {
    accounts.push({
      account: user.youtube,
      channels: [{
        channelId: user.youtube.channelId,
        channelTitle: user.youtube.channelTitle,
        language: user.youtube.language || null,
      }],
    });
  }

  const playlistsByChannel = new Map();
  for (const { account, channels } of accounts) {
    let playlists = [];
    try {
      const accessToken = await getValidYouTubeAccessToken(user, account.channelId);
      const res = await fetch(
        'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json().catch(() => ({}));
      playlists = (data.items || []).map((item) => ({
        id: item.id,
        title: item.snippet?.title || 'Untitled playlist',
        channelId: item.snippet?.channelId || null,
      }));
    } catch {
      playlists = [];
    }
    for (const playlist of playlists) {
      const ownerChannel =
        channels.find((channel) => channel.channelId === playlist.channelId) || channels[0];
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
  return allChannels;
};

const pickLessonPublish = (videoDoc, entry, courseLanguage) => {
  const lang = String(entry?.language || courseLanguage || videoDoc?.originalLanguage || 'en');
  // Prefer lesson video publish metadata for the lesson language (AI study-journey render)
  const lesson = (videoDoc?.lessonVideos || []).find(
    (lv) => String(lv?.language || '') === lang && (lv?.source || 'lesson') === 'lesson',
  ) || (videoDoc?.lessonVideos || []).find((lv) => String(lv?.language || '') === lang);
  const dub = (videoDoc?.dubs || []).find((d) => String(d?.language || '') === lang);
  const localized = videoDoc?.aiMetadata?.localized?.[lang] || null;
  const title =
    lesson?.youtubeTitle ||
    videoDoc?.youtubeTitle ||
    localized?.titles?.[0] ||
    videoDoc?.aiMetadata?.titles?.[0] ||
    videoDoc?.title ||
    '';
  const description =
    lesson?.youtubeDescription ||
    videoDoc?.youtubeDescription ||
    localized?.descriptions?.[0] ||
    videoDoc?.aiMetadata?.descriptions?.[0] ||
    videoDoc?.description ||
    '';
  const tags =
    (Array.isArray(lesson?.youtubeTags) && lesson.youtubeTags.length ? lesson.youtubeTags : null) ||
    (Array.isArray(videoDoc?.youtubeTags) && videoDoc.youtubeTags.length ? videoDoc.youtubeTags : null) ||
    (Array.isArray(localized?.tags) && localized.tags.length ? localized.tags : null) ||
    (Array.isArray(videoDoc?.aiMetadata?.tags) ? videoDoc.aiMetadata.tags : []) ||
    [];
  const chapters = Array.isArray(localized?.chapters) && localized.chapters.length
    ? localized.chapters
    : (Array.isArray(videoDoc?.aiMetadata?.chapters) ? videoDoc.aiMetadata.chapters : []);
  const thumbnailUrl = lesson?.thumbnailUrl || videoDoc?.thumbnailUrl || null;
  const youtubeUrl = lesson?.youtubeUrl || entry?.youtubeUrl || videoDoc?.youtubeUrl || null;
  const youtubeVideoId = lesson?.youtubeVideoId || entry?.youtubeVideoId || videoDoc?.youtubeVideoId || null;
  const published = Boolean(youtubeUrl || youtubeVideoId);
  return {
    language: lang,
    title: String(title || '').trim(),
    description: String(description || '').trim(),
    tags: tags.map((t) => String(t || '').trim()).filter(Boolean),
    chapters,
    thumbnailUrl,
    youtubeUrl,
    youtubeVideoId,
    published,
    hasDub: Boolean(dub?.url),
    hasLessonRender: Boolean(lesson?.url),
    summary: String(localized?.summary || videoDoc?.aiMetadata?.summary || '').trim(),
    keyPoints: Array.isArray(localized?.keyPoints) ? localized.keyPoints : (videoDoc?.aiMetadata?.keyPoints || []),
  };
};

const analyzeSeo = (item) => {
  const checks = [];
  let score = 0;
  const add = (ok, points, label, tip, value = null) => {
    checks.push({ ok: Boolean(ok), points, label, tip, value });
    if (ok) score += points;
  };

  const titleLen = item.title.length;
  add(Boolean(item.title), 15, 'Title present', 'Add a clear, keyword-rich title.', item.title || null);
  add(titleLen >= 20 && titleLen <= 70, 10, 'Title length (20–70 chars)', 'Aim for ~30–60 characters so it is readable and not truncated.', titleLen);
  if (titleLen > 0 && (titleLen < 20 || titleLen > 70)) score += 4; // partial

  const descLen = item.description.length;
  const descWords = countWords(item.description);
  add(descLen > 0, 15, 'Description present', 'Add a description explaining what viewers will learn.', descLen);
  add(descWords >= 40, 10, 'Description depth (≥40 words)', 'Write a fuller description (keywords, context, CTA/links) — 100+ words is even better.', descWords);
  if (descWords > 0 && descWords < 40) score += 4;

  const hashtags = countHashtags(item.description);
  add(hashtags >= 1, 5, 'Hashtags in description', 'Add a few relevant hashtags (e.g. 2–5) in the description.', hashtags);

  const tagCount = item.tags.length;
  add(tagCount >= 5, 10, 'Tags/keywords (≥5)', 'Add relevant tags/keywords (5–15) to help discovery.', tagCount);
  if (tagCount > 0 && tagCount < 5) score += 4;

  add(Boolean(item.thumbnailUrl), 10, 'Thumbnail present', 'Use a clear custom thumbnail to improve click-through rate.', Boolean(item.thumbnailUrl));

  const chapterCount = Array.isArray(item.chapters) ? item.chapters.length : 0;
  add(chapterCount >= 2, 8, 'Chapters/timestamps (≥2)', 'Add chapters/timestamps so viewers and search can jump to sections.', chapterCount);
  if (chapterCount === 1) score += 3;

  add(Boolean(item.summary) || (Array.isArray(item.keyPoints) && item.keyPoints.length > 0), 7, 'Summary/key points', 'A clear summary or key points improves clarity and metadata quality.', Boolean(item.summary || item.keyPoints?.length));

  add(item.published, 10, 'Published on YouTube', 'Publish the lesson so it can be discovered on YouTube.', item.published);

  score = clamp(Math.round(score), 0, 100);
  let level = 'weak';
  if (score >= 80) level = 'strong';
  else if (score >= 55) level = 'good';
  else if (score >= 35) level = 'fair';

  const tips = checks.filter((c) => !c.ok).map((c) => c.tip);
  return { score, level, checks, tips };
};

export const getSeoOverview = asyncHandler(async (req, res) => {
  const channels = await getYouTubeChannels(req.user._id);
  const courses = await Course.find({ owner: req.user._id })
    .sort({ createdAt: -1 })
    .populate({
      path: 'videos.video',
      select: 'title description status durationSeconds thumbnailUrl originalLanguage transcriptLanguage targetLanguages aiMetadata translations lessonVideos dubs youtubeTitle youtubeDescription youtubeTags youtubeUrl youtubeVideoId',
    })
    .lean();

  const coursesByChannel = new Map();
  const unassigned = [];
  for (const course of courses) {
    const ch = course.channelId || null;
    if (!ch) { unassigned.push(course); continue; }
    const list = coursesByChannel.get(ch) || [];
    list.push(course);
    coursesByChannel.set(ch, list);
  }

  const buildVideoItem = (entry, course) => {
    const videoDoc = entry.video && typeof entry.video === 'object' ? entry.video : null;
    const base = pickLessonPublish(videoDoc, entry, course.language);
    const seo = analyzeSeo(base);
    return {
      courseId: String(course._id),
      courseTitle: course.title,
      videoId: videoDoc?._id ? String(videoDoc._id) : null,
      sourceTitle: videoDoc?.title || null,
      order: entry.order ?? null,
      durationSeconds: videoDoc?.durationSeconds || 0,
      seo,
      ...base,
    };
  };

  const summarize = (videos) => {
    const count = videos.length;
    const avg = count ? Math.round(videos.reduce((s, v) => s + (v.seo?.score || 0), 0) / count) : 0;
    const published = videos.filter((v) => v.published).length;
    const strong = videos.filter((v) => v.seo?.level === 'strong').length;
    const weak = videos.filter((v) => ['weak', 'fair'].includes(v.seo?.level)).length;
    return { count, avgScore: avg, published, strong, needsWork: weak };
  };

  const channelResults = channels.map((channel) => {
    const chCourses = coursesByChannel.get(channel.channelId) || [];
    const courseResults = chCourses.map((course) => {
      const videos = (course.videos || []).map((entry) => buildVideoItem(entry, course));
      return {
        _id: String(course._id),
        title: course.title,
        language: course.language || course.channelLanguage || null,
        status: course.status,
        channelId: course.channelId || null,
        playlistId: course.playlistId || course.youtubePlaylistId || null,
        videos,
        summary: summarize(videos),
      };
    });
    const allVideos = courseResults.flatMap((c) => c.videos);
    return {
      channelId: channel.channelId,
      channelTitle: channel.channelTitle,
      language: channel.language || null,
      playlistsCount: (channel.playlists || []).length,
      courses: courseResults,
      summary: { ...summarize(allVideos), courses: courseResults.length },
    };
  });

  // Courses not tied to any connected channel (still useful to show)
  const unassignedCourses = unassigned.map((course) => {
    const videos = (course.videos || []).map((entry) => buildVideoItem(entry, course));
    return {
      _id: String(course._id),
      title: course.title,
      language: course.language || null,
      status: course.status,
      channelId: course.channelId || null,
      playlistId: course.playlistId || course.youtubePlaylistId || null,
      videos,
      summary: summarize(videos),
    };
  });

  const overallVideos = [
    ...channelResults.flatMap((c) => c.courses.flatMap((co) => co.videos)),
    ...unassignedCourses.flatMap((c) => c.videos),
  ];

  res.status(200).json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      note: 'SEO score is based on available metadata (titles, descriptions, tags, chapters, thumbnails, publish status). It is not live YouTube Analytics (CTR/views/watch time).',
      overall: summarize(overallVideos),
      channels: channelResults,
      unassignedCourses,
    },
  });
});
