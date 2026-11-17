import { env } from '../config/env.js';

const HOUR_MS = 60 * 60 * 1000;

export const SCHEDULING_MODES = ['youtube', 'worker'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * One place for every scheduling knob.
 *
 * PUBLISH_VIDEOS_PER_DAY wins over PUBLISH_GAP_HOURS when both are set,
 * because "2-3 videos per day" is what the publishing strategy is expressed
 * in; the gap is derived from it.
 */
export const getPublishSettings = () => {
  const videosPerDay = toNumber(env.publishVideosPerDay, 0);
  const gapFromPerDay = videosPerDay > 0 ? 24 / videosPerDay : 0;
  const gapHours = clamp(gapFromPerDay || toNumber(env.publishGapHours, 7), 1, 24);

  const mode = SCHEDULING_MODES.includes(String(env.publishSchedulingMode || '').toLowerCase())
    ? String(env.publishSchedulingMode).toLowerCase()
    : 'youtube';

  return {
    // A 7 hour gap means 3 videos on some days and 2 on others; 8 hours means
    // exactly 3 per day.
    gapHours,
    videosPerDay: Math.round(24 / gapHours),
    startHour: clamp(toNumber(env.publishStartHour, 9), 0, 23),
    retryHour: clamp(toNumber(env.publishRetryHour, 10), 0, 23),
    // YouTube needs a little room between the upload and publishAt.
    minLeadMinutes: clamp(toNumber(env.publishMinLeadMinutes, 30), 5, 24 * 60),
    mode,
    intervalMs: clamp(toNumber(env.publishQueueIntervalMs, 5 * 60 * 1000), 30 * 1000, 24 * HOUR_MS),
    maxAttempts: clamp(toNumber(env.publishMaxAttempts, 5), 1, 20),
    enabled: String(env.publishQueueEnabled ?? '1') !== '0',
  };
};

/** Midnight of the day the date belongs to, in server local time. */
export const startOfLocalDay = (date = new Date()) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

/**
 * The next occurrence of `hour`:00 local time, today if it is still ahead,
 * otherwise tomorrow.
 */
export const nextDailySlot = (from = new Date(), hour = 9) => {
  const base = new Date(from);
  const candidate = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    clamp(Number(hour) || 0, 0, 23),
    0,
    0,
    0,
  );
  if (candidate.getTime() <= base.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
};

/**
 * Builds `count` evenly spaced slots. The first slot is `startAt`, or the next
 * daily publishing hour when no explicit start is given.
 */
export const buildSlotTimes = ({
  count = 1,
  startAt = null,
  gapHours = null,
  startHour = null,
} = {}) => {
  const settings = getPublishSettings();
  const gap = clamp(toNumber(gapHours, settings.gapHours), 1, 24);
  const hour = startHour == null ? settings.startHour : clamp(Number(startHour) || 0, 0, 23);
  const minLead = settings.minLeadMinutes * 60 * 1000;

  let cursor = startAt ? new Date(startAt) : nextDailySlot(new Date(Date.now() + minLead), hour);
  if (Number.isNaN(cursor.getTime())) {
    cursor = nextDailySlot(new Date(Date.now() + minLead), hour);
  }

  const slots = [];
  for (let index = 0; index < Math.max(0, count); index += 1) {
    slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + gap * HOUR_MS);
  }
  return slots;
};

/** ISO 8601 in UTC, which is the format YouTube expects for status.publishAt. */
export const toYouTubePublishAt = (date) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};

export const describeSlot = (date) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'unknown' : value.toISOString();
};

export const buildPlaylistUrl = (playlistId) =>
  playlistId ? `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}` : null;

export const buildSubscribeUrl = (channelId) =>
  channelId
    ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}?sub_confirmation=1`
    : null;

const PLAYLIST_MARKER = 'Full course playlist:';
const SUBSCRIBE_MARKER = 'Subscribe for more lessons:';

const stripTemplateLines = (description) =>
  String(description || '')
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.includes(PLAYLIST_MARKER) &&
        !line.includes(SUBSCRIBE_MARKER) &&
        !/^📚\s/.test(line.trim()),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Appends the retention block to a description.
 *
 * The block is rebuilt from scratch on every publish, so publishing the same
 * lesson twice never stacks two copies of the links.
 */
export const buildPublishDescription = ({
  description = '',
  playlistId = null,
  channelId = null,
  courseTitle = '',
  extraLines = [],
} = {}) => {
  const base = stripTemplateLines(description);
  const lines = [];

  if (courseTitle) lines.push(`📚 ${String(courseTitle).trim()}`);
  const playlistUrl = buildPlaylistUrl(playlistId);
  if (playlistUrl) lines.push(`📺 ${PLAYLIST_MARKER} ${playlistUrl}`);
  const subscribeUrl = buildSubscribeUrl(channelId);
  if (subscribeUrl) lines.push(`🔔 ${SUBSCRIBE_MARKER} ${subscribeUrl}`);
  for (const line of extraLines) {
    const value = String(line || '').trim();
    if (value) lines.push(value);
  }

  if (!lines.length) return base;
  return base ? `${base}\n\n${lines.join('\n')}` : lines.join('\n');
};

export const hasPublishTemplate = (description) =>
  String(description || '').includes(PLAYLIST_MARKER) ||
  String(description || '').includes(SUBSCRIBE_MARKER);
