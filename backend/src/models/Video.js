import mongoose from 'mongoose';

export const VIDEO_STATUSES = ['pending', 'processing', 'completed', 'failed'];

const wordSuggestionSchema = new mongoose.Schema(
  {
    english: { type: String, default: '' },
    equivalent: { type: String, default: '' },
  },
  { _id: false }
);

const transcriptSegmentSchema = new mongoose.Schema(
  {
    start: { type: Number, default: 0 },
    end: { type: Number, default: 0 },
    text: { type: String, default: '' },
    // The same sentence prepared for speaking: technical names written the
    // way an Arabic speaker pronounces them and numbers spelled out in Arabic
    // words. The subtitles keep using `text`.
    spokenText: { type: String, default: '' },
    sourceText: { type: String, default: '' },
    originalLanguage: { type: String, default: 'en' },
    qualityScore: { type: Number, default: null },
    qualityStatus: {
      type: String,
      enum: ['passed', 'failed', 'unknown'],
      default: 'unknown',
    },
    qualityReason: { type: String, default: '' },
    translationAttempts: { type: Number, default: 1 },
    wordSuggestions: { type: [wordSuggestionSchema], default: [] },
  },
  { _id: false }
);

const chapterSchema = new mongoose.Schema(
  {
    time: { type: String, required: true }, // e.g. "00:00" or "00:42"
    seconds: { type: Number, default: 0 },
    title: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const aiMetadataSchema = new mongoose.Schema(
  {
    titles: { type: [String], default: [] },
    descriptions: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    chapters: { type: [chapterSchema], default: [] },
    coverConcepts: { type: [String], default: [] },
    summary: { type: String, default: '' },
    keyPoints: { type: [String], default: [] },
    actionItems: { type: [String], default: [] },
    decisions: { type: [String], default: [] },
    openQuestions: { type: [String], default: [] },
    language: { type: String, default: 'en' },
    model: { type: String, default: '' },
    generatedAt: { type: Date, default: null },
    localized: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const translationSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    transcript: { type: String, default: '' },
    segments: { type: [transcriptSegmentSchema], default: [] },
    subtitlesUrl: { type: String, default: null },
    qualityScore: { type: Number, default: null },
    qualityStatus: {
      type: String,
      enum: ['passed', 'failed', 'unknown'],
      default: 'unknown',
    },
    translationAttempts: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const dubSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    url: { type: String, required: true },
    storagePath: { type: String, default: null },
    durationSeconds: { type: Number, default: 0 },
    voice: { type: String, default: null },
    subtitlesBurned: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const lessonVideoSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    // 'lesson' = AI study-journey render, 'dub' = original footage + translated voice
    source: { type: String, enum: ['lesson', 'dub'], default: 'lesson' },
    url: { type: String, required: true },
    storagePath: { type: String, default: null },
    durationSeconds: { type: Number, default: 0 },
    voice: { type: String, default: null },
    script: { type: String, default: '' },
    segments: { type: [transcriptSegmentSchema], default: [] },
    subtitlesUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    youtubeVideoId: { type: String, default: null },
    youtubeUrl: { type: String, default: null },
    youtubePublishedAt: { type: Date, default: null },
    youtubeChannelId: { type: String, default: null },
    youtubeChannelTitle: { type: String, default: null },
    youtubePlaylistId: { type: String, default: null },
    youtubePlaylistItemId: { type: String, default: null },
    youtubeVisibility: { type: String, default: null },
    youtubeCategoryId: { type: String, default: null },
    youtubeTitle: { type: String, default: null },
    youtubeDescription: { type: String, default: null },
    youtubeTags: { type: [String], default: [] },
    // YouTube Automation Form checklist fields for this language.
    youtubeMadeForKids: { type: Boolean, default: false },
    youtubeSelfDeclaredAiContent: { type: Boolean, default: false },
    youtubePaidPromotion: { type: Boolean, default: false },
    youtubeAllowEmbedding: { type: Boolean, default: true },
    youtubePublishToSubs: { type: Boolean, default: true },
    youtubeShortsRemixing: { type: String, enum: ['allow', 'disallow'], default: 'allow' },
    youtubeAutomaticChapters: { type: Boolean, default: true },
    youtubeVideoLanguage: { type: String, default: null },
    youtubeTitleDescriptionLanguage: { type: String, default: null },
    youtubeRecordingDate: { type: String, default: null },
    youtubeLocation: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const subtitleSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    url: { type: String, default: null },
    path: { type: String, default: null },
  },
  { _id: false }
);

const errorSchema = new mongoose.Schema(
  {
    message: { type: String, default: '' },
    stage: {
      type: String,
      enum: ['upload', 'transcription', 'analysis', 'translation', 'publish', 'failed', 'unknown'],
      default: 'unknown',
    },
    stack: { type: String, default: null, select: false },
    occurredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const videoSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: 200,
    },
    description: { type: String, default: '', maxlength: 5000 },
    originalFilename: { type: String, default: null },
    mimeType: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    storagePath: { type: String, default: null }, // local path on server
    publicUrl: { type: String, default: null }, // optional CDN/public URL
    attachments: {
      type: [
        {
          name: { type: String, required: true },
          type: { type: String, enum: ['file', 'link'], default: 'file' },
          url: { type: String, required: true },
          publicId: { type: String, default: null },
          sizeBytes: { type: Number, default: 0 },
          mimeType: { type: String, default: null },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    durationSeconds: { type: Number, default: 0 },
    thumbnailUrl: { type: String, default: null },
    // YouTube-specific publishing options
    youtubeVisibility: {
      type: String,
      enum: ['public', 'unlisted', 'private'],
      default: 'public',
    },
    youtubeCategoryId: { type: String, default: '27' }, // Education
    scheduledPublishAt: { type: Date, default: null },
    status: {
      type: String,
      enum: VIDEO_STATUSES,
      default: 'pending',
      index: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    currentStage: { type: String, default: 'queued' },
    transcript: { type: String, default: '' },
    transcriptSegments: { type: [transcriptSegmentSchema], default: [] },
    transcriptLanguage: { type: String, default: 'en' },
    originalLanguage: { type: String, default: 'en' },
    targetLanguages: { type: [String], default: [] },
    translations: { type: [translationSchema], default: [] },
    aiMetadata: { type: aiMetadataSchema, default: () => ({}) },
    subtitles: { type: [subtitleSchema], default: [] },
    // Auto-dubbed video variants (video with replaced voice track).
    dubs: { type: [dubSchema], default: [] },
    lessonVideos: { type: [lessonVideoSchema], default: [] },
    lessonGeneration: {
      language: { type: String, default: null },
      status: { type: String, enum: ['idle', 'processing', 'completed', 'failed'], default: 'idle' },
      progress: { type: Number, default: 0, min: 0, max: 100 },
      error: { type: String, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
    },
    dubbing: {
      language: { type: String, default: null },
      status: { type: String, enum: ['idle', 'processing', 'completed', 'failed'], default: 'idle' },
      progress: { type: Number, default: 0, min: 0, max: 100 },
      error: { type: String, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
    },
    // YouTube publishing
    youtubeVideoId: { type: String, default: null, index: true },
    youtubeUrl: { type: String, default: null },
    youtubePublishedAt: { type: Date, default: null },
    publishedTitle: { type: String, default: null },
    publishedDescription: { type: String, default: null },
    publishedTags: { type: [String], default: [] },
    // Processing
    jobId: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    lastError: { type: errorSchema, default: null },
    processingStartedAt: { type: Date, default: null },
    processingCompletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

videoSchema.index({ user: 1, createdAt: -1 });
videoSchema.index({ status: 1, createdAt: -1 });

// Convenience virtual for human-readable duration if stored.
videoSchema.virtual('isPublished').get(function isPublished() {
  return Boolean(this.youtubeVideoId);
});

const Video = mongoose.model('Video', videoSchema);
export default Video;
