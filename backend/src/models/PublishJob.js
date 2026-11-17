import mongoose from 'mongoose';

// PENDING   queued, waiting for its slot (or for a retry window)
// SCHEDULED uploaded to YouTube with a publishAt time; YouTube publishes it
// UPLOADING being uploaded right now (a restart turns it back into PENDING)
// PUBLISHED live on YouTube
// FAILED    gave up after maxAttempts (or a non-retryable error)
// CANCELED  removed from the queue by the user
export const PUBLISH_JOB_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'UPLOADING',
  'PUBLISHED',
  'FAILED',
  'CANCELED',
];

export const PUBLISH_JOB_ACTIVE_STATUSES = ['PENDING', 'SCHEDULED', 'UPLOADING'];

// How the slot is enforced:
// - 'youtube': the upload carries status.publishAt, YouTube publishes it.
// - 'worker':  the upload stays private and the queue worker flips it to
//              public when the slot arrives (used when publishAt is too near,
//              since YouTube requires it to be at least a few minutes ahead).
export const PUBLISH_SCHEDULING_MODES = ['youtube', 'worker'];

const publishLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    message: { type: String, default: '' },
    // quotaExceeded, rateLimitExceeded, uploadFailed, playlistFailed, ...
    code: { type: String, default: null },
  },
  { _id: false },
);

const publishJobSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
      index: true,
    },
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: [true, 'Video reference is required'],
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },

    // Which render of the video is uploaded.
    language: { type: String, required: true },
    source: { type: String, enum: ['dub', 'lesson'], default: 'dub' },
    voice: { type: String, default: null },
    mediaUrl: { type: String, required: true },
    mediaDurationSeconds: { type: Number, default: 0 },

    // YouTube destination.
    channelId: { type: String, default: null },
    channelTitle: { type: String, default: null },
    playlistId: { type: String, default: null },
    playlistPosition: { type: Number, default: null },

    // The upload payload is snapshotted when the job is queued, so a later
    // edit of the video does not change what was promised for that slot.
    title: { type: String, required: true },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    categoryId: { type: String, default: '27' },
    thumbnailPath: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    madeForKids: { type: Boolean, default: false },
    videoLanguage: { type: String, default: null },
    // Visibility the video ends up with once the slot arrives.
    visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'public' },

    // Scheduling.
    scheduledPublishAt: { type: Date, required: true, index: true },
    schedulingMode: {
      type: String,
      enum: PUBLISH_SCHEDULING_MODES,
      default: 'youtube',
    },
    status: {
      type: String,
      enum: PUBLISH_JOB_STATUSES,
      default: 'PENDING',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextRetryAt: { type: Date, default: null, index: true },
    lastError: { type: String, default: null },
    // A quota error is not the job's fault: it is retried the next day and
    // never counted as a hard failure.
    quotaExceeded: { type: Boolean, default: false },
    retryAfter: { type: Date, default: null },

    // YouTube results.
    youtubeVideoId: { type: String, default: null },
    youtubeUrl: { type: String, default: null },
    youtubePlaylistItemId: { type: String, default: null },
    uploadedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    logs: { type: [publishLogSchema], default: [] },
  },
  { timestamps: true },
);

// The worker asks two questions, and both need their own index:
// "what is due?" and "what can be retried now?".
publishJobSchema.index({ status: 1, scheduledPublishAt: 1 });
publishJobSchema.index({ status: 1, nextRetryAt: 1 });
publishJobSchema.index({ owner: 1, status: 1, scheduledPublishAt: 1 });
publishJobSchema.index({ owner: 1, video: 1, language: 1, source: 1, status: 1 });

publishJobSchema.methods.addLog = function addLog(level, message, code = null) {
  this.logs = [
    ...(this.logs || []),
    { at: new Date(), level, message: String(message || '').slice(0, 1000), code },
  ].slice(-50);
  return this;
};

publishJobSchema.methods.isActive = function isActive() {
  return PUBLISH_JOB_ACTIVE_STATUSES.includes(this.status);
};

const PublishJob = mongoose.model('PublishJob', publishJobSchema);
export default PublishJob;
